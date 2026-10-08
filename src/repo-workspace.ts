import {lstat,mkdir,readFile,realpath,rm,stat,writeFile} from "node:fs/promises";
import {dirname,isAbsolute,relative,resolve,sep} from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {containsSecret,redact,sanitizedEnv} from "./secrets.js";
const execFileAsync=promisify(execFile);

export type FilePatch={path:string;content:string};
export type CheckCommandSpec={cmd:string;args:string[];timeoutMs?:number};
export type CheckResult={cmd:string;args:string[];exitCode:number;durationMs:number;output:string};
export type TransactionResult={written:string[];changedFiles:string[];commitSha?:string;evidence:string[];checks:CheckResult[]};

const DEFAULT_CHECK_TIMEOUT_MS=300_000;
const OUTPUT_TAIL=2000;
const FORBIDDEN_SEGMENTS=new Set([".git",".companyswai"]);

export class WorkspaceError extends Error{
 constructor(message:string,readonly code:"UNSAFE_PATH"|"INVALID_WORKSPACE"|"CHECK_FAILED"|"DIRTY_TARGET"|"COMMIT_FAILED"|"SECRET_IN_PATCH",readonly evidence:string[]=[]){super(message);this.name="WorkspaceError";}
}

export function parseFilePatches(text:string):FilePatch[]{
 const out:FilePatch[]=[],re=/```file\s+([^\r\n]+)\r?\n([\s\S]*?)```/g;let match:RegExpExecArray|null;
 while((match=re.exec(text))){const path=match[1].trim();if(path)out.push({path,content:match[2]});}
 return out;
}

const tail=(text:string)=>redact(text.length>OUTPUT_TAIL?"…"+text.slice(-OUTPUT_TAIL):text);
const isInside=(root:string,target:string)=>{const rel=relative(root,target);return rel===""||(!rel.startsWith("..")&&!isAbsolute(rel));};

export class LocalRepoWorkspace{
 constructor(readonly root:string){}

 /** The workspace must be an existing directory; commits additionally require a git work tree. */
 async validate(options:{requireGit?:boolean}={}){
  let info;
  try{info=await stat(this.root);}catch{throw new WorkspaceError("Workspace path does not exist: "+this.root,"INVALID_WORKSPACE");}
  if(!info.isDirectory())throw new WorkspaceError("Workspace path is not a directory: "+this.root,"INVALID_WORKSPACE");
  if(options.requireGit){
   try{await this.git(["rev-parse","--is-inside-work-tree"]);}catch{throw new WorkspaceError("autoCommit requires a git repository at "+this.root,"INVALID_WORKSPACE");}
  }
 }

 /** Lexical + symlink-aware confinement: no absolute paths, traversal, .git/.companyswai segments or links leaving the root. */
 async resolveSafe(path:string){
  if(!path||path.includes("\0")||isAbsolute(path)||/^[A-Za-z]:/.test(path))throw new WorkspaceError("Unsafe file patch path: "+path,"UNSAFE_PATH");
  const segments=path.split(/[\\/]+/).filter(Boolean);
  if(!segments.length||segments.some(s=>s===".."||FORBIDDEN_SEGMENTS.has(s.toLowerCase())))throw new WorkspaceError("File patch path is not allowed: "+path,"UNSAFE_PATH");
  const root=resolve(this.root),target=resolve(root,...segments);
  if(!isInside(root,target))throw new WorkspaceError("File patch escapes workspace: "+path,"UNSAFE_PATH");
  const realRoot=await realpath(root);let probe=target;
  for(;;){
   try{await lstat(probe);break;}catch{const parent=dirname(probe);if(parent===probe)break;probe=parent;}
  }
  if(!isInside(realRoot,await realpath(probe)))throw new WorkspaceError("File patch resolves outside workspace through a symlink: "+path,"UNSAFE_PATH");
  return target;
 }

 private async git(args:string[]){return execFileAsync("git",args,{cwd:this.root,maxBuffer:10*1024*1024,env:sanitizedEnv()});}

 async runChecks(commands:CheckCommandSpec[]){
  const results:CheckResult[]=[];
  for(const command of commands){
   if(!command.cmd||command.cmd.includes("/")||command.cmd.includes("\\"))throw new WorkspaceError("Check command must be an executable name without path","CHECK_FAILED");
   const started=Date.now();
   try{
    const {stdout,stderr}=await execFileAsync(command.cmd,command.args,{cwd:this.root,maxBuffer:10*1024*1024,timeout:command.timeoutMs??DEFAULT_CHECK_TIMEOUT_MS,env:sanitizedEnv()});
    results.push({cmd:command.cmd,args:command.args,exitCode:0,durationMs:Date.now()-started,output:tail(stdout+stderr)});
   }catch(error){
    const failure=error as {code?:number|string;stdout?:string;stderr?:string;killed?:boolean;message:string};
    const result={cmd:command.cmd,args:command.args,exitCode:typeof failure.code==="number"?failure.code:-1,durationMs:Date.now()-started,output:tail((failure.stdout??"")+(failure.stderr??"")||failure.message)};
    results.push(result);
    throw new WorkspaceError("Deterministic check failed: "+describeCheck(result)+(failure.killed?" (timed out)":""),"CHECK_FAILED",results.map(describeCheck));
   }
  }
  return results;
 }

 /**
  * Applies patches atomically: back up, write, run checks, optionally commit only the patched paths.
  * Any failure restores the previous file contents and removes files and directories the patch created.
  */
 async transaction(requested:FilePatch[],checks:CheckCommandSpec[]=[],commitMessage?:string):Promise<TransactionResult>{
  await this.validate({requireGit:commitMessage!=null});
  let patches=requested;
  const targets=new Map<string,FilePatch>();
  for(const patch of patches){
   const target=await this.resolveSafe(patch.path),earlier=targets.get(target);
   if(earlier&&earlier.content!==patch.content)throw new WorkspaceError("Conflicting patches for "+patch.path,"UNSAFE_PATH");
   if(containsSecret(patch.content))throw new WorkspaceError("Patch for "+patch.path+" contains a credential-shaped string","SECRET_IN_PATCH");
   if(!earlier)targets.set(target,patch);
  }
  patches=[...targets.values()];
  const paths=patches.map(p=>p.path.split(/[\\/]+/).filter(Boolean).join("/"));
  if(commitMessage!=null&&paths.length){
   const dirty=(await this.git(["status","--porcelain","--",...paths])).stdout.trim();
   if(dirty)throw new WorkspaceError("Refusing to patch files with uncommitted changes: "+dirty.split("\n").map(l=>l.slice(3)).join(", "),"DIRTY_TARGET");
  }
  const backups=new Map<string,{existed:boolean;content?:string}>(),createdDirs:string[]=[],changed:string[]=[];
  for(const patch of patches){
   const target=await this.resolveSafe(patch.path);
   try{
    const content=await readFile(target,"utf8");backups.set(target,{existed:true,content});
    if(content!==patch.content)changed.push(patch.path);
   }catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;backups.set(target,{existed:false});changed.push(patch.path);}
  }
  const rollback=async()=>{
   for(const [target,backup] of backups){
    if(backup.existed)await writeFile(target,backup.content??"","utf8");else await rm(target,{force:true});
   }
   for(const dir of createdDirs)await rm(dir,{recursive:true,force:true});
  };
  let results:CheckResult[]=[],commitSha:string|undefined;
  try{
   for(const patch of patches){
    const target=await this.resolveSafe(patch.path),created=await mkdir(dirname(target),{recursive:true});
    if(created)createdDirs.push(created);
    await writeFile(target,patch.content,"utf8");
   }
   results=await this.runChecks(checks);
   if(commitMessage!=null&&changed.length){
    try{
     await this.git(["add","--",...paths]);
     await this.git(["commit","-m",commitMessage,"--only","--",...paths]);
     commitSha=(await this.git(["rev-parse","HEAD"])).stdout.trim();
    }catch(error){
     await this.git(["reset","-q","--",...paths]).catch(()=>undefined);
     throw new WorkspaceError("git commit failed: "+redact(error instanceof Error?error.message:String(error)),"COMMIT_FAILED");
    }
   }
  }catch(error){await rollback();throw error;}
  return {written:patches.map(p=>p.path),changedFiles:changed,commitSha,evidence:results.map(describeCheck),checks:results};
 }
}
export const describeCheck=(r:CheckResult)=>"check: "+[r.cmd,...r.args].join(" ")+" → exit "+r.exitCode+" ("+r.durationMs+"ms)";

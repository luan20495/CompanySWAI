import {lstat,mkdir,readFile,realpath,rm,stat,writeFile} from "node:fs/promises";
import {dirname,isAbsolute,relative,resolve} from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {containsSecret,redact,sanitizedEnv} from "./secrets.js";
const execFileAsync=promisify(execFile);

export type FilePatch={path:string;content:string};
export type CheckCommandSpec={cmd:string;args:string[];timeoutMs?:number};
export type CheckResult={cmd:string;args:string[];exitCode:number;durationMs:number;output:string};
export type GateRun={name:string;commands:CheckCommandSpec[]};
export type GateResult={name:string;status:"PASS"|"FAIL"|"NOT_APPLICABLE"|"NOT_CONFIGURED";detail?:string;checks:CheckResult[]};
export type TransactionResult={written:string[];changedFiles:string[];commitSha?:string;evidence:string[];checks:CheckResult[];gates:GateResult[]};

const DEFAULT_CHECK_TIMEOUT_MS=300_000;
const OUTPUT_TAIL=2000;
const FORBIDDEN_SEGMENTS=new Set([".git",".companyswai"]);

export class WorkspaceError extends Error{
 constructor(message:string,readonly code:"UNSAFE_PATH"|"INVALID_WORKSPACE"|"CHECK_FAILED"|"DIRTY_TARGET"|"COMMIT_FAILED"|"SECRET_IN_PATCH"|"GATE_NOT_CONFIGURED"|"GIT_CONFLICT"|"INTEGRATION_FAILED"|"WORKTREE_FAILED",readonly evidence:string[]=[],readonly gates:GateResult[]=[]){super(message);this.name="WorkspaceError";}
 /** Same error with extra detail appended to the evidence (for example raw git output). */
 withMessage(detail:string){return new WorkspaceError(this.message,this.code,[...this.evidence,redact(detail).slice(0,500)],this.gates);}
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

 private identity?:Promise<NodeJS.ProcessEnv>;
 /** Commits need an author; use the repository's own identity and only fall back to a CompanySWAI one when none is configured. */
 private commitEnv(){
  return this.identity??=(async()=>{
   const env=sanitizedEnv();
   const configured=await execFileAsync("git",["config","user.email"],{cwd:this.root,env}).then(r=>r.stdout.trim(),()=>"");
   return configured?env:{...env,GIT_AUTHOR_NAME:"CompanySWAI",GIT_AUTHOR_EMAIL:"companyswai@localhost",GIT_COMMITTER_NAME:"CompanySWAI",GIT_COMMITTER_EMAIL:"companyswai@localhost"};
  })();
 }
 async git(args:string[]){return execFileAsync("git",args,{cwd:this.root,maxBuffer:10*1024*1024,env:await this.commitEnv()});}

 /** Runs named gates in order and stops at the first failing one. A gate with no commands is deliberately not applicable. */
 async runGates(gates:GateRun[]):Promise<GateResult[]>{
  const results:GateResult[]=[];
  for(const gate of gates){
   if(!gate.commands.length){results.push({name:gate.name,status:"NOT_APPLICABLE",detail:"declared not applicable",checks:[]});continue;}
   try{results.push({name:gate.name,status:"PASS",checks:await this.runChecks(gate.commands)});}
   catch(error){
    if(!(error instanceof WorkspaceError))throw error;
    results.push({name:gate.name,status:"FAIL",detail:error.message,checks:[]});
    throw new WorkspaceError("Gate '"+gate.name+"' failed: "+error.message,"CHECK_FAILED",results.flatMap(r=>r.status==="FAIL"?error.evidence.map(e=>"gate "+r.name+" "+e):r.checks.map(c=>"gate "+r.name+" "+describeCheck(c))),results);
   }
  }
  return results;
 }

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
    throw new WorkspaceError("Deterministic check failed: "+describeCheck(result)+(failure.killed?" (timed out)":""),"CHECK_FAILED",[...results.map(describeCheck),"output of the failing check:\n"+result.output.slice(-1500)]);
   }
  }
  return results;
 }

 /**
  * Applies patches atomically: back up, write, run checks, optionally commit only the patched paths.
  * Any failure restores the previous file contents and removes files and directories the patch created.
  */
 async transaction(requested:FilePatch[],checks:CheckCommandSpec[]=[],commitMessage?:string,options:{gates?:GateRun[]}={}):Promise<TransactionResult>{
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
  let gateResults:GateResult[]=[],commitSha:string|undefined;
  try{
   for(const patch of patches){
    const target=await this.resolveSafe(patch.path),created=await mkdir(dirname(target),{recursive:true});
    if(created)createdDirs.push(created);
    await writeFile(target,patch.content,"utf8");
   }
   gateResults=await this.runGates(options.gates??(checks.length?[{name:"project-checks",commands:checks}]:[]));
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
  const results=gateResults.flatMap(g=>g.checks);
  return {written:patches.map(p=>p.path),changedFiles:changed,commitSha,evidence:gateResults.flatMap(g=>g.checks.map(c=>"gate "+g.name+" "+describeCheck(c))),checks:results,gates:gateResults};
 }
}
export const describeCheck=(r:CheckResult)=>"check: "+[r.cmd,...r.args].join(" ")+" → exit "+r.exitCode+" ("+r.durationMs+"ms)";

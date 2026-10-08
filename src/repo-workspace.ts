import {mkdir,writeFile,readFile,rm} from "node:fs/promises";
import {dirname,resolve,relative,isAbsolute} from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
const execFileAsync=promisify(execFile);

export type FilePatch={path:string;content:string};
export function parseFilePatches(text:string):FilePatch[]{const out:FilePatch[]=[];const re=/```file\s+([^\r\n]+)\r?\n([\s\S]*?)```/g;let match:RegExpExecArray|null;while((match=re.exec(text))){const path=match[1].trim();if(path)out.push({path,content:match[2]});}return out;}

export class LocalRepoWorkspace{
 constructor(readonly root:string){}
 private target(path:string){if(isAbsolute(path)||path.includes("\0"))throw new Error("Unsafe absolute file patch path: "+path);const root=resolve(this.root),target=resolve(root,path),rel=relative(root,target);if(rel.startsWith("..")||isAbsolute(rel))throw new Error("File patch escapes workspace: "+path);return target;}
 async apply(patches:FilePatch[]){const written:string[]=[];for(const patch of patches){const target=this.target(patch.path);await mkdir(dirname(target),{recursive:true});await writeFile(target,patch.content,"utf8");written.push(patch.path);}return written;}
 async check(commands:Array<{cmd:string;args:string[]}>){for(const command of commands){if(!command.cmd||command.cmd.includes("/")||command.cmd.includes("\\"))throw new Error("Check command must be an executable name without path");await execFileAsync(command.cmd,command.args,{cwd:this.root,maxBuffer:10*1024*1024});}}
 async commit(message:string){await execFileAsync("git",["add","-A"],{cwd:this.root});const status=await execFileAsync("git",["status","--porcelain"],{cwd:this.root});if(!status.stdout.trim())return undefined;await execFileAsync("git",["commit","-m",message],{cwd:this.root,maxBuffer:10*1024*1024});const rev=await execFileAsync("git",["rev-parse","HEAD"],{cwd:this.root});return rev.stdout.trim();}
 async transaction(patches:FilePatch[],checks:Array<{cmd:string;args:string[]}>,commitMessage?:string){
  const backups=new Map<string,{existed:boolean;content?:string}>(),written:string[]=[];
  for(const patch of patches){const target=this.target(patch.path);try{backups.set(patch.path,{existed:true,content:await readFile(target,"utf8")});}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;backups.set(patch.path,{existed:false});}}
  try{written.push(...await this.apply(patches));if(checks.length)await this.check(checks);const commitSha=commitMessage?await this.commit(commitMessage):undefined;return {written,commitSha};}
  catch(error){for(const [path,backup] of backups){const target=this.target(path);if(backup.existed){await mkdir(dirname(target),{recursive:true});await writeFile(target,backup.content??"","utf8");}else await rm(target,{force:true});}throw error;}
 }
}

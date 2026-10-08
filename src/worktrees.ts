import {mkdir,readdir,rm,stat} from "node:fs/promises";
import {join,resolve} from "node:path";
import {LocalRepoWorkspace,WorkspaceError,describeCheck,type CheckCommandSpec,type FilePatch,type GateRun,type TransactionResult} from "./repo-workspace.js";
import {SafeId} from "./ids.js";

/**
 * Isolated git worktrees for parallel coding tasks. Each task works in its own detached worktree
 * (`<state>/worktrees/<project>/<task>`), runs its gates there, and is integrated into the main workspace afterwards:
 * serialised, conflict-checked, verified again, and reverted if the integrated tree fails its checks.
 * Detached worktrees create no branches.
 */
const locks=new Map<string,Promise<unknown>>();
function serialised<T>(key:string,fn:()=>Promise<T>):Promise<T>{
 const next=(locks.get(key)??Promise.resolve()).catch(()=>undefined).then(fn);
 locks.set(key,next);return next;
}

export type Worktree={path:string;base:string;projectId:string;taskId:string};

export class WorktreeManager{
 private main:LocalRepoWorkspace;
 constructor(readonly repo:string,readonly root:string){this.main=new LocalRepoWorkspace(repo);this.root=resolve(root);}
 pathFor(projectId:string,taskId:string){return join(this.root,SafeId.parse(projectId),SafeId.parse(taskId));}

 /** Fresh detached worktree at `baseRef` (default: the main workspace's current HEAD); any leftover from a crash is replaced. */
 async create(projectId:string,taskId:string,baseRef?:string):Promise<Worktree>{
  await this.main.validate({requireGit:true});
  const path=this.pathFor(projectId,taskId);
  await this.remove(projectId,taskId);
  await mkdir(join(this.root,projectId),{recursive:true});
  try{
   const base=(await this.main.git(["rev-parse",baseRef??"HEAD"])).stdout.trim();
   await this.main.git(["worktree","add","--detach",path,base]);
   return {path,base,projectId,taskId};
  }catch(error){throw new WorkspaceError("Could not create worktree for "+taskId+": "+(error as Error).message,"WORKTREE_FAILED");}
 }
 async remove(projectId:string,taskId:string){
  const path=this.pathFor(projectId,taskId);
  await this.main.git(["worktree","remove","--force",path]).catch(()=>undefined);
  await rm(path,{recursive:true,force:true});
  await this.main.git(["worktree","prune"]).catch(()=>undefined);
 }
 async list():Promise<Array<{projectId:string;taskId:string;path:string;ageMs:number}>>{
  const out:Array<{projectId:string;taskId:string;path:string;ageMs:number}>=[];
  const projects=await readdir(this.root).catch(()=>[] as string[]);
  for(const projectId of projects)for(const taskId of await readdir(join(this.root,projectId)).catch(()=>[] as string[])){
   const path=join(this.root,projectId,taskId),info=await stat(path).catch(()=>undefined);
   if(info?.isDirectory())out.push({projectId,taskId,path,ageMs:Date.now()-info.mtimeMs});
  }
  return out;
 }
 /** Removes worktrees nobody is using (not in `active`, older than maxAgeMs) and prunes git's records of missing ones. */
 async cleanupStale(active:Set<string>=new Set(),maxAgeMs=0){
  const removed:string[]=[];
  for(const wt of await this.list()){
   if(active.has(wt.projectId+"/"+wt.taskId)||wt.ageMs<maxAgeMs)continue;
   await this.remove(wt.projectId,wt.taskId);removed.push(wt.projectId+"/"+wt.taskId);
  }
  await this.main.git(["worktree","prune"]).catch(()=>undefined);
  return removed;
 }

 /** Cherry-picks a worktree commit onto the main workspace. Conflicts are detected, aborted cleanly and reported. */
 integrate(commitSha:string,files:string[]):Promise<string>{
  return serialised(resolve(this.repo),async()=>{
   const dirty=(await this.main.git(["status","--porcelain","--",...files])).stdout.trim();
   if(dirty)throw new WorkspaceError("Refusing to integrate: the main workspace has uncommitted changes to "+dirty.split("\n").map(l=>l.slice(3)).join(", "),"DIRTY_TARGET");
   try{
    await this.main.git(["cherry-pick",commitSha]);
    return (await this.main.git(["rev-parse","HEAD"])).stdout.trim();
   }catch(error){
    const conflicted=(await this.main.git(["diff","--name-only","--diff-filter=U"]).then(r=>r.stdout.split("\n").filter(Boolean),()=>[]));
    // --abort restores the pre-cherry-pick tree exactly, including any unrelated local edits.
    await this.main.git(["cherry-pick","--abort"]).catch(()=>undefined);
    const files=conflicted.length?conflicted:["(see git output)"];
    throw new WorkspaceError("Integration conflict in "+files.join(", ")+": another task changed the same code","GIT_CONFLICT",files.map(f=>"conflict: "+f)).withMessage((error as Error).message);
   }
  });
 }
 /** Undo an integrated commit with a revert commit (history is preserved; nothing is reset). */
 revert(commitSha:string){return serialised(resolve(this.repo),()=>this.main.git(["revert","--no-edit",commitSha]).then(()=>undefined));}
}

export type IsolatedRun={
 repo:string;stateRoot:string;projectId:string;taskId:string;/** HEAD at the time the model saw the repository; defaults to the current HEAD. */baseSha?:string;patches:FilePatch[];gates:GateRun[];setup:CheckCommandSpec[];
 integrationGates:GateRun[];commitMessage:string;
};

/** The whole isolated flow for one coding task. The worktree is always removed, success or failure. */
export async function runIsolated(run:IsolatedRun):Promise<TransactionResult>{
 const manager=new WorktreeManager(run.repo,join(run.stateRoot,"worktrees")),wt=await manager.create(run.projectId,run.taskId,run.baseSha);
 try{
  const inside=new LocalRepoWorkspace(wt.path);
  if(run.setup.length)await inside.runChecks(run.setup);
  const result=await inside.transaction(run.patches,[],run.commitMessage,{gates:run.gates});
  if(!result.commitSha||!result.changedFiles.length)return {...result,commitSha:undefined};
  const sha=await manager.integrate(result.commitSha,result.changedFiles);
  const evidence=[...result.evidence,"integrated into main as "+sha];
  if(run.integrationGates.some(g=>g.commands.length)){
   try{
    const merged=await new LocalRepoWorkspace(run.repo).runGates(run.integrationGates);
    return {...result,commitSha:sha,evidence:[...evidence,...merged.flatMap(g=>g.checks.map(c=>"integration "+g.name+" "+describeCheck(c)))],gates:[...result.gates,...merged.map(g=>({...g,name:"integration:"+g.name}))]};
   }catch(error){
    await manager.revert(sha);
    throw new WorkspaceError("Integrated change failed its checks on the merged tree and was reverted: "+(error as Error).message,"INTEGRATION_FAILED",[...evidence,"reverted "+sha,...((error as WorkspaceError).evidence??[])]);
   }
  }
  return {...result,commitSha:sha,evidence};
 }finally{await manager.remove(run.projectId,run.taskId);}
}

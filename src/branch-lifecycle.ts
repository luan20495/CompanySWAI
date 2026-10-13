import {execFileSync} from "node:child_process";

// Git branch lifecycle (docs/GIT-BRANCH-LIFECYCLE.md): classify branches and delete a merged, disposable one safely.
// Hard limits: never `-D`/`--force`, never removes a worktree, never touches a protected branch, acts only on the branch it is given.

export type Status="PROTECTED"|"IN_WORKTREE"|"UNMERGED"|"REMOTE_DIVERGED"|"MERGED_PATCH"|"DISPOSABLE";
export type MergeMethod="ancestry"|"patch"|"none";
export interface Worktree{path:string;branch?:string;head:string;main:boolean;dirty:boolean|null}
export interface BranchReport{name:string;ref:string;scope:"local"|"remote";tip:string;status:Status;/** every classification that applies, e.g. MERGED_ANCESTRY */tags:string[];merged:MergeMethod;reason:string;worktree?:{path:string;dirty:boolean|null}}
export interface AuditOptions{repo:string;target:string;remote?:string;protect?:string[];fetch?:boolean}
export interface AuditResult{repo:string;target:string;targetSha:string;remote?:string;branches:BranchReport[];counts:Record<string,number>}
export interface CleanupOptions extends AuditOptions{branch:string;apply?:boolean;pr?:string;next?:string}
export interface CleanupResult{branch:string;target:string;targetSha:string;remote?:string;outcome:"DRY_RUN"|"DONE"|"BLOCKED";exitCode:0|3;pr:string;evidence:string[];remoteStatus:string;localStatus:string;exceptions:string[];next:string;branches:BranchReport[]}

/** Thrown for caller mistakes (unknown target/branch, bad name): the CLI maps it to exit code 2. */
export class UsageError extends Error{}

const NEVER=["main","master","dev","develop","integration/*","release/*","prod*"];

export function git(repo:string,args:string[]):string{
 return execFileSync("git",["-C",repo,...args],{encoding:"utf8",stdio:["ignore","pipe","pipe"],env:{...process.env,GIT_TERMINAL_PROMPT:"0",LC_ALL:"C"},maxBuffer:64*1024*1024}).replace(/\r?\n$/,"");
}
export function tryGit(repo:string,args:string[]):{ok:true;out:string}|{ok:false;err:string}{
 try{return {ok:true,out:git(repo,args)};}
 catch(e){const err=e as {stderr?:Buffer|string;message:string};return {ok:false,err:(String(err.stderr??"").trim()||err.message).split("\n")[0]!};}
}

export function globToRegExp(glob:string):RegExp{
 return new RegExp("^"+[...glob].map(c=>c==="*"?".*":c==="?"?".":c.replace(/[.+^${}()|[\]\\]/g,"\\$&")).join("")+"$");
}
export const matchesAny=(name:string,globs:string[])=>globs.some(g=>globToRegExp(g).test(name));

export function listWorktrees(repo:string):Worktree[]{
 const out:Worktree[]=[];
 for(const block of git(repo,["worktree","list","--porcelain"]).split(/\n\n+/)){
  const lines=block.split("\n"),path=lines.find(l=>l.startsWith("worktree "))?.slice(9);
  if(!path)continue;
  const branch=lines.find(l=>l.startsWith("branch refs/heads/"))?.slice(18),head=lines.find(l=>l.startsWith("HEAD "))?.slice(5)??"";
  const status=lines.includes("bare")?undefined:tryGit(path,["status","--porcelain"]);
  out.push({path,branch,head,main:out.length===0,dirty:status?(status.ok?status.out.length>0:null):false});
 }
 return out;
}

/** `ancestry`: the tip is reachable from the target. `patch`: not reachable, but every commit has a patch-equivalent in the target (git cherry all `-`). Anything else is `none`. */
export function mergeState(repo:string,targetSha:string,tip:string):MergeMethod{
 if(tryGit(repo,["merge-base","--is-ancestor",tip,targetSha]).ok)return "ancestry";
 const cherry=git(repo,["cherry",targetSha,tip]).split("\n").filter(Boolean);
 return cherry.length>0&&cherry.every(l=>l.startsWith("-"))?"patch":"none";
}

interface Context{repo:string;target:string;targetSha:string;remote?:string;worktrees:Worktree[];protect:string[];protectedWhy:Map<string,string>}

function resolveTarget(repo:string,target:string){
 const r=tryGit(repo,["rev-parse","--verify","--quiet",target+"^{commit}"]);
 if(!r.ok)throw new UsageError("target ref not found or not a commit: "+target);
 return r.out;
}
function context(o:AuditOptions):Context{
 if(!o.target||o.target.startsWith("-"))throw new UsageError("--target <ref> is required");
 if(!tryGit(o.repo,["rev-parse","--git-dir"]).ok)throw new UsageError("not a git repository: "+o.repo);
 if(o.remote&&(o.remote.startsWith("-")||!tryGit(o.repo,["remote","get-url",o.remote]).ok))throw new UsageError("unknown remote: "+o.remote);
 if(o.fetch){
  if(!o.remote)throw new UsageError("--fetch needs --remote");
  const f=tryGit(o.repo,["fetch","--prune",o.remote]);
  if(!f.ok)throw new UsageError("git fetch --prune "+o.remote+" failed: "+f.err);
 }
 const targetSha=resolveTarget(o.repo,o.target),worktrees=listWorktrees(o.repo),protectedWhy=new Map<string,string>();
 const mainBranch=worktrees[0]?.branch;
 if(mainBranch)protectedWhy.set(mainBranch,"checked out in the main worktree");
 if(o.remote){
  const head=tryGit(o.repo,["symbolic-ref","--short","refs/remotes/"+o.remote+"/HEAD"]);
  if(head.ok&&head.out.startsWith(o.remote+"/"))protectedWhy.set(head.out.slice(o.remote.length+1),"remote HEAD target");
 }
 protectedWhy.set(o.target,"the merge target");
 if(o.remote&&o.target.startsWith(o.remote+"/"))protectedWhy.set(o.target.slice(o.remote.length+1),"the merge target");
 return {repo:o.repo,target:o.target,targetSha,remote:o.remote,worktrees,protect:[...NEVER,...(o.protect??[])],protectedWhy};
}
const protectedReason=(c:Context,name:string)=>{
 const glob=c.protect.find(g=>globToRegExp(g).test(name));
 return glob?"matches protected pattern "+glob:c.protectedWhy.get(name);
};

function refs(c:Context){
 const local=new Map<string,string>(),remote=new Map<string,string>();
 const rows=git(c.repo,["for-each-ref","--format=%(refname) %(objectname)","refs/heads",...(c.remote?["refs/remotes/"+c.remote]:[])]).split("\n").filter(Boolean);
 for(const row of rows){
  const [ref,sha]=row.split(" ") as [string,string];
  if(ref.startsWith("refs/heads/"))local.set(ref.slice(11),sha);
  else{const name=ref.slice(("refs/remotes/"+c.remote+"/").length);if(name!=="HEAD")remote.set(name,sha);}
 }
 return {local,remote};
}

function classify(c:Context,scope:"local"|"remote",name:string,tip:string,otherTip:string|undefined):BranchReport{
 const own=mergeState(c.repo,c.targetSha,tip),ref=scope==="local"?name:c.remote+"/"+name;
 const tags=[own==="ancestry"?"MERGED_ANCESTRY":own==="patch"?"MERGED_PATCH":"UNMERGED"];
 const base={name,ref,scope,tip,merged:own,tags};
 const other=otherTip&&otherTip!==tip?mergeState(c.repo,c.targetSha,otherTip):own;
 if(other==="none"&&own!=="none")tags.push("REMOTE_DIVERGED");
 const prot=protectedReason(c,name);
 if(prot){tags.unshift("PROTECTED");return {...base,status:"PROTECTED",reason:prot+"; never auto-deleted"};}
 const wt=c.worktrees.find(w=>w.branch===name);
 if(wt){tags.unshift("IN_WORKTREE");return {...base,status:"IN_WORKTREE",worktree:{path:wt.path,dirty:wt.dirty},reason:"checked out in worktree "+wt.path+(wt.dirty===null?" (dirty state unknown)":wt.dirty?" (dirty)":" (clean)")};}
 if(own==="none")return {...base,status:"UNMERGED",reason:"has commits not in "+c.target};
 if(other==="none")return {...base,status:"REMOTE_DIVERGED",reason:(scope==="local"?"remote":"local")+" tip "+otherTip!.slice(0,7)+" differs and is not merged into "+c.target};
 if(own==="patch"||other==="patch")return {...base,status:"MERGED_PATCH",reason:"patch-equivalent in "+c.target+" but not an ancestor; needs operator review"};
 return {...base,status:"DISPOSABLE",reason:"tip is an ancestor of "+c.target};
}

function branchReports(c:Context,only?:string):BranchReport[]{
 const {local,remote}=refs(c),out:BranchReport[]=[];
 const inWt=(r:BranchReport,name:string):BranchReport=>{ // the remote copy of a branch that a worktree uses is in use too
  const wt=c.worktrees.find(w=>w.branch===name);
  return wt&&r.status!=="PROTECTED"&&r.status!=="IN_WORKTREE"?{...r,status:"IN_WORKTREE",tags:["IN_WORKTREE",...r.tags],worktree:{path:wt.path,dirty:wt.dirty},reason:"local branch is checked out in worktree "+wt.path+(wt.dirty===null?" (dirty state unknown)":wt.dirty?" (dirty)":" (clean)")}:r;
 };
 for(const [name,tip] of [...local].sort())if(!only||name===only)out.push(classify(c,"local",name,tip,remote.get(name)));
 for(const [name,tip] of [...remote].sort())if(!only||name===only)out.push(inWt(classify(c,"remote",name,tip,local.get(name)),name));
 return out;
}

export function audit(o:AuditOptions):AuditResult{
 const c=context(o),branches=branchReports(c),counts:Record<string,number>={};
 for(const b of branches)counts[b.status]=(counts[b.status]??0)+1;
 return {repo:o.repo,target:o.target,targetSha:c.targetSha,remote:o.remote,branches,counts};
}

const short=(sha:string)=>sha.slice(0,7);
export function validBranchName(repo:string,name:string){return !!name&&!name.startsWith("-")&&tryGit(repo,["check-ref-format","--branch",name]).ok;}

export function cleanup(o:CleanupOptions):CleanupResult{
 if(!validBranchName(o.repo,o.branch))throw new UsageError("invalid branch name: "+o.branch);
 const c=context(o),rows=branchReports(c,o.branch),local=rows.find(r=>r.scope==="local"),remote=rows.find(r=>r.scope==="remote");
 if(!local&&!remote)throw new UsageError("branch not found (local"+(o.remote?" or "+o.remote:"")+"): "+o.branch);
 const exceptions:string[]=[],pr=o.pr??"(not supplied; operator records the PR/merge commit)";
 const evidence=rows.map(r=>r.ref+" @ "+short(r.tip)+": "+(r.merged==="ancestry"?"ancestor of":r.merged==="patch"?"every commit patch-equivalent (git cherry) in":"NOT merged into")+" "+o.target+" ("+short(c.targetSha)+")");
 const next=o.next?(refs(c).local.has(o.next)||refs(c).remote.has(o.next)?o.next+" (EXCEPTION: name already exists, pick another)":o.next):"(operator names it: fresh, unique, from "+o.target+"; never recycle "+o.branch+")";
 const blocked=(reason:string):CleanupResult=>({branch:o.branch,target:o.target,targetSha:c.targetSha,remote:o.remote,outcome:"BLOCKED",exitCode:3,pr,evidence,remoteStatus:remote?"kept (BLOCKED)":"not applicable (no remote branch)",localStatus:local?"kept (BLOCKED)":"not applicable (no local branch)",exceptions:[reason,...exceptions],next,branches:rows});
 const bad=rows.find(r=>r.status!=="DISPOSABLE"&&r.status!=="MERGED_PATCH")??rows.find(r=>r.status==="MERGED_PATCH");
 if(bad)return blocked(bad.status==="MERGED_PATCH"?"patch-merged: needs operator review ("+bad.ref+")":bad.status+": "+bad.ref+" - "+bad.reason);
 const result=(outcome:"DRY_RUN"|"DONE",localStatus:string,remoteStatus:string):CleanupResult=>({branch:o.branch,target:o.target,targetSha:c.targetSha,remote:o.remote,outcome,exitCode:0,pr,evidence,remoteStatus,localStatus,exceptions,next,branches:rows});
 const plannedLocal=local?"would delete with git branch -d "+o.branch:"not applicable (no local branch)",plannedRemote=remote?"would delete with git push "+o.remote+" --delete "+o.branch+" (only if the live remote tip is still "+short(remote.tip)+")":o.remote?"not applicable (no remote branch)":"not applicable (no --remote)";
 if(!o.apply)return result("DRY_RUN",plannedLocal,plannedRemote);
 // Re-verify the LIVE remote tip before anything is deleted: the remote-tracking ref may be stale.
 let deleteRemote=!!remote,remoteStatus=remote?"":plannedRemote;
 if(remote){
  const live=tryGit(o.repo,["ls-remote","--heads",o.remote!,"refs/heads/"+o.branch]);
  if(!live.ok)return blocked("cannot verify live remote tip: "+live.err);
  const liveTip=live.out.split(/\s+/)[0]??"";
  if(!liveTip){deleteRemote=false;remoteStatus="already absent on "+o.remote+" (stale tracking ref; use --fetch)";}
  else if(liveTip!==remote.tip)return blocked("live remote tip "+short(liveTip)+" differs from the verified merged tip "+short(remote.tip)+"; fetch and re-audit");
 }
 let localStatus=local?"":"not applicable (no local branch)";
 if(local){
  const d=tryGit(o.repo,["branch","-d",o.branch]);
  if(!d.ok)return blocked("git refused branch -d (never retried with -D): "+d.err);
  localStatus="deleted (git branch -d)";
 }
 if(deleteRemote){
  const p=tryGit(o.repo,["push",o.remote!,"--delete",o.branch]);
  if(!p.ok){
   const r=blocked("remote delete failed: "+p.err);
   return {...r,localStatus:local?localStatus+" (before the remote failure)":localStatus};
  }
  remoteStatus="deleted (git push "+o.remote+" --delete)";
 }
 return result("DONE",localStatus,remoteStatus);
}

export function renderAudit(a:AuditResult):string{
 const rows=[["BRANCH","TIP","STATUS","REASON"],...a.branches.map(b=>[b.ref+(b.scope==="remote"?"  [remote]":""),short(b.tip),b.status,b.reason+(b.tags.length>1?" ["+b.tags.join(",")+"]":"")])];
 const w=[0,1,2].map(i=>Math.max(...rows.map(r=>r[i]!.length)));
 const lines=rows.map(r=>[0,1,2].map(i=>r[i]!.padEnd(w[i]!)).join("  ")+"  "+r[3]);
 const counts=Object.entries(a.counts).map(([k,v])=>k+"="+v).join(" ")||"none";
 return "target: "+a.target+" ("+a.targetSha+")"+(a.remote?"  remote: "+a.remote:"")+"\n"+lines.join("\n")+"\ncounts: "+(a.branches.length?counts:"no branches")+" (total "+a.branches.length+")\n";
}

export function renderCleanup(r:CleanupResult):string{
 return [
  "outcome: "+r.outcome+(r.outcome==="DRY_RUN"?" (nothing deleted; pass --apply to act)":r.outcome==="BLOCKED"?" (BLOCKED)":""),
  "source branch: "+r.branch,
  "target: "+r.target+" ("+r.targetSha+")",
  "merge commit/PR: "+r.pr,
  "merge evidence: "+(r.evidence.join("; ")||"none"),
  "remote deletion status: "+r.remoteStatus,
  "local deletion status: "+r.localStatus,
  "exceptions: "+(r.exceptions.join("; ")||"none"),
  "next fresh branch name: "+r.next
 ].join("\n")+"\n";
}

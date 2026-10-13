import assert from "node:assert/strict";
import test from "node:test";
import {execFile,execFileSync} from "node:child_process";
import {writeFile} from "node:fs/promises";
import {join} from "node:path";
import {promisify} from "node:util";
import {audit,cleanup,globToRegExp,mergeState,renderCleanup,UsageError} from "../src/branch-lifecycle.js";
import {tmpDir} from "./helpers.js";

const execFileAsync=promisify(execFile);
const sh=(cwd:string,...args:string[])=>execFileSync("git",args,{cwd,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
const exists=(repo:string,ref:string)=>{try{sh(repo,"rev-parse","--verify","--quiet",ref);return true;}catch{return false;}};
const remoteHas=(repo:string,branch:string)=>sh(repo,"ls-remote","--heads","origin",branch).length>0;

async function commit(repo:string,file:string,text:string){
 await writeFile(join(repo,file),text);
 sh(repo,"add",file);sh(repo,"commit","-q","-m","add "+file);
}
/** A throwaway repo with a bare "remote": main (with one commit) pushed, remote HEAD set. */
async function fixture(){
 const root=await tmpDir("branch-lifecycle-"),bare=join(root,"remote.git"),repo=join(root,"work");
 sh(root,"init","-q","--bare","-b","main",bare);
 sh(root,"init","-q","-b","main",repo);
 sh(repo,"config","user.name","Test");sh(repo,"config","user.email","test@example.invalid");sh(repo,"config","commit.gpgsign","false");
 sh(repo,"remote","add","origin",bare);
 await commit(repo,"README.md","base\n");
 sh(repo,"push","-q","-u","origin","main");
 sh(repo,"remote","set-head","origin","main");
 /** A pushed feature branch with one commit; leaves main checked out. */
 const feature=async(name:string,file=name.replace(/\W/g,"_")+".txt")=>{sh(repo,"checkout","-q","-b",name,"main");await commit(repo,file,name+"\n");sh(repo,"push","-q","-u","origin",name);sh(repo,"checkout","-q","main");};
 const mergeNoFf=(name:string)=>{sh(repo,"merge","-q","--no-ff","-m","merge "+name,name);sh(repo,"push","-q","origin","main");};
 return {root,bare,repo,feature,mergeNoFf,base:{repo,target:"main",remote:"origin"}};
}
const row=(a:ReturnType<typeof audit>,ref:string)=>a.branches.find(b=>b.ref===ref)!;

test("an ancestry-merged branch is DISPOSABLE; a dry run deletes nothing and --apply deletes local and remote with -d only",async()=>{
 const f=await fixture();
 await f.feature("feat/a");f.mergeNoFf("feat/a");
 const a=audit(f.base);
 assert.equal(row(a,"feat/a").status,"DISPOSABLE");assert.ok(row(a,"feat/a").tags.includes("MERGED_ANCESTRY"));
 assert.equal(row(a,"origin/feat/a").status,"DISPOSABLE");
 assert.equal(row(a,"main").status,"PROTECTED");assert.equal(row(a,"origin/main").status,"PROTECTED");
 assert.equal(a.counts.DISPOSABLE,2);

 const dry=cleanup({...f.base,branch:"feat/a"});
 assert.equal(dry.outcome,"DRY_RUN");assert.equal(dry.exitCode,0);
 assert.ok(exists(f.repo,"refs/heads/feat/a")&&remoteHas(f.repo,"feat/a"));

 const done=cleanup({...f.base,branch:"feat/a",apply:true,pr:"PR #7",next:"feature/next-thing"});
 assert.equal(done.outcome,"DONE");assert.equal(done.exitCode,0);
 assert.match(done.localStatus,/deleted/);assert.match(done.remoteStatus,/deleted/);
 assert.ok(!exists(f.repo,"refs/heads/feat/a"));assert.ok(!remoteHas(f.repo,"feat/a"));
 const report=renderCleanup(done);
 for(const field of ["source branch:","target: main (","merge commit/PR: PR #7","remote deletion status:","local deletion status:","exceptions: none","next fresh branch name: feature/next-thing"])assert.ok(report.includes(field),field);
 assert.ok(exists(f.repo,"refs/heads/main")&&remoteHas(f.repo,"main"),"main untouched");
});

test("an unmerged branch is UNMERGED and cleanup is BLOCKED with nothing deleted",async()=>{
 const f=await fixture();
 await f.feature("feat/wip");
 assert.equal(row(audit(f.base),"feat/wip").status,"UNMERGED");
 const r=cleanup({...f.base,branch:"feat/wip",apply:true});
 assert.equal(r.outcome,"BLOCKED");assert.equal(r.exitCode,3);assert.match(r.exceptions[0]!,/UNMERGED/);
 assert.ok(exists(f.repo,"refs/heads/feat/wip")&&remoteHas(f.repo,"feat/wip"));
});

test("a branch checked out in a linked worktree is IN_WORKTREE (clean or dirty) and is kept",async()=>{
 const f=await fixture(),wt=join(f.root,"wt");
 sh(f.repo,"worktree","add","-q","-b","feat/wt",wt,"main");
 let w=row(audit(f.base),"feat/wt");
 assert.equal(w.status,"IN_WORKTREE");assert.ok(w.tags.includes("MERGED_ANCESTRY"));assert.equal(w.worktree?.dirty,false);assert.match(w.reason,/clean/);
 await writeFile(join(wt,"scratch.txt"),"uncommitted\n");
 w=row(audit(f.base),"feat/wt");
 assert.equal(w.worktree?.dirty,true);assert.match(w.reason,/dirty/);assert.ok(w.worktree?.path.endsWith("wt"));
 const r=cleanup({...f.base,branch:"feat/wt",apply:true});
 assert.equal(r.exitCode,3);assert.ok(exists(f.repo,"refs/heads/feat/wt"));assert.ok(exists(wt,"HEAD"),"worktree untouched");
});

test("main, dev, integration/x, release/x and --protect globs are PROTECTED even when merged, and --apply refuses them",async()=>{
 const f=await fixture();
 for(const b of ["dev","integration/x","release/x","keep/me","prod-eu"]){sh(f.repo,"branch",b,"main");sh(f.repo,"push","-q","origin",b);}
 const a=audit({...f.base,protect:["keep/*"]});
 for(const b of ["main","dev","integration/x","release/x","keep/me","prod-eu"]){assert.equal(row(a,b).status,"PROTECTED",b);assert.equal(row(a,"origin/"+b).status,"PROTECTED","origin/"+b);}
 assert.equal(audit(f.base).branches.find(b=>b.ref==="keep/me")?.status,"DISPOSABLE","without --protect keep/me is an ordinary merged branch");
 for(const b of ["dev","integration/x","release/x","main"]){
  const r=cleanup({...f.base,branch:b,apply:true});
  assert.equal(r.exitCode,3,b);assert.ok(exists(f.repo,"refs/heads/"+b)&&remoteHas(f.repo,b),b);
 }
 assert.ok(globToRegExp("release/*").test("release/1.2")&&!globToRegExp("release/*").test("xrelease/1"));
});

test("the merge target and the remote HEAD target are protected by name",async()=>{
 const f=await fixture();
 sh(f.repo,"branch","trunk","main");sh(f.repo,"push","-q","origin","trunk");
 const a=audit({...f.base,target:"origin/trunk"});
 assert.equal(row(a,"trunk").status,"PROTECTED");assert.match(row(a,"trunk").reason,/merge target/);
 assert.equal(row(a,"main").status,"PROTECTED");
});

test("a squash-merged branch is MERGED_PATCH via cherry and cleanup reports BLOCKED instead of force-deleting",async()=>{
 const f=await fixture();
 await f.feature("feat/sq");
 sh(f.repo,"merge","-q","--squash","feat/sq");sh(f.repo,"commit","-q","-m","squash feat/sq");sh(f.repo,"push","-q","origin","main");
 assert.equal(mergeState(f.repo,sh(f.repo,"rev-parse","main"),sh(f.repo,"rev-parse","feat/sq")),"patch");
 assert.equal(row(audit(f.base),"feat/sq").status,"MERGED_PATCH");
 const r=cleanup({...f.base,branch:"feat/sq",apply:true});
 assert.equal(r.outcome,"BLOCKED");assert.equal(r.exitCode,3);assert.match(r.exceptions[0]!,/patch-merged: needs operator review/);
 assert.ok(exists(f.repo,"refs/heads/feat/sq")&&remoteHas(f.repo,"feat/sq"));
});

test("a remote tip ahead of the merged local tip is REMOTE_DIVERGED and blocks the delete; a stale tracking ref is caught by the live check",async()=>{
 const f=await fixture();
 await f.feature("feat/b");f.mergeNoFf("feat/b");
 const other=join(f.root,"other");
 sh(f.root,"clone","-q",f.bare,other);sh(other,"config","user.name","Other");sh(other,"config","user.email","o@example.invalid");sh(other,"config","commit.gpgsign","false");
 sh(other,"checkout","-q","feat/b");await commit(other,"extra.txt","later work\n");sh(other,"push","-q","origin","feat/b");

 // Tracking ref is stale: both rows look disposable, the live remote tip says otherwise.
 assert.equal(row(audit(f.base),"feat/b").status,"DISPOSABLE");
 const stale=cleanup({...f.base,branch:"feat/b",apply:true});
 assert.equal(stale.exitCode,3);assert.match(stale.exceptions[0]!,/live remote tip/);
 assert.ok(exists(f.repo,"refs/heads/feat/b")&&remoteHas(f.repo,"feat/b"),"nothing deleted");

 // After a fetch the divergence is visible in the audit itself.
 const a=audit({...f.base,fetch:true});
 assert.equal(row(a,"feat/b").status,"REMOTE_DIVERGED");assert.equal(row(a,"origin/feat/b").status,"UNMERGED");
 const r=cleanup({...f.base,branch:"feat/b",apply:true});
 assert.equal(r.exitCode,3);assert.ok(exists(f.repo,"refs/heads/feat/b")&&remoteHas(f.repo,"feat/b"));
});

test("usage errors: unknown branch, unknown target, option-looking branch, missing remote",async()=>{
 const f=await fixture();
 assert.throws(()=>cleanup({...f.base,branch:"no/such"}),UsageError);
 assert.throws(()=>cleanup({...f.base,branch:"--force"}),UsageError);
 assert.throws(()=>audit({...f.base,target:"nope"}),UsageError);
 assert.throws(()=>audit({...f.base,remote:"nope"}),UsageError);
 assert.throws(()=>audit({repo:f.repo,target:"main",fetch:true}),UsageError);
});

test("CLI end to end: audit --json, dry run, --apply, exit codes 0/3/2",async()=>{
 const f=await fixture();
 await f.feature("feat/cli");f.mergeNoFf("feat/cli");await f.feature("feat/open");
 const cli=async(...args:string[])=>{
  try{const r=await execFileAsync("npx",["tsx","src/branches-cli.ts",...args],{cwd:process.cwd()});return {code:0,out:r.stdout,err:r.stderr};}
  catch(e){const x=e as {code:number;stdout:string;stderr:string};return {code:x.code,out:x.stdout,err:x.stderr};}
 };
 const common=["--target","main","--remote","origin"];
 const a=await cli("audit",f.repo,...common,"--json");
 assert.equal(a.code,0);
 const json=JSON.parse(a.out) as ReturnType<typeof audit>;
 assert.equal(json.branches.find(b=>b.ref==="feat/cli")?.status,"DISPOSABLE");assert.equal(json.branches.find(b=>b.ref==="feat/open")?.status,"UNMERGED");
 const table=await cli("audit",f.repo,...common);
 assert.match(table.out,/BRANCH\s+TIP\s+STATUS\s+REASON/);assert.match(table.out,/counts:/);

 const dry=await cli("cleanup",f.repo,"feat/cli",...common);
 assert.equal(dry.code,0);assert.match(dry.out,/DRY_RUN/);assert.ok(exists(f.repo,"refs/heads/feat/cli"));
 const blocked=await cli("cleanup",f.repo,"feat/open",...common,"--apply");
 assert.equal(blocked.code,3);assert.ok(exists(f.repo,"refs/heads/feat/open"));
 const done=await cli("cleanup",f.repo,"feat/cli",...common,"--apply");
 assert.equal(done.code,0);assert.match(done.out,/local deletion status: deleted/);
 assert.ok(!exists(f.repo,"refs/heads/feat/cli")&&!remoteHas(f.repo,"feat/cli"));
 assert.equal((await cli("cleanup",f.repo,"missing",...common)).code,2);
 assert.equal((await cli("audit",f.repo)).code,2);
 assert.equal((await cli("cleanup",f.repo,"feat/cli",...common,"--force")).code,2);
});

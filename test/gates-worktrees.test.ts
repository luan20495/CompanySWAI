import assert from "node:assert/strict";
import test from "node:test";
import {execFileSync} from "node:child_process";
import {existsSync} from "node:fs";
import {mkdir,mkdtemp,readFile,readdir,utimes,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {ProjectOrchestrator} from "../src/orchestrator.js";
import {WorktreeManager} from "../src/worktrees.js";
import {plan,selectorFor,task,tmpState,usage} from "./helpers.js";

const git=(cwd:string,...args:string[])=>execFileSync("git",args,{cwd,encoding:"utf8"}).trim();
async function repo(files:Record<string,string>={"README.md":"base\n"}){
 const root=await mkdtemp(join(tmpdir(),"companyswai-wt-"));
 git(root,"init","-q","-b","main");git(root,"config","user.email","t@example.test");git(root,"config","user.name","T");git(root,"config","commit.gpgsign","false");
 for(const [name,content] of Object.entries(files)){await mkdir(join(root,name,".."),{recursive:true});await writeFile(join(root,name),content);}
 git(root,"add","-A");git(root,"commit","-qm","base");return root;
}
const block=(path:string,content:string)=>"## Deliverables\n```file "+path+"\n"+content+"\n```\n\n## Decisions\nNone.\n\n## Evidence\nwrote "+path+"\n\n## Blockers\nNone.\n\n## Handoff\nnext";
const node=(code:string)=>({cmd:"node",args:["-e",code]});
const ok=node("process.exit(0)"),fail=node("console.error('gate failed');process.exit(1)");
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));

test("code is only done when every required gate passed; gate results are recorded per gate",async()=>{
 const root=await repo(),state=await tmpState();
 const workspace={path:root,checks:[ok],gates:{typecheck:[ok],"unit-tests":[ok],lint:[]},autoCommit:true};
 const t=task("impl",{requiredGates:["typecheck","unit-tests","lint","project-checks"]});
 const summary=await new ProjectOrchestrator(selectorFor(()=>usage(block("src/a.ts","export const a=1;"))),state).run(plan("g1",[t],{workspace}));
 assert.deepEqual(summary.completed,["impl"]);
 const record=(await state.executions.list("g1")).find(r=>r.status==="SUCCEEDED")!;
 assert.deepEqual(record.gates.map(g=>[g.name,g.status]),[["typecheck","PASS"],["unit-tests","PASS"],["lint","NOT_APPLICABLE"],["project-checks","PASS"]]);
 assert.ok(record.evidence.some(e=>e.startsWith("gate typecheck check: node")));assert.equal(record.commitSha,git(root,"rev-parse","HEAD"));
});

test("a required gate that is not configured fails the task before anything is written",async()=>{
 const root=await repo(),state=await tmpState();
 const workspace={path:root,checks:[ok],gates:{typecheck:[ok]},autoCommit:false};
 const summary=await new ProjectOrchestrator(selectorFor(()=>usage(block("src/a.ts","x"))),state).run(plan("g2",[task("impl",{requiredGates:["typecheck","unit-tests","security"]})],{workspace}));
 assert.deepEqual(summary.failed,["impl"]);
 assert.equal(existsSync(join(root,"src/a.ts")),false);assert.equal(git(root,"status","--porcelain"),"");
 const failed=(await state.executions.list("g2")).find(r=>r.status==="FAILED")!;
 assert.match(failed.error??"",/not configured: unit-tests, security/);assert.deepEqual(failed.gates.map(g=>[g.name,g.status]),[["unit-tests","NOT_CONFIGURED"],["security","NOT_CONFIGURED"]]);
 assert.match(await state.memory.read("g2","BLOCKERS.md"),/not configured/);
});

test("generated code that fails a gate is rolled back and never counted as done",async()=>{
 const root=await repo(),state=await tmpState();
 const workspace={path:root,checks:[ok],gates:{typecheck:[ok],"unit-tests":[fail]},autoCommit:true};
 const summary=await new ProjectOrchestrator(selectorFor(()=>usage(block("src/a.ts","broken"))),state).run(plan("g3",[task("impl",{requiredGates:["typecheck","unit-tests","project-checks"]})],{workspace}));
 assert.deepEqual(summary.failed,["impl"]);assert.equal(existsSync(join(root,"src/a.ts")),false);assert.equal(git(root,"log","--oneline").split("\n").length,1);
 const failed=(await state.executions.list("g3")).find(r=>r.status==="FAILED")!;
 assert.deepEqual(failed.gates.map(g=>[g.name,g.status]),[["typecheck","PASS"],["unit-tests","FAIL"]],"later gates are not run after a failure");
 assert.ok(failed.evidence.some(e=>/gate unit-tests/.test(e)));
});

test("parallel coding tasks each run their gates in their own worktree and are integrated into main",async()=>{
 const root=await repo(),state=await tmpState(),seen=await mkdtemp(join(tmpdir(),"companyswai-seen-"));
 const check={cmd:"node",args:["-e","const fs=require('fs'),path=require('path');fs.writeFileSync("+JSON.stringify(seen)+"+'/'+path.basename(process.cwd())+'.json',JSON.stringify({cwd:process.cwd(),files:fs.readdirSync('.').filter(f=>!f.startsWith('.git'))}))"]};
 const workspace={path:root,checks:[],gates:{"unit-tests":[check]},autoCommit:true,isolation:"worktree" as const};
 const selector=selectorFor(async request=>{await sleep(request.prompt.startsWith("alpha")?60:5);return usage(block(request.prompt.startsWith("alpha")?"src/alpha.ts":"src/beta.ts",request.prompt.split(" ")[0]));},[{id:"p",maxConcurrency:4}]);
 const summary=await new ProjectOrchestrator(selector,state,{maxParallelTasks:4}).run(plan("wt1",[task("alpha",{prompt:"alpha work",requiredGates:["unit-tests"]}),task("beta",{prompt:"beta work",requiredGates:["unit-tests"]})],{workspace}));
 assert.deepEqual(summary.completed.sort(),["alpha","beta"]);
 assert.equal(await readFile(join(root,"src/alpha.ts"),"utf8"),"alpha\n");assert.equal(await readFile(join(root,"src/beta.ts"),"utf8"),"beta\n");
 const ran=await Promise.all((await readdir(seen)).map(async f=>JSON.parse(await readFile(join(seen,f),"utf8"))as {cwd:string;files:string[]}));
 assert.equal(ran.length,2);
 for(const r of ran)assert.match(r.cwd,/worktrees\/wt1\/(alpha|beta)$/);
 const alpha=ran.find(r=>r.cwd.endsWith("alpha"))!,beta=ran.find(r=>r.cwd.endsWith("beta"))!;
 assert.ok(alpha.files.includes("src")&&beta.files.includes("src"));
 assert.notEqual(alpha.cwd,beta.cwd);
 assert.equal(git(root,"log","--oneline").split("\n").length,3,"base + two integrated commits");
 assert.equal(git(root,"branch","--list").replace(/[* ]/g,""),"main","worktrees are detached: no branches are created");
 assert.deepEqual(await new WorktreeManager(root,join(state.root,"worktrees")).list(),[],"worktrees are cleaned up");
 assert.equal(git(root,"worktree","list").split("\n").length,1);
 const records=(await state.executions.list("wt1")).filter(r=>r.status==="SUCCEEDED");
 assert.ok(records.every(r=>r.commitSha&&r.changedFiles.length===1&&r.evidence.some(e=>/integrated into main/.test(e))));
});

test("a task cannot see or mutate another task's workspace while both are in flight",async()=>{
 const root=await repo(),state=await tmpState();
 const peek=(label:string)=>({cmd:"node",args:["-e","const fs=require('fs');fs.appendFileSync("+JSON.stringify(join(state.root,"peek.log"))+","+JSON.stringify(label)+"+':'+JSON.stringify(fs.readdirSync('src').sort())+'\\n')"]});
 await mkdir(state.root,{recursive:true});
 const workspace={path:root,checks:[],gates:{"unit-tests":[peek("both")]},autoCommit:true,isolation:"worktree" as const};
 // both tasks are in flight at the same moment: each worktree only ever contains its own new file
 const selector=selectorFor(async request=>{await sleep(30);const name=request.prompt.split(" ")[0];return usage(block("src/"+name+".ts",name));},[{id:"p",maxConcurrency:4}]);
 const summary=await new ProjectOrchestrator(selector,state,{maxParallelTasks:4}).run(plan("wt2",[task("one",{prompt:"one work",requiredGates:["unit-tests"]}),task("two",{prompt:"two work",requiredGates:["unit-tests"]})],{workspace}));
 assert.deepEqual(summary.completed.sort(),["one","two"]);
 const log=(await readFile(join(state.root,"peek.log"),"utf8")).trim().split("\n");
 const both=log.filter(l=>l.includes("one.ts")&&l.includes("two.ts"));
 assert.deepEqual(both,[],"no worktree ever contained both tasks' files: "+log.join(" | "));
});

test("conflicting parallel changes are detected, rolled back cleanly and re-asked against the new repository state",async()=>{
 const root=await repo({"README.md":"base\n","shared.txt":"base line\n"}),state=await tmpState();
 const prompts:string[]=[];
 const selector=selectorFor(async request=>{
  prompts.push(request.prompt);
  const who=request.prompt.split(" ")[0];
  if(who==="late"){await sleep(120);return usage(block(/INTEGRATION CONFLICT/.test(request.prompt)?"late-only.txt":"shared.txt",/INTEGRATION CONFLICT/.test(request.prompt)?"late retry":"late version"));}
  return usage(block("shared.txt","early version"));
 },[{id:"p",maxConcurrency:4}]);
 const workspace={path:root,checks:[],gates:{"unit-tests":[ok]},autoCommit:true,isolation:"worktree" as const};
 const summary=await new ProjectOrchestrator(selector,state,{maxParallelTasks:4}).run(plan("wt3",[task("early",{prompt:"early work",priority:5,requiredGates:["unit-tests"]}),task("late",{prompt:"late work",requiredGates:["unit-tests"]})],{workspace}));
 assert.deepEqual(summary.completed.sort(),["early","late"],"the conflicting task recovered after being re-asked");
 assert.equal(await readFile(join(root,"shared.txt"),"utf8"),"early version\n");assert.equal(await readFile(join(root,"late-only.txt"),"utf8"),"late retry\n");
 assert.ok(prompts.some(p=>/INTEGRATION CONFLICT[\s\S]*shared\.txt/.test(p)));
 assert.equal(git(root,"status","--porcelain"),"");assert.equal(git(root,"worktree","list").split("\n").length,1);
 assert.match(await state.memory.read("wt3","STATUS.md"),/INTEGRATION_CONFLICT/);
 const failed=(await state.executions.list("wt3")).filter(r=>r.status==="FAILED");assert.equal(failed.length,1);assert.match(failed[0].error??"",/Integration conflict in shared\.txt/);
});

test("an integrated change that fails its checks on the merged tree is reverted",async()=>{
 const root=await repo(),state=await tmpState();
 await writeFile(join(root,".integration-fail"),"x");
 const guard=node("process.exit(require('fs').existsSync('.integration-fail')?1:0)");
 const workspace={path:root,checks:[guard],gates:{"unit-tests":[ok]},autoCommit:true,isolation:"worktree" as const};
 const summary=await new ProjectOrchestrator(selectorFor(()=>usage(block("src/a.ts","x"))),state).run(plan("wt4",[task("impl",{requiredGates:["unit-tests"]})],{workspace}));
 assert.deepEqual(summary.failed,["impl"]);
 assert.equal(existsSync(join(root,"src/a.ts")),false,"the integrated commit was reverted");
 assert.match(git(root,"log","--oneline"),/Revert/);assert.equal(git(root,"status","--porcelain"),"?? .integration-fail");
 const failed=(await state.executions.list("wt4")).find(r=>r.status==="FAILED")!;assert.match(failed.error??"",/reverted/);
});

test("integration refuses to overwrite uncommitted local edits in the main workspace",async()=>{
 const root=await repo({"README.md":"base\n"}),state=await tmpState();
 const selector=selectorFor(async()=>{await writeFile(join(root,"README.md"),"my local edit\n");return usage(block("README.md","agent change"));});
 const workspace={path:root,checks:[],gates:{"unit-tests":[ok]},autoCommit:true,isolation:"worktree" as const};
 const summary=await new ProjectOrchestrator(selector,state).run(plan("wt5",[task("impl",{requiredGates:["unit-tests"]})],{workspace}));
 assert.deepEqual(summary.failed,["impl"]);assert.equal(await readFile(join(root,"README.md"),"utf8"),"my local edit\n");
 assert.match((await state.executions.list("wt5")).find(r=>r.status==="FAILED")!.error??"",/uncommitted changes/);
});

test("stale worktrees are found and cleaned up, active ones are kept",async()=>{
 const root=await repo(),state=await tmpState(),manager=new WorktreeManager(root,join(state.root,"worktrees"));
 const a=await manager.create("p","stale-task"),b=await manager.create("p","active-task");
 assert.equal((await manager.list()).length,2);assert.ok(existsSync(join(a.path,"README.md")));
 const old=new Date(Date.now()-3*3600_000);await utimes(a.path,old,old);
 assert.deepEqual(await manager.cleanupStale(new Set(["p/active-task"]),3600_000),["p/stale-task"]);
 assert.equal(existsSync(a.path),false);assert.equal(existsSync(b.path),true);
 assert.deepEqual(await manager.cleanupStale(new Set(),0),["p/active-task"]);assert.equal(git(root,"worktree","list").split("\n").length,1);
 const again=await manager.create("p","stale-task");const second=await manager.create("p","stale-task");assert.equal(again.path,second.path,"a leftover worktree is replaced on re-creation");
 await manager.remove("p","stale-task");
});

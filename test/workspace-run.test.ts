import assert from "node:assert/strict";
import test from "node:test";
import {execFileSync} from "node:child_process";
import {mkdtemp,readFile,stat,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {ProjectOrchestrator} from "../src/orchestrator.js";
import {compliant,isReviewRequest,pass,plan,reviewer,selectorFor,task,tmpState,usage} from "./helpers.js";

const git=(cwd:string,...args:string[])=>execFileSync("git",args,{cwd,encoding:"utf8"}).trim();
async function repo(){
 const root=await mkdtemp(join(tmpdir(),"companyswai-wsrun-"));
 git(root,"init","-q");git(root,"config","user.email","t@example.test");git(root,"config","user.name","T");git(root,"config","commit.gpgsign","false");
 await writeFile(join(root,"README.md"),"base\n");git(root,"add","-A");git(root,"commit","-qm","base");return root;
}
const fileBlock=(path:string,content:string)=>"## Deliverables\n```file "+path+"\n"+content+"\n```\n\n## Decisions\nNone.\n\n## Evidence\nwrote "+path+"\n\n## Blockers\nNone.\n\n## Handoff\nnext";
const exists=(path:string)=>stat(path).then(()=>true,()=>false);
const okCheck=[{cmd:"node",args:["-e","process.exit(0)"]}],badCheck=[{cmd:"node",args:["-e","console.error('lint failed');process.exit(1)"]}];

test("agent file blocks are applied transactionally, checked, committed and recorded; resume does not recommit",async()=>{
 const root=await repo(),state=await tmpState(),before=git(root,"rev-parse","HEAD");
 const selector=selectorFor(request=>usage(isReviewRequest(request)?pass():fileBlock("src/hello.ts","export const hello=1;")));
 const p=plan("ws",[task("impl",{review:reviewer(),deliversCode:true})],{workspace:{path:root,checks:okCheck,autoCommit:true}});
 const summary=await new ProjectOrchestrator(selector,state).run(p);
 assert.deepEqual(summary.completed,["impl"]);
 const record=(await state.executions.list("ws")).find(r=>r.taskId==="impl"&&r.status==="SUCCEEDED")!;
 assert.deepEqual(record.changedFiles,["src/hello.ts"]);assert.equal(record.commitSha,git(root,"rev-parse","HEAD"));assert.notEqual(record.commitSha,before);
 assert.match(record.evidence[0],/check: node/);assert.ok(record.artifactRefs.includes("commit:"+record.commitSha));
 assert.equal(await readFile(join(root,"src/hello.ts"),"utf8"),"export const hello=1;\n");
 assert.match(git(root,"log","-1","--format=%s"),/CompanySWAI: impl/);
 const head=git(root,"rev-parse","HEAD");
 await new ProjectOrchestrator(selectorFor(()=>{throw new Error("no model on resume");}),state).run(p);
 assert.equal(git(root,"rev-parse","HEAD"),head);
});

test("a failing deterministic check rolls the repo back and records evidence on a FAILED execution",async()=>{
 const root=await repo(),state=await tmpState();
 const selector=selectorFor(()=>usage(fileBlock("README.md","agent rewrite")));
 const summary=await new ProjectOrchestrator(selector,state).run(plan("wf",[task("impl",{deliversCode:true})],{workspace:{path:root,checks:badCheck,autoCommit:true}}));
 assert.deepEqual(summary.failed,["impl"]);
 assert.equal(await readFile(join(root,"README.md"),"utf8"),"base\n");assert.equal(git(root,"status","--porcelain"),"");
 const failed=(await state.executions.list("wf")).find(r=>r.status==="FAILED")!;
 assert.match(failed.error??"",/Deterministic check failed/);assert.ok(failed.evidence.some(e=>/exit 1/.test(e)));assert.ok(failed.actualCost==null||failed.actualCost>=0);
 assert.match(await state.memory.read("wf","BLOCKERS.md"),/Deterministic check failed/);
});

test("unsafe paths, missing workspace configuration and reviewer file blocks never touch the filesystem",async()=>{
 const root=await repo();
 const escape=await new ProjectOrchestrator(selectorFor(()=>usage(fileBlock("../outside.txt","x"))),await tmpState()).run(plan("u1",[task("impl")],{workspace:{path:root,checks:[],autoCommit:false}}));
 assert.deepEqual(escape.failed,["impl"]);assert.equal(await exists(join(root,"..","outside.txt")),false);
 const none=await new ProjectOrchestrator(selectorFor(()=>usage(fileBlock("a.txt","x"))),await tmpState()).run(plan("u2",[task("impl")]));
 assert.deepEqual(none.failed,["impl"]);
 const reviewed=await new ProjectOrchestrator(selectorFor(request=>usage(isReviewRequest(request)?"PASS\n\n## Evidence\nok\n\n```file reviewer-wrote.txt\nx\n```\n\n## Blockers\nNone.":compliant("no files"))),await tmpState()).run(plan("u3",[task("impl",{review:reviewer()})],{workspace:{path:root,checks:[],autoCommit:false}}));
 assert.deepEqual(reviewed.completed,["impl"]);assert.equal(await exists(join(root,"reviewer-wrote.txt")),false);
});

test("a missing workspace directory or non-git autoCommit workspace is rejected before any model call",async()=>{
 let calls=0;const selector=selectorFor(()=>{calls++;return usage(compliant());});
 await assert.rejects(async()=>new ProjectOrchestrator(selector,await tmpState()).run(plan("v",[task("a")],{workspace:{path:"/definitely/not/here",checks:[],autoCommit:false}})),/does not exist/);
 const plain=await mkdtemp(join(tmpdir(),"companyswai-plain-"));
 await assert.rejects(async()=>new ProjectOrchestrator(selector,await tmpState()).run(plan("v2",[task("a")],{workspace:{path:plain,checks:[],autoCommit:true}})),/git repository/);
 assert.equal(calls,0);
});

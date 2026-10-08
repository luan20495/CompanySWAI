import assert from "node:assert/strict";
import test from "node:test";
import {runBenchmark} from "../src/benchmark.js";

test("the deterministic benchmark project passes every invariant and reports its metrics",async()=>{
 const report=await runBenchmark();
 assert.deepEqual(report.failures,[]);assert.equal(report.ok,true);
 assert.equal(report.agents.declared,11);assert.equal(report.tasks.succeeded,report.tasks.planned);assert.equal(report.tasks.failed,0);
 assert.ok(report.reviews.revisions>=1&&report.reviews.runs>report.tasks.planned,"double review plus a forced revision");
 assert.ok(report.retries>=1&&report.failovers>=1);
 assert.deepEqual(report.resume.firstRunFailed,["qa-engineer"]);assert.equal(report.resume.correct,true);assert.equal(report.resume.duplicateWork,0);
 assert.ok(Object.keys(report.providers).length>=2);
 assert.ok(report.gates.passed>0&&report.gates.failed===0&&report.gates.worktreeCommits>0);
 assert.equal(report.traceability.qa,"PASS");assert.ok(report.qaRework.rounds>=1&&report.qaRework.requests>=2,"the QA fail -> owner rework -> re-verify loop ran");assert.ok(report.traceability.requirements>0&&report.traceability.citations>0&&report.traceability.decisions>0);
 assert.ok(report.final.status.startsWith("ACCEPTED"));assert.ok(report.runtimeMs>0&&report.usage.inputTokens>0&&report.usage.knownCost>0);
});

test("the live benchmark's gates are real: they pass a working project and fail on syntax errors or missing tests",async()=>{
 const {liveGates}=await import("../src/benchmark.js");
 const {LocalRepoWorkspace}=await import("../src/repo-workspace.js");
 const {mkdtemp,writeFile,mkdir}=await import("node:fs/promises");const {tmpdir}=await import("node:os");const {join}=await import("node:path");
 const gates=liveGates(),run=async(files:Record<string,string>)=>{
  const dir=await mkdtemp(join(tmpdir(),"companyswai-realgates-"));await mkdir(join(dir,"test"),{recursive:true});
  await writeFile(join(dir,"package.json"),'{"type":"module"}');for(const [name,content] of Object.entries(files)){await mkdir(join(dir,name,".."),{recursive:true});await writeFile(join(dir,name),content);}
  return new LocalRepoWorkspace(dir).runGates([{name:"typecheck",commands:gates.gates.typecheck},{name:"unit-tests",commands:gates.gates["unit-tests"]}]);
 };
 const good={"src/index.js":"export const add=(a,b)=>a+b;\n","test/add.test.js":"import test from 'node:test';import assert from 'node:assert/strict';import {add} from '../src/index.js';test('adds',()=>assert.equal(add(1,2),3));\n"};
 assert.deepEqual((await run(good)).map(g=>g.status),["PASS","PASS"]);
 await assert.rejects(()=>run({...good,"src/index.js":"export const add=(a,b)=>{\n"}),/typecheck/);
 await assert.rejects(()=>run({"src/index.js":good["src/index.js"]}),/unit-tests/);
 await assert.rejects(()=>run({...good,"test/add.test.js":good["test/add.test.js"].replace("3","4")}),/unit-tests/);
});

test("the Node.js 18 criterion is verified by a real gate when a Node 18 runtime exists, and otherwise stated as BLOCKED policy",async()=>{
 const {findNode18,liveGates,nodeSupportPolicy}=await import("../src/benchmark.js");
 const node18=findNode18();
 assert.match(nodeSupportPolicy(node18),node18?/executes the whole test suite under both runtimes/:/must be classified BLOCKED/);
 assert.match(nodeSupportPolicy(undefined),/BLOCKED by QA, never PASS/);
 assert.equal(liveGates(undefined).gates["unit-tests"].length,1);assert.equal(liveGates("/x/node18").gates["unit-tests"].length,2);
 if(!node18)return;
 // run the gate for real on a tiny project under both runtimes via a node18 shim on PATH
 const {LocalRepoWorkspace}=await import("../src/repo-workspace.js");
 const {mkdtemp,writeFile,mkdir,symlink}=await import("node:fs/promises");const {tmpdir}=await import("node:os");const {join,delimiter}=await import("node:path");
 const bin=await mkdtemp(join(tmpdir(),"companyswai-n18test-"));await symlink(node18,join(bin,"node18"));
 const dir=await mkdtemp(join(tmpdir(),"companyswai-n18proj-"));await mkdir(join(dir,"test"));await writeFile(join(dir,"package.json"),'{"type":"module"}');
 await writeFile(join(dir,"test","a.test.js"),"import test from 'node:test';import assert from 'node:assert/strict';test('v',()=>assert.ok(process.version.length>0));\n");
 const old=process.env.PATH;process.env.PATH=bin+delimiter+old;
 try{
  const [gate]=await new LocalRepoWorkspace(dir).runGates([{name:"unit-tests",commands:liveGates(node18).gates["unit-tests"]}]);
  assert.equal(gate.status,"PASS");assert.equal(gate.checks.length,2);
  assert.match(gate.checks[1].output,/\[node18\]/,"the second check really ran the suite through node18");
 }finally{process.env.PATH=old;}
});

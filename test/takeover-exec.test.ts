import assert from "node:assert/strict";
import test from "node:test";
import {execFile} from "node:child_process";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {promisify} from "node:util";
import {AgentClassification,assessClassification} from "../src/takeover-evidence.js";
import {ExecRecord,executedFor,gateRecord,junitClassOfPath,junitRecords,loadLedger,lookupOf,recordExec,usableFor,type ExecRecordValue} from "../src/takeover-exec.js";
import {TakeoverError,fingerprint,changedParts,takeSnapshot} from "../src/takeover-probe.js";
import {TAKEOVER_TASKS,buildTakeoverPlan} from "../src/takeover-plan.js";
import {runTakeover} from "../src/takeover.js";
import {compliant,isReviewRequest,pass,selectorFor,tmpDir,tmpState,usage} from "./helpers.js";
const run=promisify(execFile);

const G=(cwd:string,...args:string[])=>run("git",["-c","user.name=T","-c","user.email=t@example.com","-c","commit.gpgsign=false",...args],{cwd}).then(r=>r.stdout.trim());
const TEST_PATH="backend/src/test/kotlin/com/shop/checkout/CheckoutTests.kt",OTHER_TEST="backend/src/test/kotlin/com/shop/refunds/RefundTests.kt";

async function target(){
 const root=await tmpDir("exec-target-");await G(root,"init","-q","-b","main");
 const files:Record<string,string>={
  "README.md":"# Shop\n","docs/STATUS.md":"# Status\n- [x] checkout\n",
  "backend/src/main/kotlin/com/shop/checkout/Checkout.kt":"class Checkout\n","backend/src/main/kotlin/com/shop/refunds/Refund.kt":"class Refund\n",
  [TEST_PATH]:"class CheckoutTests\n",[OTHER_TEST]:"class RefundTests\n"
 };
 for(const [path,content] of Object.entries(files)){await mkdir(join(root,path,".."),{recursive:true});await writeFile(join(root,path),content);}
 await G(root,"add","-A");await G(root,"commit","-q","-m","shop");
 return root;
}
const xml=(name:string,tests:number,failures:number,errors:number,skipped:number)=>`<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="${name}" tests="${tests}" skipped="${skipped}" failures="${failures}" errors="${errors}" timestamp="2026-10-11T10:00:00" hostname="h" time="1.2">\n<testcase name="a" classname="${name}" time="0.1"/>\n</testsuite>\n`;
async function results(){
 const dir=await tmpDir("junit-");
 await writeFile(join(dir,"TEST-com.shop.checkout.CheckoutTests.xml"),xml("com.shop.checkout.CheckoutTests",4,0,0,0));
 await writeFile(join(dir,"TEST-com.shop.refunds.RefundTests.xml"),xml("com.shop.refunds.RefundTests",3,1,0,0));
 await writeFile(join(dir,"TEST-com.shop.Live.xml"),xml("com.shop.Live",2,0,0,2));
 await writeFile(join(dir,"TEST-broken.xml"),"not xml");
 await writeFile(join(dir,"notes.txt"),"ignored");
 return dir;
}
const sha40=(c:string)=>c.repeat(40);

test("takeover exec: JUnit files become one record per class with the engine's own verdict and the file hash",async()=>{
 const records=await junitRecords(await results(),sha40("a"),"op",new Date("2026-10-11T00:00:00Z")),by=Object.fromEntries(records.map(r=>[r.className,r]));
 assert.equal(records.length,3,"a file that is not a test suite is skipped, never guessed");
 assert.equal(by["com.shop.checkout.CheckoutTests"].outcome,"PASS");assert.deepEqual(by["com.shop.checkout.CheckoutTests"].counts,{tests:4,failures:0,errors:0,skipped:0});
 assert.equal(by["com.shop.refunds.RefundTests"].outcome,"FAIL");
 assert.equal(by["com.shop.Live"].outcome,"NOT_RUN","every test skipped is not a pass");
 assert.ok(records.every(r=>/^[0-9a-f]{64}$/.test(r.logSha256!)&&r.commit===sha40("a")&&r.recordedBy==="op"));
 assert.equal(junitClassOfPath(TEST_PATH),"com.shop.checkout.CheckoutTests");assert.equal(junitClassOfPath("src/main/kotlin/A.kt"),undefined);
});

test("takeover exec: records are bound to one commit, can only be added before the audit starts, and a record is validated",async()=>{
 const state=await tmpState(),gate=await gateRecord({name:"Backend test suite",commit:sha40("b"),outcome:"PASS",summary:"2343 tests"});
 assert.equal(gate.id,"gate:backend-test-suite");
 await recordExec(state.takeover,"v2",[gate,await gateRecord({name:"old run",commit:sha40("c"),outcome:"PASS"})]);
 const ledger=await loadLedger(state.takeover,"v2"),usable=usableFor(ledger,sha40("b"));
 assert.deepEqual(usable.records.map(r=>r.id),["gate:backend-test-suite"]);assert.equal(usable.otherCommits,1,"another commit's run is counted, never used");
 assert.throws(()=>ExecRecord.parse({...gate,commit:"HEAD"}));assert.throws(()=>ExecRecord.parse({...gate,outcome:"MAYBE"}));
 await state.takeover.save({version:1,projectId:"started",workspace:"/x",status:"AUDITING",auditedHead:"h",branch:"main",focus:[],startedAt:"t",updatedAt:"t",changedParts:[]});
 await assert.rejects(()=>recordExec(state.takeover,"started",[gate]),(e:unknown)=>e instanceof TakeoverError&&e.code==="BAD_STATE");
});

const item=(over:object)=>({id:"x",area:"a",claim:"c",status:"DONE" as const,evidence:[] as string[],...over});
async function verified(extra:(head:string)=>Promise<ExecRecordValue[]>=async()=>[]){
 const root=await target(),snapshot=await takeSnapshot(root),head=snapshot.head,junit=await junitRecords(await results(),head);
 const exec=usableFor({version:1,records:[...junit,...await extra(head)]},head);
 return {root,snapshot,head,exec,assess:(items:ReturnType<typeof item>[])=>assessClassification(AgentClassification.parse({items}),snapshot,[],exec)};
}

test("takeover evidence: in a verified audit DONE needs an executed PASS, a cited FAIL forbids it, and a gate that was not run is still honest",async()=>{
 let front!:ExecRecordValue;
 const t=await verified(async head=>{front=await gateRecord({name:"frontend gate",commit:head,outcome:"PASS",summary:"GATE GREEN"});return [await gateRecord({name:"golden company",commit:head,outcome:"NOT_RUN",summary:"needs a second stack"}),front];}),head=t.head;
 const src="backend/src/main/kotlin/com/shop/checkout/Checkout.kt",refundSrc="backend/src/main/kotlin/com/shop/refunds/Refund.kt";
 const r=t.assess([
  item({id:"ok",evidence:[src,TEST_PATH]}),
  item({id:"static-only",evidence:[src,"backend/src/test/kotlin/com/shop/ghost/"]}),
  item({id:"failing",evidence:[refundSrc,OTHER_TEST]}),
  item({id:"gate",evidence:[src,TEST_PATH,"exec:gate:frontend-gate"]}),
  item({id:"blocked",status:"BLOCKED",evidence:["exec:gate:golden-company"]}),
  item({id:"fake",status:"NOT_DONE",evidence:["exec:gate:nothing","exec:junit:com.nope.Missing"]}),
  item({id:"partial",status:"PARTIAL",evidence:[src,TEST_PATH]})
 ]),by=Object.fromEntries(r.items.map(i=>[i.id,i]));
 assert.equal(by.ok.status,"DONE");assert.equal(by.ok.verification,"EXECUTED");assert.equal(by.ok.evidence.find(e=>e.ref===TEST_PATH)?.executed,"PASS");
 assert.equal(by["static-only"].status,"PARTIAL","a directory that does not exist is discarded, so nothing carries the test side of DONE");assert.equal(by["static-only"].rejectedEvidence.length,1);
 assert.equal(by.failing.status,"PARTIAL");assert.match(by.failing.adjustments.join(" "),/executed result FAILED/);assert.equal(by.failing.verification,"EXECUTED");
 assert.equal(by.gate.status,"DONE");
 assert.equal(by.blocked.status,"BLOCKED");assert.equal(by.blocked.verification,"NONE","a gate that did not run proves nothing, but it is a real citation for BLOCKED");
 assert.equal(by.fake.status,"UNKNOWN");assert.equal(by.fake.rejectedEvidence.length,2,"a made-up run id is discarded like a made-up path");
 assert.equal(by.partial.verification,"EXECUTED");
 // the same claims, but the test class never ran: static evidence alone cannot be DONE any more
 const noRun=assessClassification(AgentClassification.parse({items:[item({id:"d",evidence:[src,TEST_PATH]})]}),t.snapshot,[],usableFor({version:1,records:[front]},head));
 assert.equal(noRun.items[0].status,"PARTIAL");assert.match(noRun.items[0].adjustments.join(" "),/needs an executed PASS/);assert.equal(noRun.items[0].verification,"STATIC");
});

test("takeover evidence: without recorded runs nothing changes, `exec:` citations are discarded, and nothing is EXECUTED",async()=>{
 const root=await target(),snapshot=await takeSnapshot(root),src="backend/src/main/kotlin/com/shop/checkout/Checkout.kt";
 const r=assessClassification(AgentClassification.parse({items:[item({id:"a",evidence:[src,TEST_PATH]}),item({id:"b",status:"PARTIAL",evidence:[src,"exec:gate:anything"]})]}),snapshot);
 assert.equal(r.items[0].status,"DONE");assert.equal(r.items[0].verification,"STATIC");
 assert.deepEqual(r.items[1].rejectedEvidence,["exec:gate:anything"]);assert.ok(r.items.every(i=>i.verification!=="EXECUTED"));
});

test("takeover exec: a directory of tests is judged by the classes under it, and the lookup never invents a result",async()=>{
 const t=await verified(),lookup=lookupOf(t.exec);
 assert.equal(executedFor(lookup,"backend/src/test/kotlin/com/shop/",t.snapshot)?.outcome,"FAIL","one failing class under the directory fails it");
 assert.equal(executedFor(lookup,"backend/src/test/kotlin/com/shop/checkout/",t.snapshot)?.outcome,"PASS");
 assert.equal(executedFor(lookup,"backend/src/main/kotlin/com/shop/checkout/Checkout.kt",t.snapshot),undefined,"source files are not tests");
 assert.equal(executedFor(lookup,"exec:junit:com.shop.checkout.CheckoutTests",t.snapshot)?.outcome,"PASS");
});

test("takeover plan: the pack carries the source index and the executed results, and the rule about execution matches reality",async()=>{
 const t=await verified(async head=>[await gateRecord({name:"frontend gate",commit:head,outcome:"PASS"})]);
 const plain=await buildTakeoverPlan("p",t.snapshot),withExec=await buildTakeoverPlan("p",t.snapshot,{exec:t.exec});
 const last=(p:typeof plain)=>p.tasks.find(x=>x.id===TAKEOVER_TASKS.classification)!.prompt;
 assert.match(last(plain),/SOURCE FILES.*\(2\)[\s\S]*backend\/src\/main\/kotlin\/com\/shop\/checkout\/Checkout\.kt/);
 assert.match(last(plain),/Nothing was executed/);assert.match(last(plain),/EXECUTED RESULTS\nNone/);
 assert.match(last(withExec),/EXECUTED RESULTS \(run by the operator/);assert.match(last(withExec),/JUnit: 3 test classes, 9 tests, 1 failures/);assert.match(last(withExec),/FAILED classes: com\.shop\.refunds\.RefundTests/);
 assert.ok(!/Nothing was executed:/.test(last(withExec)),"the 'nothing was executed' rule is dropped when runs exist");
 assert.match(last(withExec),/The audit itself executed nothing/);
});

test("takeover run: recorded runs of the audited commit reach the agents, the verdicts and the report; the target is still untouched",async()=>{
 const root=await target(),state=await tmpState(),head=(await takeSnapshot(root)).head,before=await fingerprint(root);
 await recordExec(state.takeover,"v2",[...await junitRecords(await results(),head),await gateRecord({name:"frontend gate",commit:head,outcome:"PASS",summary:"GATE GREEN",command:"npm run gate:frontend"}),await gateRecord({name:"stale",commit:sha40("d"),outcome:"PASS"})]);
 const src="backend/src/main/kotlin/com/shop/checkout/Checkout.kt",prompts:string[]=[];
 const classification=JSON.stringify({items:[{id:"A-1",area:"checkout",claim:"checkout works",status:"DONE",evidence:[src,TEST_PATH]},{id:"A-2",area:"refunds",claim:"refunds work",status:"DONE",evidence:["backend/src/main/kotlin/com/shop/refunds/Refund.kt",OTHER_TEST],priority:"P1"}],criticalPath:["fix refunds"]});
 const selector=selectorFor(async request=>{prompts.push(request.prompt);return usage(isReviewRequest(request)?pass("ok"):compliant(request.meta!.taskId===TAKEOVER_TASKS.classification?"Summary.\n\n```json\n"+classification+"\n```":"analysis"));},[{id:"p",maxConcurrency:4}]);
 const result=await runTakeover({state,selector,projectId:"v2",workspace:root,orchestrator:{maxProviderAttempts:1,sleep:async()=>{}}});
 assert.equal(result.record.status,"AUDIT_COMPLETE_WAITING_APPROVAL");assert.deepEqual(changedParts(before,await fingerprint(root)),[]);
 const by=Object.fromEntries(result.classification!.items.map(i=>[i.id,i]));
 assert.equal(by["A-1"].status,"DONE");assert.equal(by["A-1"].verification,"EXECUTED");
 assert.equal(by["A-2"].status,"PARTIAL","the agent said DONE but the class FAILED");
 assert.deepEqual(result.record.counts,{DONE:1,PARTIAL:1,NOT_DONE:0,BLOCKED:0,UNKNOWN:0});
 const all=prompts.join("\n");assert.match(all,/exec:gate:frontend-gate/);assert.ok(!all.includes("exec:gate:stale"),"a run of another commit is never shown");
 const report=await readFile(join(state.takeover.dir("v2"),"TAKEOVER-REPORT.md"),"utf8");
 assert.match(report,/## Executed evidence/);assert.match(report,/gate:frontend-gate \| PASS/);assert.match(report,/1 record\(s\) for other commits were ignored/);assert.match(report,/the engine did not re-run it/);assert.ok(!/Nothing was executed: no test/.test(report));
 assert.match(report,/ran PASS/);
 // the frozen set is what a resumed audit would use
 assert.equal(JSON.parse(await readFile(join(state.takeover.dir("v2"),"executed-evidence.json"),"utf8")).records.length,4,"three JUnit classes and the gate; the other commit's run is not part of the audit");
});

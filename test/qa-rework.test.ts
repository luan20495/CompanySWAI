import assert from "node:assert/strict";
import test from "node:test";
import {ProjectOrchestrator} from "../src/orchestrator.js";
import {assertNoDuplicateWork,isReviewRequest,pass,plan,reviewer,selectorFor,task,tmpState,usage} from "./helpers.js";

const base=["Deliverables","Decisions","Evidence","Blockers","Handoff"];
const baContract={sections:[...base,"Requirements"],verdict:false,validators:["requirements-ids"],params:{}};
const qaContract={sections:[...base,"QA Status","Traceability"],verdict:false,validators:["qa-traceability"],params:{}};
const plain={sections:base,verdict:false,validators:[],params:{}};
const wrap=(extra:string,body="work")=>"## Deliverables\n"+body+"\n\n## Decisions\nNone.\n\n## Evidence\ne\n\n## Blockers\nNone.\n\n## Handoff\nh"+extra;
const requirements=wrap("\n\n## Requirements\n- [REQ-001] FACT: first behaviour (basis: brief)\n  - [AC-001.1] Given a when b then c.\n- [REQ-002] FACT: second behaviour (basis: brief)\n  - [AC-002.1] Given a when b then c.\n- [REQ-003] FACT: third behaviour (basis: brief)\n  - [AC-003.1] Given a when b then c.");
const qa=(status:string,lines:string[])=>wrap("\n\n## QA Status\n"+status+"\n\n## Traceability\n"+lines.join("\n"),"qa report");
const pas=(req:string,n:number)=>"- ["+req+"] -> [T-00"+n+"] PASS: ok | evidence: gate output";
const fail=(req:string,n:number,owner:string)=>"- ["+req+"] -> [T-00"+n+"] FAIL: "+req+" is broken | evidence: reproduction | owner: "+owner;

function project(over:{qaReviewRounds?:number}={}){
 return plan("qr",[
  task("ba",{contract:baContract,prompt:"ba work"}),
  task("impl1",{contract:plain,dependencies:["ba"],prompt:"impl1 work",review:reviewer({maxRounds:over.qaReviewRounds??2})}),
  task("impl2",{contract:plain,dependencies:["ba"],prompt:"impl2 work",review:reviewer({maxRounds:over.qaReviewRounds??2})}),
  task("qa",{contract:qaContract,dependencies:["ba","impl1","impl2"],prompt:"qa work"})
 ]);
}
type Script={qa:(state:{fixed:Set<string>;qaCalls:number})=>string;crashOn?:(taskId:string,prompt:string)=>boolean};
function harness(script:Script){
 const calls:Array<{task:string;kind:string;prompt:string}>=[],state={fixed:new Set<string>(),qaCalls:0};
 const selector=selectorFor(request=>{
  const id=request.meta!.taskId,reviewed=isReviewRequest(request);
  calls.push({task:id,kind:reviewed?"review":/QA FINDINGS/.test(request.prompt)?"rework":/RE-VERIFICATION/.test(request.prompt)?"reverify":"maker",prompt:request.prompt});
  if(script.crashOn?.(id,request.prompt))throw new Error("process died during "+id);
  if(reviewed)return usage(pass("reviewed "+id));
  if(id==="ba")return usage(requirements);
  if(id==="qa"){state.qaCalls++;return usage(script.qa(state));}
  if(/QA FINDINGS/.test(request.prompt))state.fixed.add(id);
  return usage(wrap("",id+(state.fixed.has(id)?" fixed":" v1")));
 },[{id:"p",maxConcurrency:4}]);
 return {calls,state,selector};
}
const count=(calls:Array<{task:string;kind:string}>,task:string,kind:string)=>calls.filter(c=>c.task===task&&c.kind===kind).length;

test("QA FAIL is routed to the owning maker only, which is reviewed again, then QA re-verifies and passes",async()=>{
 const h=harness({qa:s=>s.fixed.has("impl1")?qa("PASS — all verified",[pas("REQ-001",1),pas("REQ-002",2),pas("REQ-003",3)]):qa("FAIL — REQ-001 is broken",[fail("REQ-001",1,"impl1"),pas("REQ-002",2),pas("REQ-003",3)])});
 const state=await tmpState(),summary=await new ProjectOrchestrator(h.selector,state).run(project());
 assert.deepEqual(summary.failed,[]);assert.equal(summary.qaReworkRounds,1);assert.deepEqual(summary.completed.sort(),["ba","impl1","impl2","qa"]);
 assert.equal(count(h.calls,"impl1","rework"),1,"the owner reworks once");assert.equal(count(h.calls,"qa","reverify"),1,"QA verifies again");
 for(const untouched of ["ba","impl2"])assert.equal(h.calls.filter(c=>c.task===untouched&&c.kind!=="review").length,1,untouched+" is not rerun");
 assert.equal(h.calls.filter(c=>c.task.startsWith("impl2--review")).length,1,"unrelated accepted work is not re-reviewed");
 assert.equal(h.calls.filter(c=>c.task.startsWith("impl1--review")).length,2,"independent review ran again for the changed implementation");
 const rework=h.calls.find(c=>c.kind==="rework")!;
 assert.match(rework.prompt,/QA FINDINGS \(rework round 1\)[\s\S]*REQ-001 is broken[\s\S]*requirement: first behaviour[\s\S]*\[AC-001\.1\]/);
 assert.match(rework.prompt,/YOUR CURRENT ARTIFACT[\s\S]*impl1 v1/);
 assert.doesNotMatch(rework.prompt,/REQ-002 is broken|impl2/,"the owner sees only its own findings and nothing about other makers");
 assert.equal((await state.traceability.load("qr")).qa?.overall,"PASS");
 assert.match(await state.memory.read("qr","STATUS.md"),/QA_FAIL_REWORK[\s\S]*REQ-001 -> impl1/);
 assertNoDuplicateWork(await state.executions.list("qr"),1);
});

test("findings owned by different makers go to their own owners in one round",async()=>{
 const h=harness({qa:s=>s.fixed.has("impl1")&&s.fixed.has("impl2")?qa("PASS",[pas("REQ-001",1),pas("REQ-002",2),pas("REQ-003",3)]):qa("FAIL",[fail("REQ-001",1,"impl1"),fail("REQ-002",2,"impl2"),pas("REQ-003",3)])});
 const state=await tmpState(),summary=await new ProjectOrchestrator(h.selector,state).run(project());
 assert.equal(summary.qaReworkRounds,1);assert.deepEqual(summary.failed,[]);
 const prompt=(id:string)=>h.calls.find(c=>c.task===id&&c.kind==="rework")!.prompt;
 assert.match(prompt("impl1"),/REQ-001 is broken/);assert.doesNotMatch(prompt("impl1"),/REQ-002 is broken/);
 assert.match(prompt("impl2"),/REQ-002 is broken/);assert.doesNotMatch(prompt("impl2"),/REQ-001 is broken/);
 assert.equal(h.calls.filter(c=>c.task==="ba").length,1);assert.equal(count(h.calls,"qa","reverify"),1,"one re-verification covers both");
 assert.equal((await state.rework.list("qr")).filter(r=>r.kind==="fix").length,2);
});

test("BLOCKED and NOT_APPLICABLE results never trigger rework; in a mixed result only FAIL findings are sent back",async()=>{
 const blocked=harness({qa:()=>qa("BLOCKED — sandbox unavailable",[pas("REQ-001",1),"- [REQ-002] -> [T-002] BLOCKED: no environment to run it","- [REQ-003] -> NOT_APPLICABLE: covered by operations"])});
 const s1=await tmpState(),r1=await new ProjectOrchestrator(blocked.selector,s1).run(project());
 assert.equal(r1.qaReworkRounds,0);assert.equal(blocked.calls.filter(c=>c.kind==="rework"||c.kind==="reverify").length,0);assert.equal((await s1.traceability.load("qr")).qa?.overall,"BLOCKED");
 const na=harness({qa:()=>qa("NOT_APPLICABLE",["- [REQ-001] -> NOT_APPLICABLE: n/a","- [REQ-002] -> NOT_APPLICABLE: n/a","- [REQ-003] -> NOT_APPLICABLE: n/a"])});
 const r2=await new ProjectOrchestrator(na.selector,await tmpState()).run(project());assert.equal(r2.qaReworkRounds,0);assert.equal(na.calls.filter(c=>c.kind==="rework").length,0);
 const mixed=harness({qa:s=>s.fixed.has("impl1")?qa("BLOCKED",[pas("REQ-001",1),"- [REQ-002] -> [T-002] BLOCKED: no environment","- [REQ-003] -> NOT_APPLICABLE: n/a"]):qa("FAIL",[fail("REQ-001",1,"impl1"),"- [REQ-002] -> [T-002] BLOCKED: no environment","- [REQ-003] -> NOT_APPLICABLE: n/a"])});
 const s3=await tmpState(),r3=await new ProjectOrchestrator(mixed.selector,s3).run(project());
 assert.equal(r3.qaReworkRounds,1);const fix=mixed.calls.find(c=>c.kind==="rework")!,findings=fix.prompt.slice(fix.prompt.indexOf("--- QA FINDINGS"),fix.prompt.indexOf("--- YOUR CURRENT ARTIFACT"));assert.match(findings,/REQ-001/);assert.doesNotMatch(findings,/BLOCKED|REQ-002|REQ-003/);
 assert.equal(mixed.calls.filter(c=>c.kind==="rework").length,1,"BLOCKED is not an implementation failure, so no second owner is reworked");
 assert.equal((await s3.traceability.load("qr")).qa?.overall,"BLOCKED","after the real failure is fixed the remaining BLOCKED stays BLOCKED");
});

test("rework is bounded by maxQAReworkRounds and the project then reports the unresolved QA failure",async()=>{
 const h=harness({qa:()=>qa("FAIL",[fail("REQ-001",1,"impl1"),pas("REQ-002",2),pas("REQ-003",3)])});
 const state=await tmpState(),summary=await new ProjectOrchestrator(h.selector,state,{maxQAReworkRounds:2}).run(project());
 assert.equal(summary.qaReworkRounds,2);assert.equal(count(h.calls,"impl1","rework"),2);assert.equal(count(h.calls,"qa","reverify"),2);assert.deepEqual(summary.failed,[]);
 assert.equal((await state.traceability.load("qr")).qa?.overall,"FAIL");assert.match(await state.memory.read("qr","STATUS.md"),/QA_REWORK_EXHAUSTED/);
 const none=harness({qa:()=>qa("FAIL",[fail("REQ-001",1,"impl1"),pas("REQ-002",2),pas("REQ-003",3)])});
 const zero=await new ProjectOrchestrator(none.selector,await tmpState(),{maxQAReworkRounds:0}).run(project());
 assert.equal(zero.qaReworkRounds,0);assert.equal(none.calls.filter(c=>c.kind==="rework").length,0);
});

test("a crash during QA rework resumes the same round without repeating finished work",async()=>{
 let armed=true;
 const h=harness({qa:s=>s.fixed.has("impl1")?qa("PASS",[pas("REQ-001",1),pas("REQ-002",2),pas("REQ-003",3)]):qa("FAIL",[fail("REQ-001",1,"impl1"),pas("REQ-002",2),pas("REQ-003",3)]),crashOn:(id,prompt)=>armed&&id==="impl1"&&/QA FINDINGS/.test(prompt)});
 const state=await tmpState(),p=project();
 const first=await new ProjectOrchestrator(h.selector,state).run(p);
 assert.deepEqual(first.failed,["impl1"]);assert.equal((await state.rework.list("qr")).length,2,"the round was persisted before the crash");
 armed=false;
 const second=await new ProjectOrchestrator(h.selector,state).run(p);
 assert.deepEqual(second.failed,[]);assert.equal(second.qaReworkRounds,1,"no second round was started");assert.equal((await state.traceability.load("qr")).qa?.overall,"PASS");
 assert.equal(h.calls.filter(c=>c.task==="ba").length,1);assert.equal(h.calls.filter(c=>c.task==="impl2"&&c.kind!=="review").length,1);
 assert.equal(count(h.calls,"qa","reverify"),1);assert.equal(h.state.qaCalls,2,"QA ran once before and once after the rework, never in between");
 assertNoDuplicateWork(await state.executions.list("qr"),1);
 // and a crash after the rework but during QA re-verification
 let qaArmed=true;
 const h2=harness({qa:s=>s.fixed.has("impl1")?qa("PASS",[pas("REQ-001",1),pas("REQ-002",2),pas("REQ-003",3)]):qa("FAIL",[fail("REQ-001",1,"impl1"),pas("REQ-002",2),pas("REQ-003",3)]),crashOn:(id,prompt)=>qaArmed&&id==="qa"&&/RE-VERIFICATION/.test(prompt)});
 const s2=await tmpState(),r1=await new ProjectOrchestrator(h2.selector,s2).run(p);assert.deepEqual(r1.failed,["qa"]);qaArmed=false;
 const r2=await new ProjectOrchestrator(h2.selector,s2).run(p);assert.deepEqual(r2.failed,[]);assert.equal(r2.qaReworkRounds,1);
 assert.equal(count(h2.calls,"impl1","rework"),1,"the finished rework is not redone");assertNoDuplicateWork(await s2.executions.list("qr"),1);
});

test("a reworked implementation gets a fresh review round budget and independent reviewers see the new version",async()=>{
 const reviewed:string[]=[];
 const h=harness({qa:s=>s.fixed.has("impl1")?qa("PASS",[pas("REQ-001",1),pas("REQ-002",2),pas("REQ-003",3)]):qa("FAIL",[fail("REQ-001",1,"impl1"),pas("REQ-002",2),pas("REQ-003",3)])});
 const wrapped=Object.assign((r:Parameters<typeof h.selector>[0])=>h.selector(r),h.selector) as typeof h.selector;
 void wrapped;void reviewed;
 const state=await tmpState(),summary=await new ProjectOrchestrator(h.selector,state).run(project({qaReviewRounds:1}));
 assert.deepEqual(summary.failed,[],"maxRounds 1 was already used by the first version; the reworked one still gets its own round");
 const reviews=(await state.executions.list("qr")).filter(r=>r.taskId.startsWith("impl1--review-")&&r.status==="SUCCEEDED");
 assert.deepEqual(reviews.map(r=>r.taskId),["impl1--review-1-0","impl1--review-2-0"]);
 const second=h.calls.filter(c=>c.task==="impl1--review-2-0")[0];assert.match(second.prompt,/impl1 fixed/);assert.doesNotMatch(second.prompt,/QA FINDINGS|REQ-001 is broken/,"reviewers get the artifact, not the QA conversation");
});

test("a QA FAIL must name an owner among its upstream tasks, otherwise the answer is repaired",async()=>{
 let n=0;
 const noOwner=qa("FAIL",["- [REQ-001] -> [T-001] FAIL: broken | evidence: x",pas("REQ-002",2),pas("REQ-003",3)]);
 const wrongOwner=qa("FAIL",["- [REQ-001] -> [T-001] FAIL: broken | evidence: x | owner: somebody-else",pas("REQ-002",2),pas("REQ-003",3)]);
 const prompts:string[]=[];
 const selector=selectorFor(request=>{const id=request.meta!.taskId;if(isReviewRequest(request))return usage(pass());if(id==="ba")return usage(requirements);if(id==="qa"){prompts.push(request.prompt);n++;return usage(n===1?noOwner:n===2?wrongOwner:qa("PASS",[pas("REQ-001",1),pas("REQ-002",2),pas("REQ-003",3)]));}return usage(wrap("",id));},[{id:"p",maxConcurrency:4}]);
 const summary=await new ProjectOrchestrator(selector,await tmpState()).run(project());
 assert.deepEqual(summary.failed,[]);assert.equal(n,3);assert.match(prompts[1],/needs '\| owner: <task>'[\s\S]*ba, impl1, impl2/);
});

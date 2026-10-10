import assert from "node:assert/strict";
import test from "node:test";
import {execFile} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdir,readdir,readFile,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {promisify} from "node:util";
import {runAutonomous,type AutonomousResult} from "../src/autonomous.js";
import {CompanyState} from "../src/state.js";
import {ProjectPlan} from "../src/project.js";
import {hashOf} from "../src/run-store.js";
import {clearRegisteredSecrets,registerSecret} from "../src/secrets.js";
import {loadProjectModel} from "../src/operator.js";
import {runOperator,type OperatorContext} from "../src/operator-commands.js";
import {assertNoDuplicateWork,compliant,fakeAnthropicKey,isReviewRequest,pass,plan,reviewer,selectorFor,task,tmpDir,tmpState,usage} from "./helpers.js";

const execFileAsync=promisify(execFile);
const BIG="BODY-MARKER-"+"x".repeat(400);
/** Assembled at runtime so the repository itself never contains a credential-shaped literal (the doctor scans for them). */
const bearer=()=>["Bearer","abcdefghijklmnopqrstuvwxyz0123456789"].join(" ");

const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return {promise,resolve};};
async function until(check:()=>Promise<boolean>|boolean,ms=8000){
 const end=Date.now()+ms;
 while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,10));}
 throw new Error("timed out waiting for the engine");
}

/** Every file under the state root: path -> content hash. */
async function snapshotState(root:string){
 const out=new Map<string,string>();
 const walk=async(dir:string)=>{
  for(const entry of await readdir(dir,{withFileTypes:true})){
   const path=join(dir,entry.name);
   if(entry.isDirectory())await walk(path);
   else out.set(path.slice(root.length+1),createHash("sha256").update(await readFile(path)).digest("hex"));
  }
 };
 await walk(root);return out;
}
/** Waits until the engine has stopped writing (it parks on a gate): two identical snapshots in a row. */
async function quietState(root:string){
 let last=await snapshotState(root);
 for(let i=0;i<100;i++){
  await new Promise(r=>setTimeout(r,40));
  const next=await snapshotState(root);
  if(changedPaths(last,next).length===0)return next;
  last=next;
 }
 throw new Error("state never went quiet");
}
const changedPaths=(a:Map<string,string>,b:Map<string,string>)=>[...new Set([...a.keys(),...b.keys()])].filter(k=>a.get(k)!==b.get(k)).sort();

/** architect -> (backend-engineer reviewed, frontend-engineer) -> qa-engineer. */
const xweb=(id="xweb",prefix="")=>plan(id,[
 task(prefix+"T-1",{agentRole:"architect",prompt:"design the system"}),
 task(prefix+"T-31",{agentRole:"backend-engineer",dependencies:[prefix+"T-1"],prompt:"Datasource API",review:reviewer()}),
 task(prefix+"T-42",{agentRole:"frontend-engineer",dependencies:[prefix+"T-1"],prompt:"Studio integration"}),
 task(prefix+"T-50",{agentRole:"qa-engineer",dependencies:[prefix+"T-31",prefix+"T-42"],prompt:"verify everything"})
]);

/** A deterministic fake provider; the first backend maker call of `holdTask` parks until released, so the engine is really RUNNING. */
function harness(holdTask="T-31"){
 const gate=deferred(),calls:Array<{task:string;kind:string}>=[];let hold=true;
 const selector=selectorFor(async request=>{
  const id=request.meta!.taskId,review=isReviewRequest(request);
  calls.push({task:id.replace(/--review-.*$/,""),kind:review?"review":"maker"});
  if(request.meta!.taskId===holdTask&&!review&&hold)await gate.promise;
  if(review)return usage(pass("reviewed "+id));
  return usage(compliant(id+" output "+BIG,{handoff:"handoff from "+id}));
 },[{id:"p",maxConcurrency:4}]);
 return {calls,selector,release:()=>{hold=false;gate.resolve();}};
}
const ctxFor=(state:CompanyState,h?:ReturnType<typeof harness>):OperatorContext=>({state,engine:h?async()=>({selector:h.selector,knownRoles:[],knownSkills:[]}):undefined});
const op=async(state:CompanyState,argv:string[],h?:ReturnType<typeof harness>)=>runOperator(argv,ctxFor(state,h));
const asJson=async(state:CompanyState,argv:string[])=>{const r=await op(state,[...argv,"--json"]);assert.equal(r.code,0,r.stderr);return JSON.parse(r.stdout);};

/** Starts a real engine run (runAutonomous) that parks on `T-31`'s maker step, once everything that can finish has finished. */
async function startRunning(state:CompanyState,h:ReturnType<typeof harness>,projectPlan=xweb()){
 const run=runAutonomous({plan:ProjectPlan.parse(projectPlan)},{state,selector:h.selector});
 await until(async()=>{
  const m=await loadProjectModel(state,"xweb");
  const by=(id:string)=>m.tasks.find(t=>t.id===id)?.state;
  return by("T-31")==="RUNNING"&&by("T-42")==="DONE"&&by("T-1")==="DONE";
 });
 // wrapped: returning the promise itself from an async function would await the whole (parked) run
 return {run};
}

test("status of a running multi-agent project classifies RUNNING / WAITING / DONE and never prints a percentage",async()=>{
 const state=await tmpState(),h=harness(),{run}=await startRunning(state,h);
 const status=await asJson(state,["status","xweb"]);
 assert.equal(status.engine.state,"RUNNING");
 assert.deepEqual(status.running.map((t:any)=>t.id),["T-31"]);
 assert.equal(status.running[0].agentRole,"backend-engineer");
 assert.equal(status.running[0].running.step,"implementing");
 assert.deepEqual(status.waiting.map((t:any)=>t.id),["T-50"]);
 assert.deepEqual(status.waiting[0].waitingOn,[{taskId:"T-31",state:"RUNNING"}]);
 assert.deepEqual(status.tasks.counts,{DONE:2,RUNNING:1,BLOCKED:0,PAUSED:0,AWAITING_APPROVAL:0,WAITING:1,READY:0,INTERRUPTED:0});
 const text=(await op(state,["status","xweb"])).stdout;
 assert.match(text,/^PROJECT: xweb/);
 assert.match(text,/ENGINE: RUNNING/);
 assert.match(text,/RUNNING\n- backend-engineer\s+T-31/);
 assert.match(text,/WAITING\n- qa-engineer\s+T-50\s+waiting for T-31 \(RUNNING\)/);
 assert.match(text,/BLOCKED\n- none/);
 assert.match(text,/2\/4 tasks done/);
 // progress is only ever a count: tasks differ in size, so no invented percentage; ETA is withheld or labelled ESTIMATE
 assert.doesNotMatch(text,/\d\s*%/);
 assert.match(text,/ETA: (unknown|~\S+ ESTIMATE)/);
 h.release();await run;
});

test("no fake percentage or ETA when progress is unknown (execution log without a plan)",async()=>{
 const state=await tmpState();
 await state.executions.append({id:"e1",projectId:"orphan",taskId:"X-1",agentRole:"dev",provider:"fake",model:"m",status:"SUCCEEDED",startedAt:"2026-01-01T00:00:00Z",finishedAt:"2026-01-01T00:00:05Z",output:"done"});
 const r=await op(state,["status","orphan"]);
 assert.equal(r.code,0);
 assert.match(r.stdout,/PROGRESS: no plan persisted/);
 assert.match(r.stdout,/ETA: unknown/);
 assert.doesNotMatch(r.stdout,/\d\s*%/);
 const tasks=await op(state,["tasks","orphan"]);
 assert.match(tasks.stdout,/No tasks \(no persisted plan\)/);
});

test("agents: who is working, what the backend is doing, why QA is waiting, which handoff is pending",async()=>{
 const state=await tmpState(),h=harness(),{run}=await startRunning(state,h);
 const agents:any[]=await asJson(state,["agents","xweb"]),by=(role:string)=>agents.find(a=>a.role===role);
 assert.equal(by("backend-engineer").state,"RUNNING");
 assert.equal(by("backend-engineer").current.taskId,"T-31");
 assert.equal(by("architect").state,"DONE");
 assert.equal(by("frontend-engineer").state,"DONE");
 assert.equal(by("qa-engineer").state,"WAITING");
 assert.deepEqual(by("qa-engineer").waitingFor,["T-31 (RUNNING)"]);
 // the frontend's handoff to QA exists but QA has not started: it is pending, and the view says from whom
 assert.ok(by("qa-engineer").pendingHandoffsIn.some((p:any)=>p.fromTask==="T-42"&&p.fromRole==="frontend-engineer"&&p.forTask==="T-50"));
 assert.equal(by("qa-reviewer").state,"WAITING");
 const text=(await op(state,["agents","xweb"])).stdout;
 assert.match(text,/backend-engineer\s+RUNNING\s+T-31 — implementing/);
 assert.match(text,/waiting for: T-31 \(RUNNING\)/);
 // waiting on running work is not a blocker
 assert.match((await op(state,["blockers","xweb"])).stdout,/BLOCKERS\n- none/);
 h.release();await run;
});

test("while a reviewer works on a task the maker agent is idle and the reviewer is the running agent",async()=>{
 const state=await tmpState(),gate=deferred(),calls:string[]=[];
 const selector=selectorFor(async request=>{
  const review=isReviewRequest(request);calls.push(request.meta!.taskId);
  if(review){await gate.promise;return usage(pass("ok"));}
  return usage(compliant(request.meta!.taskId+" out"));
 },[{id:"p",maxConcurrency:4}]);
 const run=runAutonomous({plan:ProjectPlan.parse(plan("rv",[task("T-31",{agentRole:"backend-engineer",review:reviewer()})]))},{state,selector});
 await until(async()=>(await loadProjectModel(state,"rv")).tasks[0]?.running?.step.startsWith("review")===true);
 const agents:any[]=await asJson(state,["agents","rv"]),by=(r:string)=>agents.find(a=>a.role===r);
 assert.equal(by("qa-reviewer").state,"RUNNING");assert.equal(by("qa-reviewer").current.taskId,"T-31");
 assert.equal(by("backend-engineer").state,"WAITING");
 assert.deepEqual(by("backend-engineer").waitingFor,["T-31 under review by qa-reviewer"]);
 const status=await op(state,["status","rv"]);
 assert.match(status.stdout,/RUNNING\n- qa-reviewer\s+T-31\s.*— review \(slot 0\)/);
 gate.resolve();await run;
});

test("a failed task is BLOCKED with its reason, and what waits behind it says so",async()=>{
 const state=await tmpState();
 const selector=selectorFor(request=>{
  if(request.meta!.taskId==="T-42")throw new Error("schema generator crashed");
  return usage(isReviewRequest(request)?pass("reviewed"):compliant("ok"));
 },[{id:"p",maxConcurrency:4}]);
 await runAutonomous({plan:ProjectPlan.parse(xweb())},{state,selector});
 const status=await asJson(state,["status","xweb"]);
 assert.equal(status.engine.state,"FINISHED");
 assert.deepEqual(status.blocked.map((t:any)=>t.id),["T-42"]);
 assert.match(status.blocked[0].reason,/schema generator crashed/);
 const qa=(await asJson(state,["tasks","xweb"])).find((t:any)=>t.id==="T-50");
 assert.equal(qa.state,"WAITING");
 assert.ok(qa.waitingOn.some((w:any)=>w.taskId==="T-42"&&w.state==="BLOCKED"));
 const blockers=(await op(state,["blockers","xweb"])).stdout;
 assert.match(blockers,/T-42\s+frontend-engineer\s+\[task-blocked\] .*schema generator crashed/);
 assert.match(blockers,/T-50\s+qa-engineer\s+\[waiting\] waiting for T-42 \(BLOCKED\)/);
 assert.equal((await op(state,["tasks","xweb","--state","blocked"])).stdout.includes("T-42"),true);
 assert.equal((await op(state,["tasks","xweb","--state","BLOCKED"])).stdout.includes("T-1 "),false);
});

test("task detail resolves dependencies and artifacts; --evidence exposes the canonical evidence",async()=>{
 const state=await tmpState(),h=harness();h.release();
 const result=await runAutonomous({plan:ProjectPlan.parse(xweb())},{state,selector:h.selector});
 assert.equal(result.final?.status,"ACCEPTED");
 const plain=(await op(state,["task","xweb","T-31"])).stdout;
 assert.match(plain,/TASK: T-31 — Datasource API/);
 assert.match(plain,/OWNER: backend-engineer .*REVIEWER: qa-reviewer/);
 assert.match(plain,/STATE: DONE\s+STAGE: done/);
 assert.match(plain,/DEPENDS ON: T-1/);
 assert.match(plain,/REVIEW: slot 0 PASS/);
 assert.doesNotMatch(plain,/EVIDENCE\n/);
 assert.match(plain,/add --evidence/);
 const view=await asJson(state,["task","xweb","T-31","--evidence"]);
 const stored=await state.artifacts.list("xweb");
 assert.deepEqual(view.evidence.outputArtifacts.map((a:any)=>a.id),stored.filter(a=>a.taskId==="T-31").map(a=>a.id));
 assert.ok(view.evidence.handoffsIn.some((x:any)=>x.fromTask==="T-1"&&x.from==="architect"));
 assert.ok(view.evidence.handoffsOut.some((x:any)=>x.to==="qa-engineer"));
 assert.equal(view.evidence.reviews[0].verdict,"PASS");
 assert.equal(view.evidence.reviews[0].reviewerRole,"qa-reviewer");
 assert.ok(view.evidence.attempts.some((a:any)=>a.taskId==="T-31"&&a.status==="SUCCEEDED"&&a.provider==="fake"));
 assert.ok(view.evidence.attempts.some((a:any)=>a.taskId.startsWith("T-31--review-")));
 assert.match(view.evidence.logLocation,/executions[\\/]xweb[\\/]records\.jsonl/);
 assert.equal(view.evidence.checkpoint.status,"DONE");
 const text=(await op(state,["task","xweb","T-31","--evidence"])).stdout;
 assert.match(text,/EVIDENCE/);
 assert.match(text,/output artifacts:\n- T-31-/);
 assert.match(text,/full logs: /);
 // a reviewer's execution id resolves to the task it reviewed
 assert.equal((await asJson(state,["task","xweb",view.evidence.attempts.find((a:any)=>a.taskId.includes("--review-")).taskId])).task.id,"T-31");
});

test("handoff view answers FROM / TO / TASK / INPUT / OUTPUT / DECISIONS / EVIDENCE / BLOCKERS / NEXT",async()=>{
 const state=await tmpState(),h=harness(),{run}=await startRunning(state,h);
 const pending:any[]=await asJson(state,["handoffs","xweb","T-42"]);
 assert.equal(pending.length,1);
 assert.equal(pending[0].from,"frontend-engineer");
 assert.equal(pending[0].to,"qa-engineer");
 assert.equal(pending[0].task,"T-42");
 assert.equal(pending[0].status,"PENDING");
 assert.match(pending[0].summary,/handoff from T-42/);
 assert.match(pending[0].nextExpectedAction,/T-50 \(qa-engineer\) is WAITING: waiting for T-31 \(RUNNING\)/);
 assert.equal(pending[0].output[0].kind,"document");
 assert.ok(pending[0].input.length>0);
 const text=(await op(state,["handoffs","xweb","--latest"])).stdout;
 for(const label of ["HANDOFF:","FROM:","TO:","TASK:","INPUT:","OUTPUT:","DECISIONS:","EVIDENCE:","BLOCKERS:","NEXT EXPECTED ACTION:"])assert.ok(text.includes(label),label);
 const consumed=(await asJson(state,["handoffs","xweb","T-1"])) as any[];
 assert.ok(consumed.length>=2&&consumed.every(x=>x.status==="CONSUMED"&&x.from==="architect"));
 // agents talk through artifacts: the overview lists handoffs, one line each, no raw bodies
 const overview=(await op(state,["handoffs","xweb"])).stdout;
 assert.match(overview,/HANDOFFS/);
 assert.doesNotMatch(overview,/BODY-MARKER/);
 h.release();await run;
});

test("review and QA results are visible with their canonical sources",async()=>{
 const state=await tmpState(),h=harness();h.release();
 await runAutonomous({plan:ProjectPlan.parse(xweb())},{state,selector:h.selector});
 await state.traceability.setRequirements("xweb","T-1",[{id:"REQ-001",basis:"FACT",text:"login works",evidence:[],acceptance:[{id:"AC-1",text:"given/when/then"}]},{id:"REQ-002",basis:"FACT",text:"export works",evidence:[],acceptance:[{id:"AC-2",text:"given/when/then"}]}]);
 await state.traceability.setTests("xweb","T-50","FAIL",[{requirementId:"REQ-001",testId:"TC-1",status:"FAIL",text:"login rejects valid user",evidence:"401 from /login",owner:"T-31"}]);
 const reviews=await asJson(state,["reviews","xweb"]);
 assert.deepEqual(reviews.tasks.map((t:any)=>t.taskId),["T-31"]);
 assert.deepEqual(reviews.tasks[0].slots,[{slot:0,verdict:"PASS"}]);
 assert.equal(reviews.tasks[0].reviewRole,"qa-reviewer");
 assert.equal(reviews.stored[0].verdict,"PASS");
 const reviewText=(await op(state,["reviews","xweb"])).stdout;
 assert.match(reviewText,/T-31\s+DONE\s+reviewer qa-reviewer/);
 const qa=await asJson(state,["qa","xweb"]);
 assert.equal(qa.qa.overall,"FAIL");
 assert.deepEqual(qa.requirements,{total:2,tested:1,untested:["REQ-002"]});
 assert.equal(qa.tests[0].owner,"T-31");
 const qaText=(await op(state,["qa","xweb"])).stdout;
 assert.match(qaText,/RESULT: FAIL \(by T-50/);
 assert.match(qaText,/1\/2 have at least one test \(untested: REQ-002\)/);
 assert.match(qaText,/TC-1 \[REQ-001\] FAIL: login rejects valid user \| 401 from \/login/);
});

test("logs are concise by default; raw model output is opt-in",async()=>{
 const state=await tmpState(),h=harness();h.release();
 await runAutonomous({plan:ProjectPlan.parse(xweb())},{state,selector:h.selector});
 const concise=(await op(state,["logs","xweb","T-31"])).stdout;
 assert.match(concise,/^LOG \(latest \d+ of \d+, concise/);
 assert.match(concise,/backend-engineer SUCCEEDED via fake\//);
 assert.doesNotMatch(concise,/BODY-MARKER/);
 assert.doesNotMatch(concise,/provider\.selected/);
 const tail=(await op(state,["logs","xweb","--tail","3"])).stdout.split("\n").filter(l=>/^\d{4}-/.test(l));
 assert.equal(tail.length,3);
 const full=(await op(state,["logs","xweb","T-31","--full"])).stdout;
 assert.match(full,/BODY-MARKER-x{400}/);
 assert.match(full,/provider\.selected/);
 const mine=(await op(state,["logs","xweb","--agent","qa-reviewer"])).stdout;
 assert.match(mine,/qa-reviewer SUCCEEDED/);
 assert.doesNotMatch(mine,/backend-engineer SUCCEEDED/);
});

test("unknown project, task, agent and invalid ids give explicit errors",async()=>{
 const state=await tmpState(),h=harness();h.release();
 await runAutonomous({plan:ProjectPlan.parse(xweb())},{state,selector:h.selector});
 const missing=await op(state,["status","nope"]);
 assert.equal(missing.code,1);assert.equal(missing.stdout,"");
 assert.match(missing.stderr,/^UNKNOWN_PROJECT: Unknown project 'nope'\. Known projects: xweb\./);
 for(const bad of ["../etc","a/b","x y"]){const r=await op(state,["status",bad]);assert.equal(r.code,1);assert.match(r.stderr,/^INVALID_PROJECT_ID/);}
 const task=await op(state,["task","xweb","T-999"]);
 assert.equal(task.code,1);assert.match(task.stderr,/UNKNOWN_TASK: Unknown task 'T-999' in project 'xweb'\. Tasks: T-1, T-31, T-42, T-50\./);
 const agent=await op(state,["agents","xweb","--agent","ghost"]);
 assert.equal(agent.code,1);assert.match(agent.stderr,/UNKNOWN_AGENT/);
 const unknownCommand=await op(state,["frobnicate","xweb"]);
 assert.equal(unknownCommand.code,2);assert.match(unknownCommand.stderr,/Unknown command 'frobnicate'/);
 const emptyState=await tmpState();
 assert.match((await op(emptyState,["status"])).stderr,/NO_PROJECTS/);
 assert.equal((await op(emptyState,["projects"])).stdout.trim(),"No projects.");
});

test("ambiguous project selection never silently picks a project",async()=>{
 const state=await tmpState(),h=harness();h.release();
 await runAutonomous({plan:ProjectPlan.parse(xweb("alpha"))},{state,selector:h.selector});
 // one project: unambiguous, and the output says it was inferred
 assert.match((await op(state,["status"])).stdout,/PROJECT: alpha  \(the only project\)/);
 await runAutonomous({plan:ProjectPlan.parse(xweb("beta"))},{state,selector:h.selector});
 for(const argv of [["status"],["agents"],["task","T-31"],["logs"],["stop"],["resume"],["priority","T-31"]]){
  const r=await op(state,argv);
  assert.equal(r.code,2,argv.join(" "));assert.equal(r.stdout,"",argv.join(" "));
  assert.match(r.stderr,/^AMBIGUOUS_PROJECT: .*alpha, beta/,argv.join(" "));
 }
 assert.match((await op(state,["status","--project","beta"])).stdout,/^PROJECT: beta\n/);
 assert.match((await op(state,["task","T-31","--project","alpha"])).stdout,/^TASK: T-31/);
 assert.equal((await op(state,["status","alpha","--project","beta"])).code,2);
 assert.match((await op(state,["projects"])).stdout,/alpha[\s\S]*beta/);
});

test("multiple projects stay isolated: views, logs and stop requests never cross",async()=>{
 const state=await tmpState(),h=harness(),other=harness("none");
 other.release();
 await runAutonomous({plan:ProjectPlan.parse(xweb("shop","s-"))},{state,selector:other.selector});
 const run=await startRunning(state,h);
 const shop=await asJson(state,["status","shop"]),web=await asJson(state,["status","xweb"]);
 assert.equal(shop.engine.state,"FINISHED");assert.equal(web.engine.state,"RUNNING");
 assert.equal(shop.tasks.done,4);assert.equal(web.tasks.done,2);
 assert.ok((await asJson(state,["tasks","shop"])).every((t:any)=>t.id.startsWith("s-")));
 assert.ok((await asJson(state,["tasks","xweb"])).every((t:any)=>!t.id.startsWith("s-")));
 assert.ok(!(await op(state,["logs","xweb","--full"])).stdout.includes("s-T-"));
 assert.ok(!(await op(state,["handoffs","xweb"])).stdout.includes("s-T-"));
 // stopping the idle project does nothing, and does not touch the running one
 const idle=await asJson(state,["stop","shop"]);
 assert.equal(idle.requested,false);
 assert.equal(await state.stops.load("shop"),undefined);assert.equal(await state.stops.load("xweb"),undefined);
 const live=await asJson(state,["stop","xweb"]);
 assert.equal(live.requested,true);
 assert.equal((await state.stops.load("xweb"))?.projectId,"xweb");assert.equal(await state.stops.load("shop"),undefined);
 h.release();await run;
 assert.equal((await asJson(state,["status","shop"])).final.status,"ACCEPTED");
});

test("safe stop parks unfinished work without torn state, and resume never repeats completed work",async()=>{
 const state=await tmpState(),h=harness(),{run}=await startRunning(state,h);
 // resume is refused while an engine is running: never two engines on one project
 const refused=await op(state,["resume","xweb"],h);
 assert.equal(refused.code,1);assert.match(refused.stderr,/^CONFLICT: An engine is running for 'xweb'/);
 const callsWhileRunning=h.calls.length;
 const stop=await asJson(state,["stop","xweb","--reason","lunch"]);
 assert.equal(stop.requested,true);assert.deepEqual(stop.inFlight,["T-31"]);
 h.release();
 const stopped:AutonomousResult=await run;
 assert.match(stopped.stopped??"",/lunch/);
 assert.equal(stopped.final?.status,"PARKED");
 assert.match(stopped.final!.reasons[0],/^stopped by operator: lunch/);
 // no torn state: the in-flight step finished and was persisted; nothing is left half-written
 assert.equal(await state.executions.corruptLines("xweb"),0);
 assert.equal(await state.stops.load("xweb"),undefined);
 const status=await asJson(state,["status","xweb"]);
 assert.equal(status.engine.state,"FINISHED");
 assert.match(status.stopped,/stopped by operator: lunch/);
 const byId=Object.fromEntries((await asJson(state,["tasks","xweb"])).map((t:any)=>[t.id,t]));
 assert.equal(byId["T-1"].state,"DONE");assert.equal(byId["T-42"].state,"DONE");
 assert.equal(byId["T-31"].state,"READY");assert.equal(byId["T-31"].stage,"review");
 assert.equal(byId["T-50"].state,"WAITING");
 assert.equal(h.calls.filter(c=>c.task==="T-31"&&c.kind==="maker").length,1);
 assert.equal(h.calls.filter(c=>c.kind==="review").length,0);
 assert.ok(callsWhileRunning<=h.calls.length);
 const before=await state.executions.list("xweb"),doneBefore=before.filter(r=>r.status==="SUCCEEDED").map(r=>r.id);
 const artifactsBefore=(await state.artifacts.list("xweb")).map(a=>a.id);
 // resume continues from the persisted plan and log
 const mark=h.calls.length;
 const resumed=await op(state,["resume","xweb"],h);
 assert.equal(resumed.code,0,resumed.stderr);
 assert.match(resumed.stdout,/SKIPPED \(already complete, not re-run\): .*T-1/);
 assert.match(resumed.stdout,/SKIPPED \(already complete, not re-run\): .*T-42/);
 assert.match(resumed.stdout,/FINAL: ACCEPTED/);
 const after=h.calls.slice(mark);
 assert.deepEqual(after.filter(c=>c.task==="T-1"||c.task==="T-42"),[]);
 assert.equal(after.filter(c=>c.task==="T-31"&&c.kind==="maker").length,0);
 assert.equal(after.filter(c=>c.task==="T-31"&&c.kind==="review").length,1);
 assert.equal(after.filter(c=>c.task==="T-50"&&c.kind==="maker").length,1);
 const records=await state.executions.list("xweb");
 assertNoDuplicateWork(records);
 for(const id of doneBefore)assert.ok(records.some(r=>r.id===id&&r.status==="SUCCEEDED"),"completed work survives resume");
 assert.ok(artifactsBefore.every(id=>records.some(r=>r.artifactRefs.includes(id))),"artifacts produced before the stop are still referenced");
 assert.equal((await asJson(state,["status","xweb"])).stopped,undefined);
 // a finished project has nothing to resume
 const callsDone=h.calls.length,again=await op(state,["resume","xweb"],h);
 assert.equal(again.code,0);assert.match(again.stdout,/already complete \(ACCEPTED\); nothing to resume/);
 assert.equal(h.calls.length,callsDone);
});

test("stop with no engine running changes nothing; a stale stop request cannot stop a later run",async()=>{
 const state=await tmpState(),h=harness();h.release();
 await state.executions.append({id:"e1",projectId:"xweb",taskId:"T-1",agentRole:"architect",provider:"fake",model:"m",status:"SUCCEEDED",startedAt:"2026-01-01T00:00:00Z",finishedAt:"2026-01-01T00:00:01Z",output:"x"});
 const idle=await asJson(state,["stop","xweb"]);
 assert.equal(idle.requested,false);assert.match(idle.message,/No engine is running/);
 assert.equal(await state.stops.load("xweb"),undefined);
 await state.stops.request({projectId:"xweb",runId:"some-older-run",reason:"old"});
 const result=await runAutonomous({plan:ProjectPlan.parse(xweb())},{state,selector:h.selector});
 assert.equal(result.final?.status,"ACCEPTED");
 assert.equal(result.stopped,undefined);
});

test("resume refuses --dry-run over real provider output, and a project without a plan",async()=>{
 const state=await tmpState(),h=harness(),{run}=await startRunning(state,h);
 const stop=await asJson(state,["stop","xweb"]);assert.equal(stop.requested,true);
 h.release();await run;
 const dry=await op(state,["resume","xweb","--dry-run"],h);
 assert.equal(dry.code,1);assert.match(dry.stderr,/^CONFLICT: Refusing --dry-run/);
 const empty=await tmpState();
 await empty.executions.append({id:"e1",projectId:"ghost",taskId:"T-1",agentRole:"dev",provider:"fake",model:"m",status:"SUCCEEDED",startedAt:"2026-01-01T00:00:00Z",finishedAt:"2026-01-01T00:00:01Z",output:"x"});
 const noPlan=await op(empty,["resume","ghost"],h);
 assert.equal(noPlan.code,1);assert.match(noPlan.stderr,/^NO_PLAN/);
 const noEngine=await op(state,["resume","xweb"]);
 assert.equal(noEngine.code,1);assert.match(noEngine.stderr,/UNSUPPORTED/);
});

test("priority changes go through the plan: preview first, refused while running, dependencies and finished work untouched",async()=>{
 const state=await tmpState(),h=harness(),{run}=await startRunning(state,h);
 const planBefore=await state.runs.loadPlan("xweb");
 // preview never writes, even while running
 const preview=await asJson(state,["priority","xweb","T-50"]);
 assert.equal(preview.applied,false);assert.match(preview.message,/^Preview \(nothing written; add --apply\)/);
 assert.deepEqual(await state.runs.loadPlan("xweb"),planBefore);
 // applying under a live engine is refused: it holds its own copy of the plan
 const live=await op(state,["priority","xweb","T-50","--apply"]);
 assert.equal(live.code,1);assert.match(live.stderr,/^CONFLICT: An engine is running/);
 assert.deepEqual(await state.runs.loadPlan("xweb"),planBefore);
 await asJson(state,["stop","xweb"]);h.release();await run;
 // finished work cannot be reprioritised
 const done=await op(state,["priority","xweb","T-1","--apply"]);
 assert.equal(done.code,1);assert.match(done.stderr,/UNSUPPORTED: Task T-1 is already done/);
 const recordsBefore=await state.executions.list("xweb"),runBefore=await state.runs.load("xweb");
 const applied=await asJson(state,["priority","xweb","T-50","--apply"]);
 assert.equal(applied.applied,true);
 assert.deepEqual(applied.changes.map((c:any)=>c.taskId),["T-31","T-50"]);
 const planAfter=(await state.runs.loadPlan("xweb"))!,pri=(id:string)=>planAfter.tasks.find(t=>t.id===id)!.priority;
 assert.ok(pri("T-50")>pri("T-1")&&pri("T-31")>pri("T-42"),"target and its unfinished upstream outrank everything else unfinished");
 assert.equal(pri("T-42"),planBefore!.tasks.find(t=>t.id==="T-42")!.priority);
 assert.equal(pri("T-1"),planBefore!.tasks.find(t=>t.id==="T-1")!.priority);
 const shape=(p:typeof planAfter)=>p.tasks.map(t=>[t.id,t.agentRole,t.dependencies,t.review?.role,t.prompt]);
 assert.deepEqual(shape(planAfter),shape(planBefore!));
 // runtime facts are not edited: only the plan and an audit note change
 assert.deepEqual(await state.executions.list("xweb"),recordsBefore);
 const runAfter=(await state.runs.load("xweb"))!;
 assert.equal(runAfter.planHash,hashOf(planAfter));assert.notEqual(runAfter.planHash,runBefore!.planHash);
 assert.ok(runAfter.notes.some(n=>n.startsWith("operator: priority raised")));
 assert.match(await state.memory.read("xweb","STATUS.md"),/PRIORITY_CHANGED/);
 // idempotent: a second apply finds nothing to change
 assert.equal((await asJson(state,["priority","xweb","T-50","--apply"])).applied,false);
 // the changed plan is what resume schedules from
 const resumed=await op(state,["resume","xweb"],h);
 assert.equal(resumed.code,0,resumed.stderr);assert.match(resumed.stdout,/FINAL: ACCEPTED/);
});

test("read commands never modify a dirty external workspace",async()=>{
 const state=await tmpState(),repo=await tmpDir("operator-ws-");
 const git=async(...args:string[])=>(await execFileAsync("git",["-C",repo,...args])).stdout;
 await git("init","-q");await git("config","user.email","t@example.com");await git("config","user.name","t");
 await writeFile(join(repo,"app.txt"),"v1\n");await git("add","-A");await git("commit","-qm","init");
 const head=(await git("rev-parse","HEAD")).trim();
 await writeFile(join(repo,"app.txt"),"uncommitted user edit\n");await writeFile(join(repo,"scratch.txt"),"untracked\n");await mkdir(join(repo,"sub"));await writeFile(join(repo,"sub","wip.txt"),"wip\n");
 const projectPlan=ProjectPlan.parse(plan("ws",[task("W-1",{agentRole:"dev",prompt:"change app"}),task("W-2",{agentRole:"qa",dependencies:["W-1"],prompt:"verify"})],{workspace:{path:repo}}));
 await state.runs.savePlan(projectPlan);
 await state.runs.save({version:1,projectId:"ws",planHash:hashOf(projectPlan),completedPhases:["PLAN"],phase:"EXECUTE",startedAt:"2026-01-01T00:00:00Z",updatedAt:"2026-01-01T00:00:00Z",notes:[]});
 await state.executions.append({id:"w1",projectId:"ws",taskId:"W-1",agentRole:"dev",provider:"fake",model:"m",status:"SUCCEEDED",startedAt:"2026-01-01T00:00:00Z",finishedAt:"2026-01-01T00:00:02Z",output:"patched",commitSha:head,changedFiles:["app.txt"],gates:[{name:"unit-tests",status:"PASS"}]});
 const snapshot=async()=>({status:await git("status","--porcelain=v1","-uall"),head:(await git("rev-parse","HEAD")).trim(),app:await readFile(join(repo,"app.txt"),"utf8"),scratch:await readFile(join(repo,"scratch.txt"),"utf8"),wip:await readFile(join(repo,"sub","wip.txt"),"utf8"),stash:await git("stash","list"),branches:await git("branch","--list")});
 const before=await snapshot();
 for(const argv of [["status","ws"],["agents","ws"],["tasks","ws"],["task","ws","W-1","--evidence"],["handoffs","ws"],["blockers","ws"],["reviews","ws"],["qa","ws"],["logs","ws","--full"],["usage","ws"],["projects"],["stop","ws"],["priority","ws","W-2"]]){
  const r=await op(state,argv);assert.equal(r.code,0,argv.join(" ")+": "+r.stderr);
 }
 assert.deepEqual(await snapshot(),before);
 // the recorded commit is checked read-only against the repository
 const evidence=await asJson(state,["task","ws","W-1","--evidence"]);
 assert.deepEqual(evidence.evidence.commits,[{sha:head,inRepository:"yes"}]);
 assert.deepEqual(evidence.evidence.gates,[{name:"unit-tests",status:"PASS"}]);
});

test("operator output never leaks credentials, in text, JSON, evidence or full logs",async()=>{
 const state=await tmpState(),key=fakeAnthropicKey(),envSecret="hunter2-registered-secret";
 registerSecret(envSecret);
 try{
  const p=ProjectPlan.parse(plan("leaky",[task("L-1",{agentRole:"dev",prompt:"do it with "+key}),task("L-2",{agentRole:"qa",dependencies:["L-1"],prompt:"verify"})]));
  await state.runs.savePlan(p);
  await state.runs.save({version:1,projectId:"leaky",planHash:hashOf(p),completedPhases:["PLAN"],phase:"EXECUTE",startedAt:"2026-01-01T00:00:00Z",updatedAt:"2026-01-01T00:00:00Z",notes:["note "+key],stopped:"waiting with "+key});
  await state.executions.append({id:"l1",projectId:"leaky",taskId:"L-1",agentRole:"dev",provider:"fake",model:"m",status:"FAILED",startedAt:"2026-01-01T00:00:00Z",finishedAt:"2026-01-01T00:00:02Z",output:"Authorization: "+bearer()+" and "+key,error:"auth failed for "+key+" / "+envSecret,evidence:["token "+key]});
  await state.checkpoints.save("leaky",{taskId:"L-1",at:"2026-01-01T00:00:02Z",status:"BLOCKED",completed:[],remaining:["fix "+key],artifactRefs:[],decisionRefs:[],compactContext:"crashed using "+key+" and "+envSecret});
  await state.handoffs.save("leaky","h1",{id:"h1",projectId:"leaky",taskId:"L-1",fromRole:"dev",toRole:"qa",summary:"use "+key,refs:["a1"],createdAt:"2026-01-01T00:00:02.000Z"});
  await state.decisions.save("leaky","d1",{id:"d1",projectId:"leaky",taskId:"L-1",title:"t",decision:"keep "+key,rationale:"r",createdAt:"2026-01-01T00:00:02.000Z"});
  await state.blockers.save("leaky","b1",{id:"b1",projectId:"leaky",taskId:"L-1",agentRole:"dev",body:"stuck on "+envSecret,status:"OPEN",createdAt:"2026-01-01T00:00:02.000Z"});
  await state.reviews.save("leaky","r1",{id:"r1",projectId:"leaky",taskId:"L-1",reviewerRole:"rev",verdict:"CHANGES_REQUIRED",body:"CHANGES_REQUIRED\n"+key,createdAt:"2026-01-01T00:00:03.000Z"});
  await state.telemetry.append("leaky",{runId:"r",type:"task.blocked",taskId:"L-1",detail:"failed with "+key});
  await state.traceability.setTests("leaky","L-2","FAIL",[{requirementId:"R-1",testId:"T-1",status:"FAIL",text:"x "+key,evidence:"ev "+envSecret}]);
  let seen=0;
  for(const argv of [["status"],["agents"],["tasks"],["task","L-1"],["task","L-1","--evidence"],["handoffs"],["handoffs","--latest"],["blockers"],["reviews"],["qa"],["logs"],["logs","--full"],["logs","L-1","--full"],["usage"],["priority","L-1"]]){
   for(const extra of [[],["--json"]]){
    const r=await op(state,[...argv,"--project","leaky",...extra]);
    const all=r.stdout+r.stderr;
    assert.ok(!all.includes(key),argv.join(" ")+" leaked the key");
    assert.ok(!all.includes(envSecret),argv.join(" ")+" leaked the registered secret");
    assert.ok(!all.includes(bearer().split(" ")[1]),argv.join(" ")+" leaked a bearer token");
    if(all.includes("[REDACTED]"))seen++;
   }
  }
  assert.ok(seen>0,"redaction actually happened");
 }finally{clearRegisteredSecrets();}
});

test("operator read commands leave the whole state byte-identical: no bypass, no hidden writes",async()=>{
 const state=await tmpState(),h=harness();h.release();
 await runAutonomous({plan:ProjectPlan.parse(xweb())},{state,selector:h.selector});
 const before=await snapshotState(state.root),calls=h.calls.length;
 for(const argv of [["projects"],["status","xweb"],["agents","xweb"],["tasks","xweb"],["task","xweb","T-31"],["task","xweb","T-31","--evidence"],["handoffs","xweb"],["handoffs","xweb","T-1"],["handoffs","xweb","--latest"],["blockers","xweb"],["reviews","xweb"],["qa","xweb"],["logs","xweb"],["logs","xweb","T-31","--full"],["usage","xweb"],["priority","xweb","T-50"],["stop","xweb"],["resume","xweb"],["help"]]){
  for(const extra of [[],["--json"]]){const r=await op(state,[...argv,...extra],h);assert.ok(r.code<=2,argv.join(" ")+": "+r.stderr);}
 }
 assert.deepEqual(changedPaths(before,await snapshotState(state.root)),[]);
 assert.equal(h.calls.length,calls,"no provider was called");
});

test("the mutating commands write only through the engine's own mechanisms",async()=>{
 const state=await tmpState(),h=harness(),{run}=await startRunning(state,h);
 const beforeStop=await quietState(state.root);
 assert.equal((await asJson(state,["stop","xweb"])).requested,true);
 assert.deepEqual(changedPaths(beforeStop,await snapshotState(state.root)),["stops/xweb.json"]);
 h.release();await run;
 const beforePriority=await snapshotState(state.root);
 assert.equal((await asJson(state,["priority","xweb","T-50","--apply"])).applied,true);
 assert.deepEqual(changedPaths(beforePriority,await snapshotState(state.root)),["projects/xweb/STATUS.md","runs/xweb.json","runs/xweb.plan.json"]);
});

test("store listing and stop requests tolerate torn files and never trust them",async()=>{
 const state=await tmpState();
 await state.handoffs.save("p1","good",{id:"good",projectId:"p1",taskId:"A",fromRole:"x",toRole:"y",summary:"s",refs:[],createdAt:"2026-01-01T00:00:00.000Z"});
 await writeFile(join(state.root,"handoffs","p1","torn.json"),'{"id":"torn","proj');
 await writeFile(join(state.root,"handoffs","p1","foreign.json"),'{"unrelated":true}');
 assert.deepEqual((await state.handoffs.list("p1")).map(h=>h.id),["good"]);
 assert.deepEqual(await state.handoffs.list("no-such-project"),[]);
 await mkdir(join(state.root,"stops"),{recursive:true});
 await writeFile(join(state.root,"stops","p1.json"),"{not json");
 assert.equal(await state.stops.load("p1"),undefined);
 await assert.rejects(()=>state.handoffs.list("../escape"));
});

test("the operator CLI works as a real process: read, errors and exit codes",async()=>{
 const state=await tmpState(),h=harness();h.release();
 await runAutonomous({plan:ProjectPlan.parse(xweb("alpha"))},{state,selector:h.selector});
 const cli=(args:string[])=>execFileAsync(join(process.cwd(),"node_modules",".bin","tsx"),["src/operator-cli.ts",...args,"--state-dir",state.root],{cwd:process.cwd(),env:{...process.env,ANTHROPIC_API_KEY:""}}).then(r=>({code:0,...r}),(e:any)=>({code:e.code as number,stdout:e.stdout as string,stderr:e.stderr as string}));
 const ok=await cli(["status"]);
 assert.equal(ok.code,0);assert.match(ok.stdout,/PROJECT: alpha  \(the only project\)/);assert.match(ok.stdout,/DONE: 4 task\(s\)/);
 const json=await cli(["tasks","alpha","--json"]);assert.equal(JSON.parse(json.stdout).length,4);
 const bad=await cli(["status","nope"]);assert.equal(bad.code,1);assert.match(bad.stderr,/UNKNOWN_PROJECT/);
 await runAutonomous({plan:ProjectPlan.parse(xweb("beta"))},{state,selector:h.selector});
 const ambiguous=await cli(["status"]);assert.equal(ambiguous.code,2);assert.match(ambiguous.stderr,/AMBIGUOUS_PROJECT/);
 const help=await cli(["help"]);assert.equal(help.code,0);assert.match(help.stdout,/Usage: npm run operator/);
});

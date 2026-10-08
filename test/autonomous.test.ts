import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {PlanChangedError,PROJECT_APPROVAL_KEY,runAutonomous} from "../src/autonomous.js";
import {computeFinalStatus} from "../src/final-status.js";
import {createCapacitySelector} from "../src/provider-selector.js";
import {DryRunProvider,dryRunSelector} from "../src/providers/dry-run.js";
import {PHASES,type Phase} from "../src/run-store.js";
import {createStatusServer} from "../src/status-server.js";
import {projectStatusView} from "../src/status-view.js";
import type {ProjectPlanValue} from "../src/project.js";
import type {TraceValue} from "../src/traceability.js";
import {tmpState} from "./helpers.js";

const brief={projectId:"auto1",objective:"Build a secure backend service ready for deployment",capabilities:["backend","deployment","security-critical"] as ("backend"|"deployment"|"security-critical")[],complexity:4 as const};
const priced=(extra:Record<string,unknown>={})=>createCapacitySelector([{id:"pool",provider:"dry-run",model:"det",state:"AVAILABLE",capabilities:["reasoning","product","architecture","coding","design","deployment","testing","review"],contextWindow:200000,maxConcurrency:4,inputCostPerMillion:1,outputCostPerMillion:1,...extra}],()=>new DryRunProvider());
const countSucceeded=async(state:Awaited<ReturnType<typeof tmpState>>,project:string)=>(await state.executions.list(project)).filter(r=>r.status==="SUCCEEDED").length;

test("the pipeline runs brief to retrospective in one command and persists every phase",async()=>{
 const state=await tmpState();
 const result=await runAutonomous({brief},{state,selector:priced(),knownRoles:[],knownSkills:[]});
 assert.equal(result.phase,"DONE");assert.equal(result.final?.status,"ACCEPTED_WITH_RISKS");
 const run=await state.runs.load("auto1");assert.deepEqual(run?.completedPhases,[...PHASES]);
 assert.ok(result.estimate&&result.estimate.totalKnownCost>0&&result.estimate.reviews.length>0,"the estimate includes independent reviews");
 assert.ok(await state.retrospectives.load("auto1"));assert.match(await state.memory.read("auto1","RETROSPECTIVE.md"),/RETROSPECTIVE/);
 assert.match(await state.memory.read("auto1","STATUS.md"),/FINAL STATUS — ACCEPTED_WITH_RISKS/);
 const status=await projectStatusView(state,"auto1");assert.equal(status.state,"FINISHED");assert.equal(status.phase,"DONE");assert.equal(status.final?.status,"ACCEPTED_WITH_RISKS");assert.equal(status.plannedTasks,result.plan.tasks.length);
});

for(const crashAfter of ["PLAN","ESTIMATE","APPROVAL","EXECUTE","FINALIZE","RETROSPECTIVE"] as Phase[]){
 test("crash after the "+crashAfter+" phase resumes to the same result without repeating successful work",async()=>{
  const clean=await tmpState();await runAutonomous({brief},{state:clean,selector:priced(),knownRoles:[],knownSkills:[]});
  const expected=await countSucceeded(clean,"auto1");
  const state=await tmpState();let armed=true;
  const hook=async(phase:Phase)=>{if(armed&&phase===crashAfter){armed=false;throw new Error("simulated process crash after "+phase);}};
  await assert.rejects(()=>runAutonomous({brief},{state,selector:priced(),afterPhase:hook,knownRoles:[],knownSkills:[]}),/simulated process crash/);
  const before=await countSucceeded(state,"auto1");
  const resumed=await runAutonomous({brief},{state,selector:priced(),knownRoles:[],knownSkills:[]});
  assert.equal(resumed.phase,"DONE");assert.equal(resumed.final?.status,"ACCEPTED_WITH_RISKS");
  assert.equal(await countSucceeded(state,"auto1"),expected,"no task ran twice");assert.ok(await countSucceeded(state,"auto1")>=before);
  const items=await state.experience.list();assert.ok(items.every(i=>i.observations<=1),"the company learns from a project once, even across crashes");
  assert.deepEqual((await state.runs.load("auto1"))?.completedPhases,[...PHASES]);
  assert.equal((await state.memory.read("auto1","STATUS.md")).match(/FINAL STATUS/g)?.length,1,"the final status block is replaced, not duplicated");
 });
}

test("the plan is persisted at PLAN time, so a resume never recompiles something different",async()=>{
 const state=await tmpState();let armed=true;
 await assert.rejects(()=>runAutonomous({brief},{state,selector:priced(),afterPhase:async p=>{if(armed&&p==="PLAN"){armed=false;throw new Error("crash");}},knownRoles:[],knownSkills:[]}),/crash/);
 const persisted=JSON.stringify(await state.runs.loadPlan("auto1"));
 // new experience appears between the crash and the resume; the persisted plan must not change
 await state.experience.observe({projectId:"x1",createdAt:new Date().toISOString(),dryRun:false,totalRuns:1,failures:0,paused:0,revisions:0,reviewRounds:0,inputTokens:0,outputTokens:0,estimatedCost:0,actualCost:0,lessons:[],candidates:[{pattern:"Keep review findings short.",scope:"GLOBAL",kind:"process",evidence:["a"]}]});
 await runAutonomous({brief},{state,selector:priced(),knownRoles:[],knownSkills:[]});
 assert.equal(JSON.stringify(await state.runs.loadPlan("auto1")),persisted);
});

test("a changed brief is refused unless --replan is given; finished tasks stay finished after a replan",async()=>{
 const state=await tmpState();
 await runAutonomous({brief},{state,selector:priced(),knownRoles:[],knownSkills:[]});
 const before=await countSucceeded(state,"auto1");
 await assert.rejects(()=>runAutonomous({brief:{...brief,objective:"Build a completely different secure backend service"}},{state,selector:priced()}),PlanChangedError);
 const replanned=await runAutonomous({brief:{...brief,objective:"Build a completely different secure backend service"}},{state,selector:priced(),replan:true,knownRoles:[],knownSkills:[]});
 assert.equal(replanned.phase,"DONE");assert.equal(await countSucceeded(state,"auto1"),before,"completed tasks are not redone");
});

test("estimate: a project whose estimate exceeds the budget stops before any model call",async()=>{
 const state=await tmpState();let calls=0;
 const selector=createCapacitySelector([{id:"pool",provider:"dry-run",model:"det",state:"AVAILABLE",capabilities:["reasoning","product","architecture","coding","design","deployment","testing","review"],contextWindow:200000,maxConcurrency:4,inputCostPerMillion:1000,outputCostPerMillion:1000}],()=>({name:"dry-run",model:"det",async generate(){calls++;throw new Error("must not be called");}}));
 const result=await runAutonomous({brief:{...brief,budget:{maxProjectCost:0.05}}},{state,selector});
 assert.equal(result.phase,"ESTIMATE");assert.match(result.stopped??"",/exceeds the project budget/);assert.equal(calls,0);
 assert.match(await state.memory.read("auto1","STATUS.md"),/BLOCKED_BUDGET/);
});

test("approval: an expensive project waits for a persisted project approval and then continues",async()=>{
 const state=await tmpState();
 const approvalBrief={...brief,budget:{projectApprovalThreshold:0.0001}};
 const first=await runAutonomous({brief:approvalBrief},{state,selector:priced(),knownRoles:[],knownSkills:[]});
 assert.equal(first.phase,"APPROVAL");assert.match(first.stopped??"",/project approval required/);assert.equal(await countSucceeded(state,"auto1"),0);
 const request=await state.approvals.loadRequest("auto1",PROJECT_APPROVAL_KEY);assert.equal(request?.status,"PENDING");
 await state.approvals.approve("auto1",PROJECT_APPROVAL_KEY,undefined,"owner");
 const second=await runAutonomous({brief:approvalBrief},{state,selector:priced(),knownRoles:[],knownSkills:[]});
 assert.equal(second.phase,"DONE");assert.ok(await countSucceeded(state,"auto1")>0);
});

test("approval wait: the pipeline blocks inside the run and proceeds as soon as the approval appears",async()=>{
 const state=await tmpState();
 const approvalBrief={...brief,projectId:"auto-wait",budget:{projectApprovalThreshold:0.0001}};
 setTimeout(()=>{void state.approvals.approve("auto-wait",PROJECT_APPROVAL_KEY,1,"owner");},60);
 const result=await runAutonomous({brief:approvalBrief},{state,selector:priced(),knownRoles:[],knownSkills:[],approvalWait:{pollMs:10,timeoutMs:5000}});
 assert.equal(result.phase,"DONE");
});

test("parked runs keep their phase and do not teach the company; failures surface as FAILED",async()=>{
 const state=await tmpState();
 const dead=createCapacitySelector([{id:"gone",provider:"x",model:"m",state:"OUT_OF_CREDIT",capabilities:["reasoning"],contextWindow:1000,maxConcurrency:1}],()=>{throw new Error("unreachable");});
 const parked=await runAutonomous({brief},{state,selector:dead,knownRoles:[],knownSkills:[]});
 assert.equal(parked.final?.status,"PARKED");assert.equal(parked.phase,"EXECUTE");assert.deepEqual((await state.runs.load("auto1"))?.completedPhases,["PLAN","ESTIMATE","APPROVAL"]);
 assert.deepEqual((await state.experience.list()).filter(i=>i.observations>0),[],"nothing is learned from an unfinished project");
 const resumed=await runAutonomous({brief},{state,selector:priced(),knownRoles:[],knownSkills:[]});
 assert.equal(resumed.phase,"DONE");
});

const plan=(over:Partial<{highRisk:boolean;qa:boolean;code:boolean;workspace:boolean}>={}):ProjectPlanValue=>({
 projectId:"fs",mode:"BALANCED",budget:{maxTeamCost:{},maxAgentCost:{}},research:{enabled:false,maxSourceAgeDays:730},signals:[],
 workspace:over.workspace?{path:".",checks:[],gates:{},setup:[],autoCommit:false,isolation:"none"}:undefined,
 tasks:[{id:"t",agentRole:"dev",department:"d",dependencies:[],system:"s",prompt:"p",inputRefs:[],produces:[],risk:"medium",skills:[],requiredGates:[],deliversCode:over.code??false,priority:0,contract:{sections:[],verdict:false,validators:over.qa?["qa-traceability"]:[],params:{}},maxTokens:1,capabilities:[],estimatedInputTokens:1,estimatedOutputTokens:1,
  review:over.highRisk?{role:"r",department:"q",system:"s",maxTokens:1,maxRounds:1,contract:{sections:[],verdict:true,validators:[],params:{}},level:"HIGH_RISK",gates:[],slots:[],capabilities:[],estimatedInputTokens:1,estimatedOutputTokens:1}:undefined}]
}) as unknown as ProjectPlanValue;
const done={completed:["t"],failed:[] as string[],paused:[] as string[],waiting:[] as string[],approvalRequired:[] as string[],disagreements:0};
const trace=(over:Partial<TraceValue>={}):TraceValue=>({version:1,requirements:[],tests:[],decisions:[],artifacts:[],architecture:[],...over});
const qa=(overall:"PASS"|"FAIL"|"BLOCKED"|"NOT_APPLICABLE")=>({taskId:"qa",overall,at:"now"});

test("final status: only complete, reviewed, QA-passed, verified work is ACCEPTED; everything else says why",()=>{
 const status=(p:ProjectPlanValue,s=done,t=trace())=>computeFinalStatus(p,s,[],t).status;
 assert.equal(status(plan()),"ACCEPTED");
 assert.equal(status(plan(),{...done,failed:["t"],completed:[]}),"FAILED");
 assert.equal(status(plan(),{...done,paused:["t"],completed:[]}),"PARKED");
 assert.equal(status(plan(),{...done,approvalRequired:["t"],completed:[]}),"PARKED");
 assert.equal(status(plan({qa:true}),done,trace({qa:qa("FAIL")})),"FAILED_QA");
 assert.equal(status(plan({qa:true}),done,trace({qa:qa("BLOCKED")})),"BLOCKED","BLOCKED is a QA outcome, not a reviewer verdict");
 assert.equal(status(plan({qa:true,highRisk:true}),done,trace()),"INCOMPLETE","HIGH_RISK needs the QA gate to have run");
 assert.equal(status(plan({qa:true,highRisk:true}),done,trace({qa:qa("PASS")})),"ACCEPTED");
 assert.equal(status(plan({code:true})),"ACCEPTED_WITH_RISKS","code with no workspace is unverified");
 const risky=computeFinalStatus(plan(),{...done,disagreements:2},[],trace({requirements:[{id:"REQ-1",basis:"ASSUMPTION",text:"x",evidence:[],acceptance:[],taskId:"ba"}],architecture:[{taskId:"tl",verdict:"PASS",categories:[],unresolvedRisks:["token storage"]}]}));
 assert.equal(risky.status,"ACCEPTED_WITH_RISKS");assert.equal(risky.risks.length,3);
});

test("the status API serves the live view, telemetry and task snapshots",async()=>{
 const state=await tmpState();await runAutonomous({brief},{state,selector:priced(),knownRoles:[],knownSkills:[]});
 const server=createStatusServer(join(state.root,"executions"),state);
 await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
 try{
  const address=server.address();if(!address||typeof address==="string")throw new Error("no address");
  const get=async(path:string)=>(await fetch("http://127.0.0.1:"+address.port+path)).json() as Promise<any>;
  const status=await get("/api/projects/auto1/status");
  assert.equal(status.state,"FINISHED");assert.equal(status.final.status,"ACCEPTED_WITH_RISKS");assert.ok(status.completed.length>0&&status.providers.pool>0);
  const telemetry=await get("/api/projects/auto1/telemetry");assert.ok(telemetry.events.some((e:{type:string})=>e.type==="run.finished"));
  assert.ok((await get("/api/projects/auto1/tasks")).tasks.length>0);
  assert.equal((await fetch("http://127.0.0.1:"+address.port+"/api/projects/..%2Fx/status")).status,400);
 }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});

test("the shipped example brief runs the whole pipeline in dry-run mode",async()=>{
 const state=await tmpState(),example=JSON.parse(await readFile("examples/project-brief.json","utf8"));
 const result=await runAutonomous({brief:example},{state,selector:dryRunSelector(),dryRun:true,knownRoles:[],knownSkills:[]});
 assert.equal(result.phase,"DONE");assert.deepEqual(result.summary?.failed,[]);assert.ok(result.final?.status.startsWith("ACCEPTED"));
});

test("supervised operation waits out capacity problems with backoff and resumes; people-needed outcomes are returned, not retried",async()=>{
 const {superviseAutonomous}=await import("../src/autonomous.js");
 const state=await tmpState();let attempts=0;const pauses:number[]=[];
 const outage=()=>createCapacitySelector([{id:"gone",provider:"x",model:"m",state:"RATE_LIMITED",resetAt:new Date(Date.now()+3_600_000).toISOString(),capabilities:["reasoning","product","architecture","coding","design","deployment","testing","review"],contextWindow:1000,maxConcurrency:1}],()=>{throw new Error("unreachable");});
 const result=await superviseAutonomous(async()=>{attempts++;return runAutonomous({brief},{state,selector:attempts<3?outage():priced(),knownRoles:[],knownSkills:[],orchestrator:{maxCooldownWaitMs:1}});},{minPauseMs:10,maxPauseMs:40,sleep:async ms=>{pauses.push(ms);}});
 assert.equal(attempts,3);assert.deepEqual(pauses,[10,20]);assert.equal(result.phase,"DONE");assert.ok(result.final?.status.startsWith("ACCEPTED"));
 const approvalState=await tmpState();let passes=0;
 const needsPerson=await superviseAutonomous(async()=>{passes++;return runAutonomous({brief:{...brief,projectId:"auto-sup",budget:{projectApprovalThreshold:0.0001}}},{state:approvalState,selector:priced(),knownRoles:[],knownSkills:[]});},{sleep:async()=>undefined});
 assert.equal(passes,1);assert.equal(needsPerson.phase,"APPROVAL");
 const deadlineState=await tmpState();let tries=0,clock=0;
 const giveUp=await superviseAutonomous(async()=>{tries++;return runAutonomous({brief:{...brief,projectId:"auto-dl"}},{state:deadlineState,selector:outage(),knownRoles:[],knownSkills:[],orchestrator:{maxCooldownWaitMs:1}});},{minPauseMs:100,maxWaitMs:250,now:()=>clock,sleep:async ms=>{clock+=ms;}});
 assert.ok(tries>=2&&tries<=4,"stops once the allowed total wait would be exceeded ("+tries+")");assert.equal(giveUp.final?.status,"PARKED");
});

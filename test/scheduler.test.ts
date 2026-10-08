import assert from "node:assert/strict";
import test from "node:test";
import {ProjectOrchestrator,pickNext} from "../src/orchestrator.js";
import {createCapacitySelector} from "../src/provider-selector.js";
import {RunMetrics} from "../src/metrics.js";
import {buildProjectStatus} from "../src/telemetry.js";
import {compliant,plan,rendezvous,selectorFor,task,tmpState,usage} from "./helpers.js";

const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const profile=(id:string,extra={})=>({id,inputCostPerMillion:1,outputCostPerMillion:1,maxConcurrency:1,...extra});

test("pickNext ranks by priority, ages waiting tasks so none starves, and breaks ties by id",()=>{
 const ready=new Map([["old-low",0],["new-high",29_000]]);
 const candidates=[{id:"old-low",priority:0},{id:"new-high",priority:3}];
 assert.equal(pickNext(candidates,ready,30_000,20_000)?.id,"new-high","priority wins while ages are comparable");
 assert.equal(pickNext(candidates,new Map([["old-low",0],["new-high",299_000]]),300_000,20_000)?.id,"old-low","a long wait eventually outranks priority");
 assert.equal(pickNext([{id:"b",priority:1},{id:"a",priority:1}],new Map(),0,1000)?.id,"a");
 assert.equal(pickNext([],new Map(),0,1000),undefined);
});

test("critical-path work is scheduled first when slots are scarce",async()=>{
 const order:string[]=[];
 const selector=selectorFor(request=>{order.push(request.prompt.split(" ")[0]);return usage(compliant());},[profile("p",{maxConcurrency:4})]);
 await new ProjectOrchestrator(selector,await tmpState(),{maxParallelTasks:1}).run(plan("prio",[task("low",{priority:0,prompt:"low work"}),task("mid",{priority:1,prompt:"mid work"}),task("high",{priority:5,prompt:"high work"})]));
 assert.deepEqual(order,["high","mid","low"]);
});

test("compiled plans give the tasks that unblock the most work the highest priority",async()=>{
 const {compileBriefToProjectPlan}=await import("../src/plan-compiler.js");
 const compiled=await compileBriefToProjectPlan({projectId:"crit",objective:"Build a backend service",capabilities:["backend","deployment"],complexity:3});
 const priority=(role:string)=>compiled.tasks.find(t=>t.agentRole===role)!.priority;
 assert.ok(priority("product-lead")>priority("business-analyst"));assert.ok(priority("business-analyst")>priority("tech-lead"));assert.ok(priority("tech-lead")>priority("backend-engineer"));assert.equal(priority("qa-engineer"),0);
});

test("per-project concurrency limits running tasks even when providers could run more (backpressure)",async()=>{
 let active=0,max=0;const meet=rendezvous(2);
 const selector=selectorFor(async()=>{active++;max=Math.max(max,active);await meet();await sleep(10);active--;return usage(compliant());},[profile("wide",{maxConcurrency:10})]);
 const summary=await new ProjectOrchestrator(selector,await tmpState(),{maxParallelTasks:2}).run(plan("bp",Array.from({length:6},(_,i)=>task("t"+i))));
 assert.equal(summary.completed.length,6);assert.equal(max,2);
});

test("per-provider concurrency: waiting tasks resume on completion events, not by polling",async()=>{
 let active=0,max=0,selections=0;
 const inner=selectorFor(async()=>{active++;max=Math.max(max,active);await sleep(15);active--;return usage(compliant());},[profile("solo",{maxConcurrency:1})]);
 const counting=Object.assign((request:Parameters<typeof inner>[0])=>{selections++;return inner(request);},{reportSuccess:inner.reportSuccess,reportFailure:inner.reportFailure,release:inner.release,snapshot:inner.snapshot,health:inner.health}) as typeof inner;
 const started=Date.now();
 const summary=await new ProjectOrchestrator(counting,await tmpState(),{maxParallelTasks:6}).run(plan("pp",Array.from({length:5},(_,i)=>task("t"+i))));
 assert.equal(summary.completed.length,5);assert.equal(max,1,"never more than the provider allows");
 assert.ok(summary.metrics.capacityWaits>0,"tasks queued for capacity");
 assert.ok(selections<60,"selection attempts happen on release events, not in a spin loop ("+selections+")");
 assert.ok(Date.now()-started<2000);
});

test("work stealing: whichever eligible provider frees first takes the next waiting task",async()=>{
 const use:Record<string,number>={};
 const selector=selectorFor(async(_request,profileId)=>{use[profileId]=(use[profileId]??0)+1;await sleep(profileId==="slow"?120:10);return usage(compliant());},[profile("slow",{maxConcurrency:1}),profile("fast",{maxConcurrency:1})]);
 const summary=await new ProjectOrchestrator(selector,await tmpState(),{maxParallelTasks:8}).run(plan("ws",Array.from({length:8},(_,i)=>task("t"+i))));
 assert.equal(summary.completed.length,8);assert.equal((use.slow??0)+(use.fast??0),8);
 assert.ok(use.fast>use.slow,"the fast provider drained more of the queue: "+JSON.stringify(use));
 assert.ok(summary.metrics.providers.fast.runs>summary.metrics.providers.slow.runs);
});

test("rate-limit cooldown: the task waits for the provider to recover instead of failing or pausing",async()=>{
 const state=await tmpState();let calls=0;const times:number[]=[];
 const selector=createCapacitySelector([{id:"only",provider:"fake",model:"m",state:"AVAILABLE",capabilities:["reasoning"],contextWindow:10000,maxConcurrency:1,inputCostPerMillion:1,outputCostPerMillion:1}],(provider,model)=>({name:provider,model,async generate(){calls++;times.push(Date.now());if(calls===1)throw new Error("429 rate limit");return usage(compliant());}}),{cooldownMs:80});
 const summary=await new ProjectOrchestrator(selector,state).run(plan("cd",[task("a")]));
 assert.deepEqual(summary.completed,["a"]);assert.deepEqual(summary.paused,[]);assert.equal(calls,2);assert.ok(times[1]-times[0]>=75,"waited for the cooldown ("+(times[1]-times[0])+"ms)");
 assert.equal(summary.failovers,1);assert.ok(summary.metrics.capacityWaits>=1);assert.equal(summary.metrics.retries,1);
});

test("a cooldown longer than the allowed wait parks the task as PAUSED_CAPACITY (resume later)",async()=>{
 const selector=createCapacitySelector([{id:"only",provider:"fake",model:"m",state:"AVAILABLE",capabilities:["reasoning"],contextWindow:10000,maxConcurrency:1}],(provider,model)=>({name:provider,model,async generate(){throw new Error("429 rate limit");}}),{cooldownMs:60_000});
 const state=await tmpState();
 const summary=await new ProjectOrchestrator(selector,state,{maxCooldownWaitMs:30}).run(plan("cd2",[task("a")]));
 assert.deepEqual(summary.paused,["a"]);assert.deepEqual(summary.failed,[]);
});

test("a task retries only on provider failures, bounded, and never repeats a succeeded step",async()=>{
 const state=await tmpState();let calls=0;
 const selector=createCapacitySelector([{id:"flaky",provider:"fake",model:"m",state:"AVAILABLE",capabilities:["reasoning"],contextWindow:10000,maxConcurrency:1},{id:"flaky2",provider:"fake",model:"m2",state:"AVAILABLE",capabilities:["reasoning"],contextWindow:10000,maxConcurrency:1}],(provider,model)=>({name:provider,model,async generate(){calls++;throw new Error("503 service unavailable");}}),{unavailableCooldownMs:1});
 const summary=await new ProjectOrchestrator(selector,state,{maxProviderAttempts:3}).run(plan("rt",[task("a")]));
 assert.ok(summary.failed.includes("a")||summary.paused.includes("a"));assert.ok(calls<=3,"bounded attempts ("+calls+")");
 const clean=await new ProjectOrchestrator(selectorFor(()=>{throw new Error("schema exploded");},[profile("p")]),await tmpState()).run(plan("rt2",[task("a")]));
 assert.deepEqual(clean.failed,["a"]);assert.equal(clean.metrics.retries,0,"non-provider errors are not retried");
});

test("metrics report queue wait, task latency, provider utilisation, throughput and token usage",async()=>{
 const selector=selectorFor(async()=>{await sleep(15);return usage(compliant());},[profile("m1",{maxConcurrency:1})]);
 const summary=await new ProjectOrchestrator(selector,await tmpState(),{maxParallelTasks:3}).run(plan("mx",[task("a"),task("b"),task("c")]));
 const m=summary.metrics;
 assert.equal(m.tasks.DONE,3);assert.ok(m.wallMs>=45);assert.equal(m.taskLatency.count,3);assert.ok(m.taskLatency.avgMs>=15);
 assert.equal(m.queueWait.count,3);assert.ok(m.providers.m1.runs>=3&&m.providers.m1.utilization>0.5&&m.providers.m1.utilization<=1.05);
 assert.ok(m.throughputPerMinute>0);assert.ok(m.usage.inputTokens>=30&&m.usage.outputTokens>=30);assert.ok(m.usage.knownCost>0);
 const direct=new RunMetrics(()=>1000);direct.taskReady("x");direct.taskStarted("x");direct.taskFinished("x","FAILED");
 assert.equal(direct.snapshot().tasks.FAILED,1);
});

test("telemetry events and the status view show current, queued, running and finished work",async()=>{
 const state=await tmpState();let release:()=>void=()=>undefined;const gate=new Promise<void>(r=>{release=r;});
 const selector=selectorFor(async request=>{if(request.prompt.startsWith("slow"))await gate;return usage(compliant());},[profile("p",{maxConcurrency:4})]);
 const p=plan("tel",[task("fast",{prompt:"fast work"}),task("slow",{prompt:"slow work"}),task("after",{dependencies:["slow"],prompt:"after work"})]);
 const running=new ProjectOrchestrator(selector,state).run(p);
 await sleep(150);
 const mid=buildProjectStatus("tel",await state.telemetry.list("tel"),await state.executions.list("tel"),{planTasks:["fast","slow","after"],isAlive:()=>true});
 assert.equal(mid.state,"RUNNING");assert.deepEqual(mid.running.map(r=>r.taskId),["slow"]);assert.deepEqual(mid.completed,["fast"]);assert.deepEqual(mid.queued,["after"]);assert.equal(mid.running[0].profileId,"p");
 const crashed=buildProjectStatus("tel",await state.telemetry.list("tel"),await state.executions.list("tel"),{planTasks:["fast","slow","after"],isAlive:()=>false});
 assert.equal(crashed.state,"INTERRUPTED");assert.deepEqual(crashed.running,[]);
 release();await running;
 const done=buildProjectStatus("tel",await state.telemetry.list("tel"),await state.executions.list("tel"),{planTasks:["fast","slow","after"]});
 assert.equal(done.state,"FINISHED");assert.deepEqual(done.completed.sort(),["after","fast","slow"]);assert.equal(done.providers.p,3);assert.ok(done.usage.inputTokens>0);assert.equal(done.usage.subscriptionRuns,0);
 const types=new Set((await state.telemetry.list("tel")).map(e=>e.type));
 for(const t of ["run.started","task.started","task.finished","provider.selected","run.finished"])assert.ok(types.has(t),t);
});

test("subscription runs are reported without a fake price in status usage",async()=>{
 const state=await tmpState();
 const selector=selectorFor(()=>usage(compliant()),[{id:"sub",billing:"subscription",maxConcurrency:2}]);
 await new ProjectOrchestrator(selector,state).run(plan("subst",[task("a")]));
 const status=buildProjectStatus("subst",await state.telemetry.list("subst"),await state.executions.list("subst"),{});
 assert.equal(status.usage.subscriptionRuns,1);assert.equal(status.usage.knownCost,0);assert.equal(status.usage.unknownCostRuns,0);
});

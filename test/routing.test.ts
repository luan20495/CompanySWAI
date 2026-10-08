import assert from "node:assert/strict";
import test from "node:test";
import {writeFile} from "node:fs/promises";
import {join} from "node:path";
import type {CapacityProfile} from "../src/capacity.js";
import {rank,routeTask} from "../src/capacity.js";
import {ProjectOrchestrator} from "../src/orchestrator.js";
import {createCapacitySelector} from "../src/provider-selector.js";
import {ProviderRegistry} from "../src/provider.js";
import {createProviderRegistry,loadRuntime,readRuntimeFile,toCapacityProfile} from "../src/runtime.js";
import {compliant,plan,task,tmpDir,tmpState} from "./helpers.js";

const demand={capabilities:["coding"],estimatedInputTokens:1000,estimatedOutputTokens:1000};
const p=(id:string,extra:Partial<CapacityProfile>={}):CapacityProfile=>({id,provider:"x",model:"m-"+id,state:"AVAILABLE",capabilities:["coding"],contextWindow:100000,maxConcurrency:2,...extra});
const build=(profiles:CapacityProfile[],options={})=>createCapacitySelector(profiles,(provider,model)=>({name:provider,model,async generate(){return {text:"ok",inputTokens:1,outputTokens:1};}}),options);

const fleet=()=>[
 p("premium",{qualityTier:5,inputCostPerMillion:15,outputCostPerMillion:75,estimatedTokensPerSecond:40,locality:"remote"}),
 p("mid",{qualityTier:3,inputCostPerMillion:3,outputCostPerMillion:15,estimatedTokensPerSecond:80,locality:"remote"}),
 p("cheap",{qualityTier:2,inputCostPerMillion:0.2,outputCostPerMillion:1,estimatedTokensPerSecond:150,locality:"remote"}),
 p("subscription",{qualityTier:4,billing:"subscription",locality:"local",estimatedTokensPerSecond:60})
];

test("COST_FIRST prefers the cheapest profile and treats subscription work as free marginal cost",()=>{
 assert.equal(rank(fleet(),demand,{policy:"COST_FIRST"})[0].id,"subscription");
 assert.equal(rank(fleet().filter(x=>x.id!=="subscription"),demand,{policy:"COST_FIRST"})[0].id,"cheap");
});
test("QUALITY_FIRST prefers the strongest tier regardless of price",()=>{
 assert.deepEqual(rank(fleet(),demand,{policy:"QUALITY_FIRST"}).map(x=>x.id),["premium","subscription","mid","cheap"]);
});
test("BALANCED trades quality, health, cost and latency",()=>{
 const ranked=rank(fleet(),demand,{policy:"BALANCED"}).map(x=>x.id);
 assert.equal(ranked[0],"subscription","high tier, free, local-speed beats the extremes");
 assert.notEqual(ranked[0],"premium");assert.equal(ranked.at(-1),"premium","the most expensive, slowest profile ranks last");
 const same=[p("slow",{qualityTier:3,estimatedTokensPerSecond:10}),p("fast",{qualityTier:3,estimatedTokensPerSecond:200})];
 assert.equal(rank(same,demand,{policy:"BALANCED"})[0].id,"fast","estimated latency breaks otherwise equal profiles");
});
test("LOCAL_FIRST uses local profiles while any qualifies and falls back to remote ones",()=>{
 assert.equal(rank(fleet(),demand,{policy:"LOCAL_FIRST"})[0].id,"subscription");
 const noLocal=fleet().map(x=>x.id==="subscription"?{...x,state:"RATE_LIMITED" as const}:x);
 assert.notEqual(routeTask(noLocal,demand,Date.now(),{policy:"LOCAL_FIRST"})?.locality,"local");
 assert.ok(["mid","cheap"].includes(routeTask(noLocal,demand,Date.now(),{policy:"LOCAL_FIRST"})!.id!),"remote candidates are ranked by the balanced policy");
});
test("ties resolve deterministically by profile id",()=>{
 const twins=[p("b",{qualityTier:3}),p("a",{qualityTier:3})];
 for(const policy of ["COST_FIRST","QUALITY_FIRST","BALANCED","LOCAL_FIRST"])assert.equal(rank(twins,demand,{policy})[0].id,"a",policy);
});

test("the selector applies the request policy over its default and reports it",()=>{
 const selector=build(fleet(),{defaultPolicy:"COST_FIRST"});
 const cheap=selector({demand});selector.release?.(cheap);
 const quality=selector({demand,policy:"QUALITY_FIRST"});
 assert.equal(cheap.profile.id,"subscription");assert.equal(quality.profile.id,"premium");assert.equal(quality.policy,"QUALITY_FIRST");
});

test("quality floor: the best qualifying tier is used, and a missing tier degrades to the best available with a shortfall flag",()=>{
 const selector=build(fleet(),{defaultPolicy:"BALANCED"});
 const ok=selector({demand:{...demand,minQualityTier:4},policy:"BALANCED"});
 assert.ok(["premium","subscription"].includes(ok.profile.id!));assert.equal(ok.qualityShortfall,undefined);
 const weak=build([p("only",{qualityTier:2})]);
 const sel=weak({demand:{...demand,minQualityTier:4}});
 assert.equal(sel.profile.id,"only");assert.equal(sel.qualityShortfall,true);
});

test("provider health scoring: failures lower a profile's score and routing follows it; recovery restores it",()=>{
 let clock=0;
 const selector=build([p("a",{qualityTier:3,inputCostPerMillion:1,outputCostPerMillion:1}),p("b",{qualityTier:3,inputCostPerMillion:1,outputCostPerMillion:1})],{defaultPolicy:"BALANCED",now:()=>clock,cooldownMs:1,unavailableCooldownMs:1});
 assert.equal(selector({demand}).profile.id,"a");
 for(let i=0;i<4;i++){const s=selector({demand,preferredModel:"m-a"});selector.reportFailure?.(s,new Error("503 unavailable"));clock+=10_000;}
 const health=selector.health?.()??{};
 assert.ok(health.a.failureRate===1&&health.a.score<0.25,JSON.stringify(health.a));
 const next=selector({demand});assert.equal(next.profile.id,"b","the unhealthy twin is avoided once it is available again");selector.release?.(next);
 for(let i=0;i<20;i++){const s=selector({demand,preferredModel:"m-a"});selector.reportSuccess?.(s,{inputTokens:1,outputTokens:1,latencyMs:50});}
 assert.ok((selector.health?.().a.score??0)>0.85);assert.equal(selector.health?.().a.samples,20,"the window is bounded");
 assert.equal(selector({demand}).profile.id,"a");
});

test("observed latency refines the estimate once enough samples exist",()=>{
 const selector=build([p("claimed-fast",{estimatedTokensPerSecond:500}),p("claimed-slow",{estimatedTokensPerSecond:20})],{defaultPolicy:"BALANCED"});
 for(let i=0;i<5;i++){const s=selector({demand,preferredModel:"m-claimed-fast"});selector.reportSuccess?.(s,{inputTokens:1,outputTokens:1,latencyMs:90_000});}
 for(let i=0;i<5;i++){const s=selector({demand,preferredModel:"m-claimed-slow"});selector.reportSuccess?.(s,{inputTokens:1,outputTokens:1,latencyMs:1_000});}
 assert.equal(selector({demand}).profile.id,"claimed-slow");
});

test("runtime config carries routing policy, quality tier and locality",async()=>{
 const file=join(await tmpDir(),"p.json");
 await writeFile(file,JSON.stringify({routing:{policy:"LOCAL_FIRST",healthWindow:10},providers:[
  {id:"cc",provider:"claude-code",model:"sonnet",capabilities:["reasoning"],contextWindow:200000,maxConcurrency:1,qualityTier:4},
  {id:"lan",provider:"openai-compatible",model:"m",baseUrl:"http://127.0.0.1:8080/v1",credentialEnv:"X_KEY",capabilities:["reasoning"],contextWindow:8000},
  {id:"cloud",provider:"openrouter",model:"m",capabilities:["reasoning"],contextWindow:8000,qualityTier:5}
 ]}));
 const {profiles,routing}=await readRuntimeFile(file);
 assert.deepEqual(routing,{policy:"LOCAL_FIRST",healthWindow:10});
 const caps=profiles.map(toCapacityProfile);
 assert.deepEqual(caps.map(c=>[c.id,c.locality,c.billing,c.qualityTier]),[["cc","local","subscription",4],["lan","local","metered",undefined],["cloud","remote","metered",5]]);
 await writeFile(file,JSON.stringify({providers:[{id:"a",provider:"claude-code",model:"sonnet",capabilities:["reasoning"],contextWindow:1}]}));
 assert.equal((await readRuntimeFile(file)).routing.policy,"BALANCED");
});

test("a brand-new provider kind plugs in through the registry with no orchestrator change",async()=>{
 const registry=createProviderRegistry().register("my-llm",({model,apiKey})=>({name:"my-llm",model,async generate(){return {text:compliant("from "+(apiKey?"keyed":"anon")),inputTokens:3,outputTokens:3,model:"my-llm-actual"};}}));
 assert.ok(registry.ids().includes("my-llm")&&registry instanceof ProviderRegistry);
 const file=join(await tmpDir(),"p.json");process.env.MY_LLM_KEY="a-test-credential-value";
 try{
  await writeFile(file,JSON.stringify({providers:[{id:"mine",provider:"my-llm",model:"v1",credentialEnv:"MY_LLM_KEY",capabilities:["reasoning"],contextWindow:50000,inputCostPerMillion:1,outputCostPerMillion:1,maxConcurrency:3}]}));
  const runtime=await loadRuntime(file,{registry}),state=await tmpState();
  const summary=await new ProjectOrchestrator(runtime.selector,state).run(plan("plug",[task("a"),task("b",{dependencies:["a"]})]));
  assert.deepEqual(summary.completed.sort(),["a","b"]);
  const record=(await state.executions.list("plug")).find(r=>r.status==="SUCCEEDED")!;
  assert.equal(record.provider,"my-llm");assert.equal(record.model,"my-llm-actual");assert.equal(record.profileId,"mine");
 }finally{delete process.env.MY_LLM_KEY;}
});

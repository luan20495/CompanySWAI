import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {ProjectOrchestrator} from "../src/orchestrator.js";
import {FileExecutionStore} from "../src/execution-store.js";
import {FileCheckpointStore} from "../src/checkpoint-store.js";
import {createCapacitySelector} from "../src/provider-selector.js";

test("orchestrator fails over after a quota error",async()=>{
 const root=await mkdtemp(join(tmpdir(),"companyswai-failover-"));
 let primaryCalls=0,backupCalls=0;
 const selector=createCapacitySelector([
  {provider:"primary",model:"m1",state:"AVAILABLE",capabilities:["coding"],contextWindow:10000,inputCostPerMillion:1,outputCostPerMillion:1,maxConcurrency:1},
  {provider:"backup",model:"m2",state:"AVAILABLE",capabilities:["coding"],contextWindow:10000,inputCostPerMillion:2,outputCostPerMillion:2,maxConcurrency:1}
 ],(provider,model)=>({
  name:provider,model,
  async generate(){
   if(provider==="primary"){primaryCalls++;throw new Error("429 quota exceeded");}
   backupCalls++;return {text:"done",inputTokens:10,outputTokens:5};
  }
 }));
 const orchestrator=new ProjectOrchestrator(selector,new FileExecutionStore(join(root,"executions")),new FileCheckpointStore(join(root,"checkpoints")));
 const summary=await orchestrator.run({projectId:"p",budget:{maxProjectCost:1},tasks:[{id:"code",agentRole:"dev",dependencies:[],system:"code",prompt:"build",inputRefs:[],maxTokens:100,capabilities:["coding"],estimatedInputTokens:100,estimatedOutputTokens:100}]});
 assert.equal(primaryCalls,1);
 assert.equal(backupCalls,1);
 assert.equal(summary.completed[0],"code");
 assert.equal(summary.failovers,1);
});

test("orchestrator pauses and checkpoints when all providers are exhausted",async()=>{
 const root=await mkdtemp(join(tmpdir(),"companyswai-pause-"));
 const selector=createCapacitySelector([
  {provider:"dead",model:"m",state:"OUT_OF_CREDIT",capabilities:["coding"],contextWindow:10000,maxConcurrency:1}
 ],()=>({name:"dead",model:"m",async generate(){throw new Error("should not run");}}));
 const executions=new FileExecutionStore(join(root,"executions"));
 const orchestrator=new ProjectOrchestrator(selector,executions,new FileCheckpointStore(join(root,"checkpoints")));
 const summary=await orchestrator.run({projectId:"p",budget:{},tasks:[{id:"code",agentRole:"dev",dependencies:[],system:"code",prompt:"build",inputRefs:[],maxTokens:100,capabilities:["coding"],estimatedInputTokens:100,estimatedOutputTokens:100}]});
 assert.deepEqual(summary.paused,["code"]);
 const records=await executions.list("p");
 assert.equal(records.at(-1)?.status,"PAUSED_CAPACITY");
});

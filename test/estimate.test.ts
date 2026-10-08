import assert from "node:assert/strict";
import test from "node:test";
import {estimateProject} from "../src/estimate.js";

test("project estimate reports cost, critical path, model mix and blocked capacity",()=>{
 const plan:any={projectId:"p",budget:{},tasks:[
  {id:"a",agentRole:"dev",dependencies:[],system:"s",prompt:"p",inputRefs:[],maxTokens:10,capabilities:["coding"],estimatedInputTokens:100,estimatedOutputTokens:100},
  {id:"b",agentRole:"qa",dependencies:["a"],system:"s",prompt:"p",inputRefs:[],maxTokens:10,capabilities:["testing"],estimatedInputTokens:100,estimatedOutputTokens:100}
 ]};
 const profiles:any[]=[
  {id:"code",provider:"x",model:"m1",state:"AVAILABLE",capabilities:["coding"],contextWindow:1000,inputCostPerMillion:1,outputCostPerMillion:1,maxConcurrency:1,estimatedTokensPerSecond:100},
  {id:"qa",provider:"x",model:"m2",state:"AVAILABLE",capabilities:["testing"],contextWindow:1000,inputCostPerMillion:2,outputCostPerMillion:2,maxConcurrency:1,estimatedTokensPerSecond:100}
 ];
 const out=estimateProject(plan,profiles);assert.equal(out.confidence,"HIGH");assert.equal(out.criticalPathSeconds,4);assert.equal(out.modelMix.length,2);assert.equal(out.blockedTasks.length,0);assert.ok(out.totalKnownCost>0);
});
test("project estimate explains missing capability",()=>{
 const plan:any={projectId:"p",budget:{},tasks:[{id:"a",agentRole:"dev",dependencies:[],system:"s",prompt:"p",inputRefs:[],maxTokens:10,capabilities:["gpu"],estimatedInputTokens:1,estimatedOutputTokens:1}]};
 const out=estimateProject(plan,[{provider:"x",model:"m",state:"AVAILABLE",capabilities:["coding"],contextWindow:100,maxConcurrency:1}]);assert.equal(out.blockedTasks.length,1);assert.match(out.blockedTasks[0].issues.join(" "),/required capabilities/);
});

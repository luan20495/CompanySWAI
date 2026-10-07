import assert from "node:assert/strict";
import test from "node:test";
import {compileBriefToProjectPlan} from "../src/plan-compiler.js";
import {buildRetrospective} from "../src/retrospective.js";

test("brief compiler produces executable reviewed project plan",()=>{
 const plan=compileBriefToProjectPlan({projectId:"secure-shop",objective:"Build a secure production commerce application",capabilities:["backend","web-ui","security-critical"],complexity:4});
 assert.ok(plan.tasks.length>5);assert.ok(plan.tasks.every(t=>t.system&&t.prompt));
 assert.ok(plan.tasks.some(t=>t.review));assert.ok(plan.tasks.some(t=>t.capabilities.includes("critical-review")));
});
test("retrospective detects capacity and cost estimation lessons",()=>{
 const base={projectId:"p",agentRole:"dev",provider:"x",model:"m",startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),inputRefs:[],output:"",artifactRefs:[],decisionRefs:[],reviewRefs:[],inputTokens:100,outputTokens:100};
 const records:any[]=[{...base,id:"1",taskId:"a",status:"SUCCEEDED",estimatedCost:1,actualCost:2},{...base,id:"2",taskId:"b",status:"PAUSED_CAPACITY",error:"quota"}];
 const retro=buildRetrospective("p",records);assert.equal(retro.paused,1);assert.ok(retro.lessons.some(x=>x.includes("Capacity")));assert.ok(retro.lessons.some(x=>x.includes("25%")));
});

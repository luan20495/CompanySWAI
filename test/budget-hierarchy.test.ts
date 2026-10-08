import assert from "node:assert/strict";
import test from "node:test";
import {ExecutionRecord} from "../src/execution-record.js";
import {ApprovalRequiredError,assertBudget,budgetReport} from "../src/budget.js";

const row=(taskId:string,department:string,agentRole:string,cost:number)=>ExecutionRecord.parse({id:taskId,projectId:"p",taskId,agentRole,department,provider:"x",model:"m",status:"SUCCEEDED",startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),inputRefs:[],output:"",artifactRefs:[],decisionRefs:[],reviewRefs:[],blockerRefs:[],inputTokens:0,outputTokens:0,actualCost:cost});
test("budget hierarchy enforces project, team, task and agent limits",()=>{
 const records=[row("a","engineering","backend-engineer",2),row("b","engineering","frontend-engineer",1)];
 assert.throws(()=>assertBudget({maxProjectCost:3.5},records,{taskId:"c",department:"quality",agentRole:"qa"},1),/Project budget/);
 assert.throws(()=>assertBudget({maxTeamCost:{engineering:3.5}},records,{taskId:"c",department:"engineering",agentRole:"backend-engineer"},1),/Team budget/);
 assert.throws(()=>assertBudget({maxAgentCost:{"backend-engineer":2.5}},records,{taskId:"c",department:"engineering",agentRole:"backend-engineer"},1),/Agent budget/);
 assert.throws(()=>assertBudget({maxTaskCost:2.5},[row("a","engineering","backend-engineer",2)],{taskId:"a",department:"engineering",agentRole:"backend-engineer"},1),/Task budget/);
});

const ctx={taskId:"c",department:"engineering",agentRole:"backend-engineer"};
test("in-flight reservations count against every budget level",()=>{
 const inFlight=[{taskId:"x",department:"engineering",agentRole:"backend-engineer",estimatedCost:2}];
 assert.throws(()=>assertBudget({maxProjectCost:2.5},[],ctx,1,false,inFlight),/Project budget/);
 assert.throws(()=>assertBudget({maxTeamCost:{engineering:2.5}},[],ctx,1,false,inFlight),/Team budget/);
 assert.throws(()=>assertBudget({maxAgentCost:{"backend-engineer":2.5}},[],ctx,1,false,inFlight),/Agent budget/);
 assert.doesNotThrow(()=>assertBudget({maxProjectCost:3.5},[],ctx,1,false,inFlight));
});
test("unknown cost fails closed only when limits are configured",()=>{
 assert.doesNotThrow(()=>assertBudget({},[],ctx,undefined));
 assert.throws(()=>assertBudget({maxProjectCost:10},[],ctx,undefined),/unknown/);
 assert.throws(()=>assertBudget({approvalThreshold:1},[],ctx,undefined),/unknown/);
});
test("review spend is attributed to the reviewed task and checkpointed spend counts until finalized",()=>{
 const review={...row("a--review-1","quality","reviewer",1.5)};
 assert.throws(()=>assertBudget({maxTaskCost:3},[row("a","engineering","backend-engineer",2),review],{taskId:"a",department:"engineering",agentRole:"backend-engineer"},1),/Task budget/);
 const checkpointed={...row("k","engineering","backend-engineer",4),status:"CHECKPOINTED" as const};
 assert.throws(()=>assertBudget({maxProjectCost:4.5},[checkpointed],ctx,1),/Project budget/);
 assert.doesNotThrow(()=>assertBudget({maxProjectCost:4.5},[checkpointed,{...checkpointed,status:"FAILED" as const,actualCost:undefined}],ctx,1));
});
test("approval threshold requires persisted approval and approved estimates pass",()=>{
 assert.throws(()=>assertBudget({approvalThreshold:1},[],ctx,2),ApprovalRequiredError);
 assert.doesNotThrow(()=>assertBudget({approvalThreshold:1},[],ctx,2,true));
});
test("budget report compares estimate and actual per project, department, task and agent",()=>{
 const withEstimate=(r:ReturnType<typeof row>,estimatedCost:number)=>({...r,estimatedCost});
 const report=budgetReport({maxProjectCost:10,maxTeamCost:{engineering:4}},[withEstimate(row("a","engineering","backend-engineer",2),1),withEstimate(row("a--review-1","quality","reviewer",1),1),withEstimate(row("b","engineering","frontend-engineer",1),2)]);
 assert.equal(report.project.actual,4);assert.equal(report.project.estimated,4);assert.equal(report.project.utilization,0.4);
 assert.equal(report.departments.engineering.actual,3);assert.equal(report.departments.engineering.utilization,0.75);
 assert.equal(report.tasks.a.actual,3);assert.equal(report.agents.reviewer.actual,1);
});

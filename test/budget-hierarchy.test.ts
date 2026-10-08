import assert from "node:assert/strict";
import test from "node:test";
import {assertBudget} from "../src/budget.js";

const row=(taskId:string,department:string,agentRole:string,cost:number)=>({id:taskId,projectId:"p",taskId,agentRole,department,provider:"x",model:"m",status:"SUCCEEDED" as const,startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),inputRefs:[],output:"",artifactRefs:[],decisionRefs:[],reviewRefs:[],blockerRefs:[],inputTokens:0,outputTokens:0,actualCost:cost});
test("budget hierarchy enforces project, team, task and agent limits",()=>{
 const records=[row("a","engineering","backend-engineer",2),row("b","engineering","frontend-engineer",1)];
 assert.throws(()=>assertBudget({maxProjectCost:3.5},records,{taskId:"c",department:"quality",agentRole:"qa"},1),/Project budget/);
 assert.throws(()=>assertBudget({maxTeamCost:{engineering:3.5}},records,{taskId:"c",department:"engineering",agentRole:"backend-engineer"},1),/Team budget/);
 assert.throws(()=>assertBudget({maxAgentCost:{"backend-engineer":2.5}},records,{taskId:"c",department:"engineering",agentRole:"backend-engineer"},1),/Agent budget/);
 assert.throws(()=>assertBudget({maxTaskCost:2.5},[row("a","engineering","backend-engineer",2)],{taskId:"a",department:"engineering",agentRole:"backend-engineer"},1),/Task budget/);
});

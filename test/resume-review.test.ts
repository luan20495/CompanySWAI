import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import type {ModelProvider} from "../src/provider.js";
import type {ProviderSelector} from "../src/provider-selector.js";
import {ProjectOrchestrator} from "../src/orchestrator.js";
import {FileExecutionStore} from "../src/execution-store.js";
import {FileCheckpointStore} from "../src/checkpoint-store.js";
import {FileApprovalStore} from "../src/approval-store.js";
import {ProjectMemoryStore} from "../src/project-memory.js";

test("resume continues from CHANGES_REQUIRED without rerunning the accepted maker draft",async()=>{
 const root=await mkdtemp(join(tmpdir(),"companyswai-resume-review-")),executions=new FileExecutionStore(join(root,"executions"));
 let makerCalls=0,reviewCalls=0;
 const selector:ProviderSelector=request=>{const provider:ModelProvider={name:"fake",model:"m",generate:async req=>{if(/reviewer/i.test(req.system)){reviewCalls++;return {text:reviewCalls===1?"CHANGES_REQUIRED\nfix it":"PASS\nok",inputTokens:1,outputTokens:1};}makerCalls++;return {text:"draft-"+makerCalls,inputTokens:1,outputTokens:1};}};return {provider,profile:{provider:"fake",model:"m",state:"AVAILABLE",capabilities:request.demand.capabilities,contextWindow:10000,maxConcurrency:1},estimatedCost:0};};
 const plan:any={projectId:"p",budget:{},tasks:[{id:"a",agentRole:"dev",dependencies:[],system:"maker",prompt:"work",inputRefs:[],maxTokens:20,capabilities:[],estimatedInputTokens:1,estimatedOutputTokens:1,review:{role:"reviewer",system:"reviewer",capabilities:[],estimatedInputTokens:1,estimatedOutputTokens:1,maxTokens:20,maxRounds:2}}]};
 const checkpoints=new FileCheckpointStore(join(root,"checkpoints")),approvals=new FileApprovalStore(join(root,"approvals")),memory=new ProjectMemoryStore(join(root,"projects"));
 const firstSelector:ProviderSelector=request=>{const selected=selector(request),original=selected.provider.generate.bind(selected.provider);selected.provider.generate=async req=>{const result=await original(req);if(/Revise the work/.test(req.prompt))throw new Error("forced interruption");return result;};return selected;};
 await assert.rejects(()=>new ProjectOrchestrator(firstSelector,executions,checkpoints,approvals,memory).run(plan));
 assert.equal(makerCalls,2);
 const second=await new ProjectOrchestrator(selector,executions,checkpoints,approvals,memory).run(plan);
 assert.ok(second.completed.includes("a"));assert.equal(reviewCalls,2);assert.equal(makerCalls,3);
});

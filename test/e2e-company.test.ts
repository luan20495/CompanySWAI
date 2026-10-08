import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {compileBriefToProjectPlan} from "../src/plan-compiler.js";
import {ProjectOrchestrator} from "../src/orchestrator.js";
import {DryRunProvider} from "../src/providers/dry-run.js";
import {FileExecutionStore} from "../src/execution-store.js";
import {FileCheckpointStore} from "../src/checkpoint-store.js";
import {FileApprovalStore} from "../src/approval-store.js";
import {ProjectMemoryStore} from "../src/project-memory.js";
import type {ProviderSelector} from "../src/provider-selector.js";

test("full MD company dry-run completes and second run resumes without rerunning makers",async()=>{
 const root=await mkdtemp(join(tmpdir(),"companyswai-e2e-"));
 const plan=await compileBriefToProjectPlan({projectId:"e2e",objective:"Build a secure backend service ready for deployment",capabilities:["backend","deployment","security-critical"],complexity:4});
 const selector:ProviderSelector=request=>{const provider=new DryRunProvider();return {provider,profile:{provider:provider.name,model:provider.model,state:"AVAILABLE",capabilities:request.demand.capabilities,contextWindow:100000,maxConcurrency:4},estimatedCost:0};};
 const executions=new FileExecutionStore(join(root,"executions")),checkpoints=new FileCheckpointStore(join(root,"checkpoints")),approvals=new FileApprovalStore(join(root,"approvals")),memory=new ProjectMemoryStore(join(root,"projects"));
 const orchestrator=new ProjectOrchestrator(selector,executions,checkpoints,approvals,memory),first=await orchestrator.run(plan);
 assert.equal(first.paused.length,0);assert.equal(first.approvalRequired.length,0);assert.equal(first.completed.length,plan.tasks.length);
 const before=(await executions.list("e2e")).filter(r=>r.status==="STARTED").length,second=await orchestrator.run(plan),after=(await executions.list("e2e")).filter(r=>r.status==="STARTED").length;
 assert.equal(second.skipped.length,plan.tasks.length);assert.equal(after,before);
});

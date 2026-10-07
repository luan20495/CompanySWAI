import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {FileExecutionStore} from "../src/execution-store.js";
import {FileCheckpointStore} from "../src/checkpoint-store.js";
import {TaskRunner} from "../src/runner.js";
import type {ModelProvider} from "../src/provider.js";

test("runner persists output and checkpoint",async()=>{
 const root=await mkdtemp(join(tmpdir(),"companyswai-"));
 const executions=new FileExecutionStore(join(root,"executions"));
 const checkpoints=new FileCheckpointStore(join(root,"checkpoints"));
 const provider:ModelProvider={name:"fake",model:"test",async generate(){return {text:"artifact ready",inputTokens:10,outputTokens:4};}};
 const runner=new TaskRunner(executions,checkpoints);
 const result=await runner.run({projectId:"p1",taskId:"t1",agentRole:"backend-dev",inputRefs:["spec.md"],system:"work",prompt:"implement",maxTokens:100},provider);
 assert.equal(result.status,"SUCCEEDED");
 assert.equal((await executions.list("p1")).length,2);
 const checkpoint=await checkpoints.load("p1","t1");
 assert.equal(checkpoint?.status,"REVIEW");
 assert.match(await readFile(join(root,"executions","p1","records.jsonl"),"utf8"),/artifact ready/);
});

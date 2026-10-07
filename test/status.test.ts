import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {FileExecutionStore} from "../src/execution-store.js";
import {buildTaskSnapshots} from "../src/status.js";
import {createStatusServer} from "../src/status-server.js";

test("status snapshots aggregate attempts and terminal token usage",()=>{
 const records:any[]=[
  {id:"r1",projectId:"p1",taskId:"t1",agentRole:"dev",provider:"fake",model:"m",status:"STARTED",startedAt:"2026-01-01T00:00:00Z",inputRefs:[],output:"",artifactRefs:[],decisionRefs:[],reviewRefs:[],inputTokens:0,outputTokens:0},
  {id:"r1",projectId:"p1",taskId:"t1",agentRole:"dev",provider:"fake",model:"m",status:"SUCCEEDED",startedAt:"2026-01-01T00:00:00Z",finishedAt:"2026-01-01T00:00:01Z",inputRefs:[],output:"done",artifactRefs:[],decisionRefs:[],reviewRefs:[],inputTokens:10,outputTokens:5}
 ];
 const [snapshot]=buildTaskSnapshots(records);
 assert.equal(snapshot.attempts,1);
 assert.equal(snapshot.status,"SUCCEEDED");
 assert.equal(snapshot.inputTokens,10);
 assert.equal(snapshot.latestOutput,"done");
});

test("status server exposes persisted executions on loopback",async()=>{
 const root=await mkdtemp(join(tmpdir(),"companyswai-status-"));
 const store=new FileExecutionStore(root);
 await store.append({id:"r1",projectId:"p1",taskId:"t1",agentRole:"dev",provider:"fake",model:"m",status:"SUCCEEDED",startedAt:"2026-01-01T00:00:00Z",finishedAt:"2026-01-01T00:00:01Z",inputRefs:[],output:"done",inputTokens:2,outputTokens:3});
 const server=createStatusServer(root);
 await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
 try{
  const address=server.address();
  if(!address||typeof address==="string")throw new Error("No TCP address");
  const response=await fetch("http://127.0.0.1:"+address.port+"/api/projects/p1/tasks");
  assert.equal(response.status,200);
  const body=await response.json() as {tasks:Array<{taskId:string;latestOutput:string}>};
  assert.equal(body.tasks[0].taskId,"t1");
  assert.equal(body.tasks[0].latestOutput,"done");
 }finally{
  await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
 }
});

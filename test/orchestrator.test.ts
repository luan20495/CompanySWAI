import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import type {ModelProvider} from "../src/provider.js";
import {ProjectOrchestrator} from "../src/orchestrator.js";
import {FileExecutionStore} from "../src/execution-store.js";
import {FileCheckpointStore} from "../src/checkpoint-store.js";

test("orchestrator runs dependency waves and passes upstream output",async()=>{
 const root=await mkdtemp(join(tmpdir(),"companyswai-orchestrator-"));
 const executions=new FileExecutionStore(join(root,"executions"));
 const checkpoints=new FileCheckpointStore(join(root,"checkpoints"));
 const prompts:string[]=[];

 const resolver=(_provider:string,model:string):ModelProvider=>({
  name:"fake",
  model,
  async generate(request){
   prompts.push(request.prompt);
   return {text:"output:"+request.prompt.slice(0,20),inputTokens:5,outputTokens:7};
  }
 });

 const orchestrator=new ProjectOrchestrator(resolver,executions,checkpoints);
 const summary=await orchestrator.run({
  projectId:"p1",
  tasks:[
   {id:"product",agentRole:"product-lead",dependencies:[],system:"discover",prompt:"define product",inputRefs:[],maxTokens:100,provider:"fake",model:"m1"},
   {id:"critic",agentRole:"product-critic",dependencies:["product"],system:"review",prompt:"critique brief",inputRefs:["execution:product"],maxTokens:100,provider:"fake",model:"m1"},
   {id:"architecture",agentRole:"tech-lead",dependencies:["critic"],system:"design",prompt:"design system",inputRefs:["execution:critic"],maxTokens:100,provider:"fake",model:"m1"}
  ]
 });

 assert.equal(summary.waves,3);
 assert.deepEqual(summary.completed,["product","critic","architecture"]);
 assert.match(prompts[1],/UPSTREAM product/);
 assert.match(prompts[2],/UPSTREAM critic/);
 const records=await executions.list("p1");
 assert.equal(records.filter(record=>record.status==="SUCCEEDED").length,3);
});

test("orchestrator rejects missing dependency",async()=>{
 const root=await mkdtemp(join(tmpdir(),"companyswai-invalid-"));
 const orchestrator=new ProjectOrchestrator(
  ()=>({name:"fake",model:"m",async generate(){return {text:"ok",inputTokens:1,outputTokens:1};}}),
  new FileExecutionStore(join(root,"executions")),
  new FileCheckpointStore(join(root,"checkpoints"))
 );
 await assert.rejects(
  orchestrator.run({
   projectId:"p2",
   tasks:[{id:"a",agentRole:"backend-dev",dependencies:["missing"],system:"work",prompt:"build feature",inputRefs:[],maxTokens:20,provider:"fake",model:"m"}]
  }),
  /Missing dependency/
 );
});

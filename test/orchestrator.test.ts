import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import type {ModelProvider} from "../src/provider.js";
import {ProjectOrchestrator} from "../src/orchestrator.js";
import {FileExecutionStore} from "../src/execution-store.js";
import {FileCheckpointStore} from "../src/checkpoint-store.js";
import {ProjectPlan} from "../src/project.js";

test("orchestrator runs dependency waves and passes upstream output",async()=>{
 const root=await mkdtemp(join(tmpdir(),"companyswai-orchestrator-"));
 const executions=new FileExecutionStore(join(root,"executions"));
 const checkpoints=new FileCheckpointStore(join(root,"checkpoints"));
 const prompts:string[]=[];
 const selector=({preferredModel}:{preferredModel?:string}):ModelProvider=>({
  name:"fake",model:preferredModel??"auto",
  async generate(request){prompts.push(request.prompt);return {text:"output:"+request.prompt.slice(0,20),inputTokens:5,outputTokens:7};}
 });
 const orchestrator=new ProjectOrchestrator(selector,executions,checkpoints);
 const summary=await orchestrator.run({
  projectId:"p1",
  tasks:[
   {id:"product",agentRole:"product-lead",dependencies:[],system:"discover",prompt:"define product",inputRefs:[],maxTokens:100,provider:"fake",model:"m1",capabilities:[],estimatedInputTokens:20,estimatedOutputTokens:20},
   {id:"critic",agentRole:"product-critic",dependencies:["product"],system:"review",prompt:"critique brief",inputRefs:["execution:product"],maxTokens:100,provider:"fake",model:"m1",capabilities:[],estimatedInputTokens:20,estimatedOutputTokens:20},
   {id:"architecture",agentRole:"tech-lead",dependencies:["critic"],system:"design",prompt:"design system",inputRefs:["execution:critic"],maxTokens:100,provider:"fake",model:"m1",capabilities:[],estimatedInputTokens:20,estimatedOutputTokens:20}
  ]
 });
 assert.equal(summary.waves,3);
 assert.match(prompts[1],/UPSTREAM product/);
 assert.match(prompts[2],/UPSTREAM critic/);
 assert.equal((await executions.list("p1")).filter(record=>record.status==="SUCCEEDED").length,3);
});

test("review gate revises maker output until reviewer passes",async()=>{
 const root=await mkdtemp(join(tmpdir(),"companyswai-review-"));
 const executions=new FileExecutionStore(join(root,"executions"));
 let makerCalls=0;
 let reviewerCalls=0;
 const selector=():ModelProvider=>({
  name:"fake",model:"m",
  async generate(request){
   if(request.system==="reviewer"){
    reviewerCalls++;
    return {text:reviewerCalls===1?"CHANGES_REQUIRED\nAdd acceptance criteria.":"PASS\nAll criteria are testable.",inputTokens:5,outputTokens:5};
   }
   makerCalls++;
   return {text:makerCalls===1?"draft":"revised with acceptance criteria",inputTokens:5,outputTokens:5};
  }
 });
 const orchestrator=new ProjectOrchestrator(selector,executions,new FileCheckpointStore(join(root,"checkpoints")));
 const summary=await orchestrator.run({
  projectId:"review-project",
  tasks:[{
   id:"brief",agentRole:"product-lead",dependencies:[],system:"maker",prompt:"write brief",inputRefs:[],
   maxTokens:100,capabilities:["reasoning"],estimatedInputTokens:20,estimatedOutputTokens:20,
   review:{role:"product-critic",system:"reviewer",capabilities:["review"],estimatedInputTokens:20,estimatedOutputTokens:20,maxTokens:80,maxRounds:2}
  }]
 });
 assert.equal(summary.reviewRuns,2);
 assert.equal(summary.revisions,1);
 assert.equal(makerCalls,2);
 assert.equal(reviewerCalls,2);
});

test("project IDs reject traversal characters",()=>{
 assert.throws(()=>ProjectPlan.parse({
  projectId:"../escape",
  tasks:[{id:"a",agentRole:"dev",dependencies:[],system:"work",prompt:"build it",inputRefs:[],maxTokens:10,capabilities:[],estimatedInputTokens:1,estimatedOutputTokens:1}]
 }));
});

import {randomUUID} from "node:crypto";
import type {ModelProvider,ModelRequest} from "./provider.js";
import {FileExecutionStore} from "./execution-store.js";import {FileCheckpointStore} from "./checkpoint-store.js";
import {FileArtifactStore,FileDecisionStore,FileHandoffStore} from "./artifact-store.js";import {ProjectMemoryStore} from "./project-memory.js";import {parseAgentOutput} from "./output-parser.js";
import {LocalRepoWorkspace,parseFilePatches} from "./repo-workspace.js";

export type RunTask={projectId:string;taskId:string;agentRole:string;inputRefs:string[];system:string;prompt:string;maxTokens:number;estimatedCost?:number;inputCostPerMillion?:number;outputCostPerMillion?:number;workspace?:{path:string;checks:Array<{cmd:string;args:string[]}>;autoCommit:boolean};handoffTo?:Array<{taskId:string;role:string}>;};
export class TaskRunner{
 constructor(private executions=new FileExecutionStore(),private checkpoints=new FileCheckpointStore(),private memory=new ProjectMemoryStore(),private artifacts=new FileArtifactStore(),private decisions=new FileDecisionStore(),private handoffs=new FileHandoffStore()){}
 async run(task:RunTask,provider:ModelProvider){
  const id=randomUUID(),startedAt=new Date().toISOString();await this.memory.recordStatus(task.projectId,task.taskId,"STARTED",provider.name+"/"+provider.model);await this.executions.append({id,projectId:task.projectId,taskId:task.taskId,agentRole:task.agentRole,provider:provider.name,model:provider.model,status:"STARTED",startedAt,inputRefs:task.inputRefs,estimatedCost:task.estimatedCost});
  try{
   const response=await provider.generate({system:task.system,prompt:task.prompt,maxTokens:task.maxTokens}),finishedAt=new Date().toISOString(),actualCost=task.inputCostPerMillion!=null&&task.outputCostPerMillion!=null?response.inputTokens/1e6*task.inputCostPerMillion+response.outputTokens/1e6*task.outputCostPerMillion:undefined;
   const patches=parseFilePatches(response.text),written:string[]=[];let commitSha:string|undefined;
   if(patches.length){if(!task.workspace)throw new Error("Agent produced file patches but project has no workspace configured");const workspace=new LocalRepoWorkspace(task.workspace.path);written.push(...await workspace.apply(patches));if(task.workspace.checks.length)await workspace.check(task.workspace.checks);if(task.workspace.autoCommit)commitSha=await workspace.commit("CompanySWAI: "+task.taskId);}
   const artifactId=(task.taskId+"-"+id.slice(0,8)).slice(0,128);await this.artifacts.save(task.projectId,artifactId,{id:artifactId,projectId:task.projectId,taskId:task.taskId,kind:patches.length?"code":"document",title:task.agentRole+" output",content:response.text,createdAt:finishedAt});
   const parsed=parseAgentOutput(response.text),decisionRefs:string[]=[];if(parsed.decision){const decisionId=(task.taskId+"-decision-"+id.slice(0,8)).slice(0,128);await this.decisions.save(task.projectId,decisionId,{id:decisionId,projectId:task.projectId,taskId:task.taskId,title:task.agentRole+" decisions",decision:parsed.decision,rationale:"Captured from structured agent output.",createdAt:finishedAt});decisionRefs.push(decisionId);await this.memory.recordDecision(task.projectId,task.taskId,parsed.decision);}
   const handoffRefs:string[]=[];
   if(task.handoffTo?.length){
    const summary=parsed.handoff??response.text.slice(0,1200);
    for(const target of task.handoffTo){const handoffId=(task.taskId+"-to-"+target.taskId+"-"+id.slice(0,6)).slice(0,128);await this.handoffs.save(task.projectId,handoffId,{id:handoffId,projectId:task.projectId,taskId:task.taskId,fromRole:task.agentRole,toRole:target.role,summary,refs:[artifactId],createdAt:finishedAt});handoffRefs.push("handoff:"+handoffId);}
   }
   const refs=[artifactId,...written.map(x=>"file:"+x),...(commitSha?["commit:"+commitSha]:[]),...handoffRefs];
   const record=await this.executions.append({id,projectId:task.projectId,taskId:task.taskId,agentRole:task.agentRole,provider:provider.name,model:provider.model,status:"SUCCEEDED",startedAt,finishedAt,inputRefs:task.inputRefs,output:response.text,artifactRefs:refs,decisionRefs,inputTokens:response.inputTokens,outputTokens:response.outputTokens,estimatedCost:task.estimatedCost,actualCost});
   await this.memory.recordOutput(task.projectId,task.taskId,task.agentRole,response.text);await this.memory.recordStatus(task.projectId,task.taskId,"SUCCEEDED",commitSha?"commit "+commitSha:"");
   await this.checkpoints.save(task.projectId,{taskId:task.taskId,at:finishedAt,status:"REVIEW",completed:["model-execution",...(written.length?["workspace-patch","deterministic-checks"]:[])],remaining:["review"],artifactRefs:refs,decisionRefs,compactContext:response.text.slice(0,8000),provider:provider.name,model:provider.model,inputTokens:response.inputTokens,outputTokens:response.outputTokens});return record;
  }catch(error){const finishedAt=new Date().toISOString(),message=error instanceof Error?error.message:String(error);await this.memory.recordStatus(task.projectId,task.taskId,"FAILED",message);await this.executions.append({id,projectId:task.projectId,taskId:task.taskId,agentRole:task.agentRole,provider:provider.name,model:provider.model,status:"FAILED",startedAt,finishedAt,inputRefs:task.inputRefs,estimatedCost:task.estimatedCost,error:message});throw error;}
 }
 async pauseCapacity(task:RunTask,reason:string){const now=new Date().toISOString();await this.memory.recordStatus(task.projectId,task.taskId,"PAUSED_CAPACITY",reason);const record=await this.executions.append({id:randomUUID(),projectId:task.projectId,taskId:task.taskId,agentRole:task.agentRole,provider:"unassigned",model:"unassigned",status:"PAUSED_CAPACITY",startedAt:now,finishedAt:now,inputRefs:task.inputRefs,error:reason});await this.checkpoints.save(task.projectId,{taskId:task.taskId,at:now,status:"PAUSED_CAPACITY",completed:[],remaining:["model-execution"],artifactRefs:[],decisionRefs:[],compactContext:task.prompt.slice(0,8000),inputTokens:0,outputTokens:0});return record;}
}

import {randomUUID} from "node:crypto";
import type {ModelProvider,ModelRequest} from "./provider.js";
import {FileExecutionStore} from "./execution-store.js";
import {FileCheckpointStore} from "./checkpoint-store.js";
import {FileArtifactStore,FileDecisionStore} from "./artifact-store.js";
import {ProjectMemoryStore} from "./project-memory.js";
import {parseAgentOutput} from "./output-parser.js";

export type RunTask={projectId:string;taskId:string;agentRole:string;inputRefs:string[];system:string;prompt:string;maxTokens:number;estimatedCost?:number;inputCostPerMillion?:number;outputCostPerMillion?:number;};

export class TaskRunner{
 constructor(private executions=new FileExecutionStore(),private checkpoints=new FileCheckpointStore(),private memory=new ProjectMemoryStore(),private artifacts=new FileArtifactStore(),private decisions=new FileDecisionStore()){}
 async run(task:RunTask,provider:ModelProvider){
  const id=randomUUID(),startedAt=new Date().toISOString();await this.memory.recordStatus(task.projectId,task.taskId,"STARTED",provider.name+"/"+provider.model);
  await this.executions.append({id,projectId:task.projectId,taskId:task.taskId,agentRole:task.agentRole,provider:provider.name,model:provider.model,status:"STARTED",startedAt,inputRefs:task.inputRefs,estimatedCost:task.estimatedCost});
  try{
   const request:ModelRequest={system:task.system,prompt:task.prompt,maxTokens:task.maxTokens},response=await provider.generate(request),finishedAt=new Date().toISOString();
   const actualCost=task.inputCostPerMillion!=null&&task.outputCostPerMillion!=null?response.inputTokens/1e6*task.inputCostPerMillion+response.outputTokens/1e6*task.outputCostPerMillion:undefined;
   const artifactId=(task.taskId+"-"+id.slice(0,8)).slice(0,128);
   await this.artifacts.save(task.projectId,artifactId,{id:artifactId,projectId:task.projectId,taskId:task.taskId,kind:"document",title:task.agentRole+" output",content:response.text,createdAt:finishedAt});
   const parsed=parseAgentOutput(response.text),decisionRefs:string[]=[];
   if(parsed.decision){const decisionId=(task.taskId+"-decision-"+id.slice(0,8)).slice(0,128);await this.decisions.save(task.projectId,decisionId,{id:decisionId,projectId:task.projectId,taskId:task.taskId,title:task.agentRole+" decisions",decision:parsed.decision,rationale:"Captured from structured agent output.",createdAt:finishedAt});decisionRefs.push(decisionId);await this.memory.recordDecision(task.projectId,task.taskId,parsed.decision);}
   const record=await this.executions.append({id,projectId:task.projectId,taskId:task.taskId,agentRole:task.agentRole,provider:provider.name,model:provider.model,status:"SUCCEEDED",startedAt,finishedAt,inputRefs:task.inputRefs,output:response.text,artifactRefs:[artifactId],decisionRefs,inputTokens:response.inputTokens,outputTokens:response.outputTokens,estimatedCost:task.estimatedCost,actualCost});
   await this.memory.recordOutput(task.projectId,task.taskId,task.agentRole,response.text);await this.memory.recordStatus(task.projectId,task.taskId,"SUCCEEDED");
   await this.checkpoints.save(task.projectId,{taskId:task.taskId,at:finishedAt,status:"REVIEW",completed:["model-execution"],remaining:["review"],artifactRefs:[artifactId],decisionRefs,compactContext:response.text.slice(0,8000),provider:provider.name,model:provider.model,inputTokens:response.inputTokens,outputTokens:response.outputTokens});
   return record;
  }catch(error){
   const finishedAt=new Date().toISOString(),message=error instanceof Error?error.message:String(error);await this.memory.recordStatus(task.projectId,task.taskId,"FAILED",message);
   await this.executions.append({id,projectId:task.projectId,taskId:task.taskId,agentRole:task.agentRole,provider:provider.name,model:provider.model,status:"FAILED",startedAt,finishedAt,inputRefs:task.inputRefs,estimatedCost:task.estimatedCost,error:message});throw error;
  }
 }
 async pauseCapacity(task:RunTask,reason:string){
  const now=new Date().toISOString();await this.memory.recordStatus(task.projectId,task.taskId,"PAUSED_CAPACITY",reason);
  const record=await this.executions.append({id:randomUUID(),projectId:task.projectId,taskId:task.taskId,agentRole:task.agentRole,provider:"unassigned",model:"unassigned",status:"PAUSED_CAPACITY",startedAt:now,finishedAt:now,inputRefs:task.inputRefs,error:reason});
  await this.checkpoints.save(task.projectId,{taskId:task.taskId,at:now,status:"PAUSED_CAPACITY",completed:[],remaining:["model-execution"],artifactRefs:[],decisionRefs:[],compactContext:task.prompt.slice(0,8000),inputTokens:0,outputTokens:0});return record;
 }
}

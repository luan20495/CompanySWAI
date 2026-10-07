import {randomUUID} from "node:crypto";
import type {ModelProvider,ModelRequest} from "./provider.js";
import {FileExecutionStore} from "./execution-store.js";
import {FileCheckpointStore} from "./checkpoint-store.js";

export type RunTask={
 projectId:string;taskId:string;agentRole:string;inputRefs:string[];
 system:string;prompt:string;maxTokens:number;
 estimatedCost?:number;inputCostPerMillion?:number;outputCostPerMillion?:number;
};

export class TaskRunner{
 constructor(
  private executions=new FileExecutionStore(),
  private checkpoints=new FileCheckpointStore()
 ){}
 async run(task:RunTask,provider:ModelProvider){
  const id=randomUUID();
  const startedAt=new Date().toISOString();
  await this.executions.append({id,projectId:task.projectId,taskId:task.taskId,agentRole:task.agentRole,provider:provider.name,model:provider.model,status:"STARTED",startedAt,inputRefs:task.inputRefs,estimatedCost:task.estimatedCost});
  try{
   const request:ModelRequest={system:task.system,prompt:task.prompt,maxTokens:task.maxTokens};
   const response=await provider.generate(request);
   const finishedAt=new Date().toISOString();
   const actualCost=task.inputCostPerMillion!=null&&task.outputCostPerMillion!=null
    ? response.inputTokens/1e6*task.inputCostPerMillion+response.outputTokens/1e6*task.outputCostPerMillion
    : undefined;
   const record=await this.executions.append({id,projectId:task.projectId,taskId:task.taskId,agentRole:task.agentRole,provider:provider.name,model:provider.model,status:"SUCCEEDED",startedAt,finishedAt,inputRefs:task.inputRefs,output:response.text,inputTokens:response.inputTokens,outputTokens:response.outputTokens,estimatedCost:task.estimatedCost,actualCost});
   await this.checkpoints.save(task.projectId,{taskId:task.taskId,at:finishedAt,status:"REVIEW",completed:["model-execution"],remaining:["review"],artifactRefs:[],decisionRefs:[],compactContext:response.text.slice(0,8000),provider:provider.name,model:provider.model,inputTokens:response.inputTokens,outputTokens:response.outputTokens});
   return record;
  }catch(error){
   const finishedAt=new Date().toISOString();
   await this.executions.append({id,projectId:task.projectId,taskId:task.taskId,agentRole:task.agentRole,provider:provider.name,model:provider.model,status:"FAILED",startedAt,finishedAt,inputRefs:task.inputRefs,estimatedCost:task.estimatedCost,error:error instanceof Error?error.message:String(error)});
   throw error;
  }
 }
 async pauseCapacity(task:RunTask,reason:string){
  const now=new Date().toISOString();
  const record=await this.executions.append({id:randomUUID(),projectId:task.projectId,taskId:task.taskId,agentRole:task.agentRole,provider:"unassigned",model:"unassigned",status:"PAUSED_CAPACITY",startedAt:now,finishedAt:now,inputRefs:task.inputRefs,error:reason});
  await this.checkpoints.save(task.projectId,{taskId:task.taskId,at:now,status:"PAUSED_CAPACITY",completed:[],remaining:["model-execution"],artifactRefs:[],decisionRefs:[],compactContext:task.prompt.slice(0,8000),inputTokens:0,outputTokens:0});
  return record;
 }
}

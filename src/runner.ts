import {randomUUID} from "node:crypto";
import type {ModelProvider,ModelRequest} from "./provider.js";
import {FileExecutionStore} from "./execution-store.js";
import {FileCheckpointStore} from "./checkpoint-store.js";

export type RunTask={
 projectId:string;taskId:string;agentRole:string;inputRefs:string[];
 system:string;prompt:string;maxTokens:number;
};

export class TaskRunner{
 constructor(
  private executions=new FileExecutionStore(),
  private checkpoints=new FileCheckpointStore()
 ){}
 async run(task:RunTask,provider:ModelProvider){
  const id=randomUUID();
  const startedAt=new Date().toISOString();
  await this.executions.append({id,projectId:task.projectId,taskId:task.taskId,agentRole:task.agentRole,provider:provider.name,model:provider.model,status:"STARTED",startedAt,inputRefs:task.inputRefs});
  try{
   const request:ModelRequest={system:task.system,prompt:task.prompt,maxTokens:task.maxTokens};
   const response=await provider.generate(request);
   const finishedAt=new Date().toISOString();
   const record=await this.executions.append({id,projectId:task.projectId,taskId:task.taskId,agentRole:task.agentRole,provider:provider.name,model:provider.model,status:"SUCCEEDED",startedAt,finishedAt,inputRefs:task.inputRefs,output:response.text,inputTokens:response.inputTokens,outputTokens:response.outputTokens});
   await this.checkpoints.save(task.projectId,{taskId:task.taskId,at:finishedAt,status:"REVIEW",completed:["model-execution"],remaining:["review"],artifactRefs:[],decisionRefs:[],compactContext:response.text.slice(0,8000),provider:provider.name,model:provider.model,inputTokens:response.inputTokens,outputTokens:response.outputTokens});
   return record;
  }catch(error){
   const finishedAt=new Date().toISOString();
   await this.executions.append({id,projectId:task.projectId,taskId:task.taskId,agentRole:task.agentRole,provider:provider.name,model:provider.model,status:"FAILED",startedAt,finishedAt,inputRefs:task.inputRefs,error:error instanceof Error?error.message:String(error)});
   throw error;
  }
 }
}

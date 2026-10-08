import {ProjectPlan,type ProjectPlanValue} from "./project.js";
import type {ProviderSelector,ProviderSelection} from "./provider-selector.js";
import {CapacityUnavailableError} from "./errors.js";
import {assertBudget,ApprovalRequiredError} from "./budget.js";
import {FileApprovalStore} from "./approval-store.js";
import {KeyedSemaphore} from "./semaphore.js";
import {FileExecutionStore} from "./execution-store.js";
import {FileCheckpointStore} from "./checkpoint-store.js";
import {TaskRunner,type RunTask} from "./runner.js";
import {ProjectMemoryStore} from "./project-memory.js";

export type ProjectRunSummary={projectId:string;completed:string[];paused:string[];approvalRequired:string[];skipped:string[];waves:number;reviewRuns:number;revisions:number;failovers:number};
type SelectionFields={provider?:string;model?:string;capabilities:string[];estimatedInputTokens:number;estimatedOutputTokens:number;maxCost?:number;minContextWindow?:number;};

export class ProjectOrchestrator{
 private runner:TaskRunner;private capacity=new KeyedSemaphore();private memory:ProjectMemoryStore;
 constructor(private selectProvider:ProviderSelector,private executions=new FileExecutionStore(),checkpoints=new FileCheckpointStore(),private approvals=new FileApprovalStore(),memory=new ProjectMemoryStore()){
  this.memory=memory;this.runner=new TaskRunner(executions,checkpoints,memory);
 }
 private requestFor(target:SelectionFields,exclude:ProviderSelection[]=[]){return {preferredProvider:target.provider,preferredModel:target.model,demand:{capabilities:target.capabilities,estimatedInputTokens:target.estimatedInputTokens,estimatedOutputTokens:target.estimatedOutputTokens,maxCost:target.maxCost,minContextWindow:target.minContextWindow},exclude:exclude.map(item=>({provider:item.profile.provider,model:item.profile.model}))};}
 private validateGraph(plan:ProjectPlanValue){const ids=new Set<string>();for(const task of plan.tasks){if(ids.has(task.id))throw new Error("Duplicate task id: "+task.id);ids.add(task.id);}for(const task of plan.tasks)for(const dep of task.dependencies)if(!ids.has(dep))throw new Error("Missing dependency "+dep+" for "+task.id);}
 private async latestOutput(projectId:string,taskId:string){const records=await this.executions.list(projectId);const latest=records.filter(r=>r.taskId===taskId&&r.status==="SUCCEEDED").at(-1);if(!latest)throw new Error("No successful output: "+taskId);return latest.output;}
 private async buildPrompt(plan:ProjectPlanValue,taskId:string){const task=plan.tasks.find(x=>x.id===taskId);if(!task)throw new Error("Unknown task: "+taskId);if(!task.dependencies.length)return task.prompt;const upstream:string[]=[];for(const dep of task.dependencies)upstream.push("UPSTREAM "+dep+"\n"+await this.latestOutput(plan.projectId,dep));return task.prompt+"\n\n--- UPSTREAM ARTIFACTS ---\n"+upstream.join("\n\n");}
 private verdict(output:string){const first=output.split(/\r?\n/).map(x=>x.trim()).find(Boolean)?.toUpperCase()??"";if(first.startsWith("PASS"))return "PASS" as const;if(first.startsWith("CHANGES_REQUIRED"))return "CHANGES_REQUIRED" as const;throw new Error("Reviewer must start with PASS or CHANGES_REQUIRED");}
 private isCapacityFailure(error:unknown){if(!(error instanceof Error))return false;return error instanceof CapacityUnavailableError||/429|rate.?limit|quota|credit|capacity|overloaded/i.test(error.message);}
 private async alreadyComplete(plan:ProjectPlanValue,taskId:string){
  const task=plan.tasks.find(t=>t.id===taskId)!;const records=await this.executions.list(plan.projectId);
  const makerIndex=records.map((r,i)=>({r,i})).filter(x=>x.r.taskId===taskId&&x.r.status==="SUCCEEDED").at(-1)?.i;
  if(makerIndex==null)return false;if(!task.review)return true;
  return records.slice(makerIndex+1).some(r=>r.taskId.startsWith(taskId+"--review-")&&r.status==="SUCCEEDED"&&this.verdict(r.output)==="PASS");
 }
 private async execute(plan:ProjectPlanValue,target:SelectionFields,task:RunTask){
  const tried:ProviderSelection[]=[];
  for(;;){let selection:ProviderSelection;try{selection=this.selectProvider(this.requestFor(target,tried));}catch(error){if(error instanceof CapacityUnavailableError){await this.runner.pauseCapacity(task,error.message);return undefined;}throw error;}
   const records=await this.executions.list(plan.projectId),approved=selection.estimatedCost==null?false:await this.approvals.covers(plan.projectId,task.taskId,selection.estimatedCost);
   try{assertBudget(plan.budget,records,task.taskId,selection.estimatedCost,approved);}catch(error){if(error instanceof ApprovalRequiredError){await this.memory.recordStatus(plan.projectId,task.taskId,"APPROVAL_REQUIRED",error.message);return "APPROVAL_REQUIRED" as const;}throw error;}
   const priced={...task,estimatedCost:selection.estimatedCost,inputCostPerMillion:selection.profile.inputCostPerMillion,outputCostPerMillion:selection.profile.outputCostPerMillion};
   try{return await this.capacity.use(selection.profile.provider+"/"+selection.profile.model,selection.profile.maxConcurrency,()=>this.runner.run(priced,selection.provider));}catch(error){if(!this.isCapacityFailure(error))throw error;tried.push(selection);}
  }
 }
 async run(input:ProjectPlanValue):Promise<ProjectRunSummary>{
  const plan=ProjectPlan.parse(input);this.validateGraph(plan);await this.memory.init(plan);
  const completed=new Set<string>(),paused=new Set<string>(),approvalRequired=new Set<string>(),skipped=new Set<string>();const pending=new Map(plan.tasks.map(t=>[t.id,t]));
  for(const task of plan.tasks)if(await this.alreadyComplete(plan,task.id)){completed.add(task.id);pending.delete(task.id);skipped.add(task.id);await this.memory.recordStatus(plan.projectId,task.id,"SKIPPED_ALREADY_COMPLETE");}
  let waves=0,reviewRuns=0,revisions=0,failovers=0;
  while(pending.size){const ready=[...pending.values()].filter(t=>t.dependencies.every(dep=>completed.has(dep)));if(!ready.length)break;waves++;
   await Promise.all(ready.map(async task=>{const basePrompt=await this.buildPrompt(plan,task.id),before=(await this.executions.list(plan.projectId)).filter(r=>r.taskId===task.id&&r.status==="FAILED").length;
    const maker=await this.execute(plan,task,{projectId:plan.projectId,taskId:task.id,agentRole:task.agentRole,inputRefs:task.inputRefs,system:task.system,prompt:basePrompt,maxTokens:task.maxTokens});
    const after=(await this.executions.list(plan.projectId)).filter(r=>r.taskId===task.id&&r.status==="FAILED").length;failovers+=Math.max(0,after-before);
    if(maker==="APPROVAL_REQUIRED"){approvalRequired.add(task.id);return;}if(!maker){paused.add(task.id);return;}if(!task.review){completed.add(task.id);return;}
    for(let round=1;round<=task.review.maxRounds;round++){const output=await this.latestOutput(plan.projectId,task.id),reviewTaskId=task.id+"--review-"+round;
     const review=await this.execute(plan,task.review,{projectId:plan.projectId,taskId:reviewTaskId,agentRole:task.review.role,inputRefs:[...task.inputRefs,"execution:"+task.id],system:task.review.system,prompt:"Review the output below. The first non-empty line MUST be PASS or CHANGES_REQUIRED.\n\n"+output,maxTokens:task.review.maxTokens});
     if(review==="APPROVAL_REQUIRED"){approvalRequired.add(task.id);return;}if(!review){paused.add(task.id);return;}reviewRuns++;if(this.verdict(review.output)==="PASS"){completed.add(task.id);return;}if(round===task.review.maxRounds)throw new Error("Review failed after max rounds for "+task.id);revisions++;
     const revised=await this.execute(plan,task,{projectId:plan.projectId,taskId:task.id,agentRole:task.agentRole,inputRefs:[...task.inputRefs,"execution:"+reviewTaskId],system:task.system,prompt:basePrompt+"\n\n--- PREVIOUS OUTPUT ---\n"+output+"\n\n--- REVIEW FEEDBACK ---\n"+review.output+"\n\nRevise the work to address every required change.",maxTokens:task.maxTokens});
     if(revised==="APPROVAL_REQUIRED"){approvalRequired.add(task.id);return;}if(!revised){paused.add(task.id);return;}
    }
   }));for(const task of ready)pending.delete(task.id);
  }
  return {projectId:plan.projectId,completed:[...completed],paused:[...paused],approvalRequired:[...approvalRequired],skipped:[...skipped],waves,reviewRuns,revisions,failovers};
 }
}

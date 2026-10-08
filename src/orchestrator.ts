import {ProjectPlan,type ProjectPlanValue,type ProjectPlanInput} from "./project.js";
import type {ProviderSelector,ProviderSelection} from "./provider-selector.js";
import {CapacityUnavailableError} from "./errors.js";
import {assertBudget,ApprovalRequiredError} from "./budget.js";
import {FileApprovalStore} from "./approval-store.js";
import {KeyedSemaphore} from "./semaphore.js";
import {FileExecutionStore} from "./execution-store.js";
import {FileCheckpointStore} from "./checkpoint-store.js";
import {TaskRunner,type RunTask} from "./runner.js";
import {ProjectMemoryStore} from "./project-memory.js";
import type {ExecutionRecordValue} from "./execution-record.js";

export type ProjectRunSummary={projectId:string;completed:string[];paused:string[];approvalRequired:string[];skipped:string[];waves:number;reviewRuns:number;revisions:number;failovers:number};
type SelectionFields={provider?:string;model?:string;capabilities:string[];estimatedInputTokens:number;estimatedOutputTokens:number;maxCost?:number;minContextWindow?:number;};
type TaskPlan=ProjectPlanValue["tasks"][number];

export class ProjectOrchestrator{
 private runner:TaskRunner;private capacity=new KeyedSemaphore();private memory:ProjectMemoryStore;
 constructor(private selectProvider:ProviderSelector,private executions=new FileExecutionStore(),checkpoints=new FileCheckpointStore(),private approvals=new FileApprovalStore(),memory=new ProjectMemoryStore()){
  this.memory=memory;this.runner=new TaskRunner(executions,checkpoints,memory);
 }
 private requestFor(target:SelectionFields,exclude:ProviderSelection[]=[]){return {preferredProvider:target.provider,preferredModel:target.model,demand:{capabilities:target.capabilities,estimatedInputTokens:target.estimatedInputTokens,estimatedOutputTokens:target.estimatedOutputTokens,maxCost:target.maxCost,minContextWindow:target.minContextWindow},exclude:exclude.map(item=>({provider:item.profile.provider,model:item.profile.model,profileId:item.profile.id}))};}
 private validateGraph(plan:ProjectPlanValue){const ids=new Set<string>();for(const task of plan.tasks){if(ids.has(task.id))throw new Error("Duplicate task id: "+task.id);ids.add(task.id);}for(const task of plan.tasks)for(const dep of task.dependencies)if(!ids.has(dep))throw new Error("Missing dependency "+dep+" for "+task.id);}
 private verdict(output:string){const first=output.split(/\r?\n/).map(x=>x.trim()).find(Boolean)?.toUpperCase()??"";if(first.startsWith("PASS"))return "PASS" as const;if(first.startsWith("CHANGES_REQUIRED"))return "CHANGES_REQUIRED" as const;throw new Error("Reviewer must start with PASS or CHANGES_REQUIRED");}
 private isCapacityFailure(error:unknown){if(!(error instanceof Error))return false;return error instanceof CapacityUnavailableError||/429|rate.?limit|quota|credit|capacity|overloaded/i.test(error.message);}
 private downstream(plan:ProjectPlanValue,taskId:string){return plan.tasks.filter(t=>t.dependencies.includes(taskId)).map(t=>({taskId:t.id,role:t.agentRole}));}
 private history(records:ExecutionRecordValue[],task:TaskPlan){
  const indexed=records.map((record,index)=>({record,index}));
  const maker=indexed.filter(x=>x.record.taskId===task.id&&x.record.status==="SUCCEEDED").at(-1);
  const reviews=indexed.filter(x=>x.record.taskId.startsWith(task.id+"--review-")&&x.record.status==="SUCCEEDED");
  const lastReview=reviews.at(-1);let reviewVerdict:"PASS"|"CHANGES_REQUIRED"|undefined;
  if(lastReview)reviewVerdict=this.verdict(lastReview.record.output);
  const complete=Boolean(maker&&(!task.review||(lastReview&&lastReview.index>maker.index&&reviewVerdict==="PASS")));
  const needsRevision=Boolean(task.review&&maker&&lastReview&&lastReview.index>maker.index&&reviewVerdict==="CHANGES_REQUIRED");
  return {maker,lastReview,reviewCount:reviews.length,complete,needsRevision};
 }
 private async latestOutput(projectId:string,taskId:string){const records=await this.executions.list(projectId),latest=records.filter(r=>r.taskId===taskId&&r.status==="SUCCEEDED").at(-1);if(!latest)throw new Error("No successful output: "+taskId);return latest.output;}
 private async buildPrompt(plan:ProjectPlanValue,taskId:string){const task=plan.tasks.find(x=>x.id===taskId);if(!task)throw new Error("Unknown task: "+taskId);if(!task.dependencies.length)return task.prompt;const upstream:string[]=[];for(const dep of task.dependencies)upstream.push("UPSTREAM "+dep+"\n"+await this.latestOutput(plan.projectId,dep));return task.prompt+"\n\n--- UPSTREAM ARTIFACTS ---\n"+upstream.join("\n\n");}
 private async execute(plan:ProjectPlanValue,target:SelectionFields,task:RunTask,approvalKey=task.taskId){
  const tried:ProviderSelection[]=[];
  for(;;){
   let selection:ProviderSelection;
   try{selection=this.selectProvider(this.requestFor(target,tried));}catch(error){if(error instanceof CapacityUnavailableError){await this.runner.pauseCapacity(task,error.message);return undefined;}throw error;}
   const records=await this.executions.list(plan.projectId),approved=selection.estimatedCost==null?false:await this.approvals.covers(plan.projectId,approvalKey,selection.estimatedCost);
   try{assertBudget(plan.budget,records,{taskId:approvalKey,department:task.department,agentRole:task.agentRole},selection.estimatedCost,approved);}catch(error){if(error instanceof ApprovalRequiredError){await this.approvals.request(plan.projectId,approvalKey,error.estimatedCost);await this.memory.recordStatus(plan.projectId,approvalKey,"APPROVAL_REQUIRED",error.message);return "APPROVAL_REQUIRED" as const;}throw error;}
   const priced={...task,estimatedCost:selection.estimatedCost,inputCostPerMillion:selection.profile.inputCostPerMillion,outputCostPerMillion:selection.profile.outputCostPerMillion};
   try{const result=await this.capacity.use(selection.profile.provider+"/"+selection.profile.model,selection.profile.maxConcurrency,()=>this.runner.run(priced,selection.provider));this.selectProvider.reportSuccess?.(selection,{inputTokens:result.inputTokens,outputTokens:result.outputTokens,actualCost:result.actualCost});return result;}catch(error){if(!this.isCapacityFailure(error))throw error;this.selectProvider.reportFailure?.(selection,error);tried.push(selection);}
  }
 }
 async run(input:ProjectPlanInput):Promise<ProjectRunSummary>{
  const plan=ProjectPlan.parse(input);this.validateGraph(plan);await this.memory.init(plan);
  const completed=new Set<string>(),paused=new Set<string>(),approvalRequired=new Set<string>(),skipped=new Set<string>(),pending=new Map(plan.tasks.map(t=>[t.id,t]));
  const initialRecords=await this.executions.list(plan.projectId);
  for(const task of plan.tasks){if(this.history(initialRecords,task).complete){completed.add(task.id);pending.delete(task.id);skipped.add(task.id);await this.memory.recordStatus(plan.projectId,task.id,"SKIPPED_ALREADY_COMPLETE");}}
  let waves=0,reviewRuns=0,revisions=0,failovers=0;
  while(pending.size){
   const ready=[...pending.values()].filter(t=>t.dependencies.every(dep=>completed.has(dep)));if(!ready.length)break;waves++;
   await Promise.all(ready.map(async task=>{
    const basePrompt=await this.buildPrompt(plan,task.id);let records=await this.executions.list(plan.projectId),state=this.history(records,task),maker=state.maker?.record;
    if(!maker){
     const before=records.filter(r=>r.taskId===task.id&&r.status==="FAILED").length;
     const result=await this.execute(plan,task,{projectId:plan.projectId,taskId:task.id,agentRole:task.agentRole,department:task.department,inputRefs:task.inputRefs,system:task.system,prompt:basePrompt,maxTokens:task.maxTokens,workspace:plan.workspace,handoffTo:this.downstream(plan,task.id)},task.id);
     const after=(await this.executions.list(plan.projectId)).filter(r=>r.taskId===task.id&&r.status==="FAILED").length;failovers+=Math.max(0,after-before);
     if(result==="APPROVAL_REQUIRED"){approvalRequired.add(task.id);return;}if(!result){paused.add(task.id);return;}maker=result;
    }
    if(!task.review){completed.add(task.id);return;}
    records=await this.executions.list(plan.projectId);state=this.history(records,task);
    if(state.needsRevision&&state.lastReview){
     if(state.reviewCount>=task.review.maxRounds)throw new Error("Review failed after max rounds for "+task.id);
     revisions++;const revised=await this.execute(plan,task,{projectId:plan.projectId,taskId:task.id,agentRole:task.agentRole,department:task.department,inputRefs:[...task.inputRefs,"execution:"+state.lastReview.record.taskId],system:task.system,prompt:basePrompt+"\n\n--- PREVIOUS OUTPUT ---\n"+maker.output+"\n\n--- REVIEW FEEDBACK ---\n"+state.lastReview.record.output+"\n\nRevise the work to address every required change.",maxTokens:task.maxTokens,workspace:plan.workspace,handoffTo:this.downstream(plan,task.id)},task.id);
     if(revised==="APPROVAL_REQUIRED"){approvalRequired.add(task.id);return;}if(!revised){paused.add(task.id);return;}maker=revised;
    }
    records=await this.executions.list(plan.projectId);state=this.history(records,task);
    for(let round=state.reviewCount+1;round<=task.review.maxRounds;round++){
     const output=await this.latestOutput(plan.projectId,task.id),reviewTaskId=task.id+"--review-"+round;
     const review=await this.execute(plan,task.review,{projectId:plan.projectId,taskId:reviewTaskId,agentRole:task.review.role,department:task.review.department,inputRefs:[...task.inputRefs,"execution:"+task.id],system:task.review.system,prompt:"Review the output below. The first non-empty line MUST be PASS or CHANGES_REQUIRED.\n\n"+output,maxTokens:task.review.maxTokens},task.id);
     if(review==="APPROVAL_REQUIRED"){approvalRequired.add(task.id);return;}if(!review){paused.add(task.id);return;}reviewRuns++;
     if(this.verdict(review.output)==="PASS"){completed.add(task.id);return;}
     if(round===task.review.maxRounds)throw new Error("Review failed after max rounds for "+task.id);
     revisions++;const revised=await this.execute(plan,task,{projectId:plan.projectId,taskId:task.id,agentRole:task.agentRole,department:task.department,inputRefs:[...task.inputRefs,"execution:"+reviewTaskId],system:task.system,prompt:basePrompt+"\n\n--- PREVIOUS OUTPUT ---\n"+output+"\n\n--- REVIEW FEEDBACK ---\n"+review.output+"\n\nRevise the work to address every required change.",maxTokens:task.maxTokens,workspace:plan.workspace,handoffTo:this.downstream(plan,task.id)},task.id);
     if(revised==="APPROVAL_REQUIRED"){approvalRequired.add(task.id);return;}if(!revised){paused.add(task.id);return;}
    }
   }));
   for(const task of ready)pending.delete(task.id);
  }
  return {projectId:plan.projectId,completed:[...completed],paused:[...paused],approvalRequired:[...approvalRequired],skipped:[...skipped],waves,reviewRuns,revisions,failovers};
 }
}

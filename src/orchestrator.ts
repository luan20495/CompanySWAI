import {ProjectPlan,type ProjectPlanValue} from "./project.js";
import type {ProviderSelector} from "./provider-selector.js";
import {FileExecutionStore} from "./execution-store.js";
import {FileCheckpointStore} from "./checkpoint-store.js";
import {TaskRunner} from "./runner.js";

export type ProjectRunSummary={projectId:string;completed:string[];waves:number;reviewRuns:number;revisions:number};

type SelectionFields={
 provider?:string;model?:string;capabilities:string[];
 estimatedInputTokens:number;estimatedOutputTokens:number;maxCost?:number;minContextWindow?:number;
};

export class ProjectOrchestrator{
 private runner:TaskRunner;

 constructor(
  private selectProvider:ProviderSelector,
  private executions=new FileExecutionStore(),
  checkpoints=new FileCheckpointStore()
 ){
  this.runner=new TaskRunner(executions,checkpoints);
 }

 private providerFor(target:SelectionFields){
  return this.selectProvider({
   preferredProvider:target.provider,
   preferredModel:target.model,
   demand:{
    capabilities:target.capabilities,
    estimatedInputTokens:target.estimatedInputTokens,
    estimatedOutputTokens:target.estimatedOutputTokens,
    maxCost:target.maxCost,
    minContextWindow:target.minContextWindow
   }
  });
 }

 private validateGraph(plan:ProjectPlanValue){
  const ids=new Set<string>();
  for(const task of plan.tasks){
   if(ids.has(task.id))throw new Error("Duplicate task id: "+task.id);
   ids.add(task.id);
  }
  for(const task of plan.tasks){
   for(const dep of task.dependencies){
    if(!ids.has(dep))throw new Error("Missing dependency "+dep+" for "+task.id);
   }
  }
 }

 private async latestOutput(projectId:string,taskId:string){
  const records=await this.executions.list(projectId);
  const matches=records.filter(record=>record.taskId===taskId&&record.status==="SUCCEEDED");
  const latest=matches.length?matches[matches.length-1]:undefined;
  if(!latest)throw new Error("No successful output: "+taskId);
  return latest.output;
 }

 private async buildPrompt(plan:ProjectPlanValue,taskId:string){
  const task=plan.tasks.find(item=>item.id===taskId);
  if(!task)throw new Error("Unknown task: "+taskId);
  if(task.dependencies.length===0)return task.prompt;
  const upstream:string[]=[];
  for(const dep of task.dependencies){
   upstream.push("UPSTREAM "+dep+"\n"+await this.latestOutput(plan.projectId,dep));
  }
  return task.prompt+"\n\n--- UPSTREAM ARTIFACTS ---\n"+upstream.join("\n\n");
 }

 private verdict(output:string){
  const first=output.split(/\r?\n/).map(line=>line.trim()).find(Boolean)?.toUpperCase()??"";
  if(first.startsWith("PASS"))return "PASS" as const;
  if(first.startsWith("CHANGES_REQUIRED"))return "CHANGES_REQUIRED" as const;
  throw new Error("Reviewer must start with PASS or CHANGES_REQUIRED");
 }

 async run(input:ProjectPlanValue):Promise<ProjectRunSummary>{
  const plan=ProjectPlan.parse(input);
  this.validateGraph(plan);
  const completed=new Set<string>();
  const pending=new Map(plan.tasks.map(task=>[task.id,task]));
  let waves=0;
  let reviewRuns=0;
  let revisions=0;

  while(pending.size){
   const ready=[...pending.values()].filter(task=>task.dependencies.every(dep=>completed.has(dep)));
   if(ready.length===0)throw new Error("Dependency cycle detected");
   waves++;

   await Promise.all(ready.map(async task=>{
    const basePrompt=await this.buildPrompt(plan,task.id);
    const maker=this.providerFor(task);
    await this.runner.run({
     projectId:plan.projectId,taskId:task.id,agentRole:task.agentRole,inputRefs:task.inputRefs,
     system:task.system,prompt:basePrompt,maxTokens:task.maxTokens
    },maker);

    if(!task.review)return;

    for(let round=1;round<=task.review.maxRounds;round++){
     const output=await this.latestOutput(plan.projectId,task.id);
     const reviewer=this.providerFor(task.review);
     const reviewTaskId=task.id+"--review-"+round;
     const review=await this.runner.run({
      projectId:plan.projectId,
      taskId:reviewTaskId,
      agentRole:task.review.role,
      inputRefs:[...task.inputRefs,"execution:"+task.id],
      system:task.review.system,
      prompt:"Review the output below. The first non-empty line MUST be PASS or CHANGES_REQUIRED.\n\n"+output,
      maxTokens:task.review.maxTokens
     },reviewer);
     reviewRuns++;
     if(this.verdict(review.output)==="PASS")return;
     if(round===task.review.maxRounds)throw new Error("Review failed after max rounds for "+task.id);

     revisions++;
     await this.runner.run({
      projectId:plan.projectId,
      taskId:task.id,
      agentRole:task.agentRole,
      inputRefs:[...task.inputRefs,"execution:"+reviewTaskId],
      system:task.system,
      prompt:basePrompt+"\n\n--- PREVIOUS OUTPUT ---\n"+output+"\n\n--- REVIEW FEEDBACK ---\n"+review.output+"\n\nRevise the work to address every required change.",
      maxTokens:task.maxTokens
     },maker);
    }
   }));

   for(const task of ready){
    completed.add(task.id);
    pending.delete(task.id);
   }
  }

  return {projectId:plan.projectId,completed:[...completed],waves,reviewRuns,revisions};
 }
}

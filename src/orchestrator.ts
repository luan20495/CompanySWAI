import type {ModelProvider} from "./provider.js";
import type {ProjectPlanValue} from "./project.js";
import {FileExecutionStore} from "./execution-store.js";
import {FileCheckpointStore} from "./checkpoint-store.js";
import {TaskRunner} from "./runner.js";

export type ProviderResolver=(provider:string,model:string)=>ModelProvider;
export type ProjectRunSummary={projectId:string;completed:string[];waves:number};

export class ProjectOrchestrator{
 private runner:TaskRunner;

 constructor(
  private resolve:ProviderResolver,
  private executions=new FileExecutionStore(),
  checkpoints=new FileCheckpointStore()
 ){
  this.runner=new TaskRunner(executions,checkpoints);
 }

 private validate(plan:ProjectPlanValue){
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

 private async buildPrompt(plan:ProjectPlanValue,taskId:string){
  const task=plan.tasks.find(item=>item.id===taskId);
  if(!task)throw new Error("Unknown task: "+taskId);
  if(task.dependencies.length===0)return task.prompt;

  const records=await this.executions.list(plan.projectId);
  const upstream:string[]=[];
  for(const dep of task.dependencies){
   const matches=records.filter(record=>record.taskId===dep&&record.status==="SUCCEEDED");
   const latest=matches.length?matches[matches.length-1]:undefined;
   if(!latest)throw new Error("No successful upstream output: "+dep);
   upstream.push("UPSTREAM "+dep+"\n"+latest.output);
  }
  return task.prompt+"\n\n--- UPSTREAM ARTIFACTS ---\n"+upstream.join("\n\n");
 }

 async run(plan:ProjectPlanValue):Promise<ProjectRunSummary>{
  this.validate(plan);
  const completed=new Set<string>();
  const pending=new Map(plan.tasks.map(task=>[task.id,task]));
  let waves=0;

  while(pending.size){
   const ready=[...pending.values()].filter(task=>task.dependencies.every(dep=>completed.has(dep)));
   if(ready.length===0)throw new Error("Dependency cycle detected");
   waves++;

   await Promise.all(ready.map(async task=>{
    const prompt=await this.buildPrompt(plan,task.id);
    const provider=this.resolve(task.provider,task.model);
    await this.runner.run({
     projectId:plan.projectId,
     taskId:task.id,
     agentRole:task.agentRole,
     inputRefs:task.inputRefs,
     system:task.system,
     prompt,
     maxTokens:task.maxTokens
    },provider);
   }));

   for(const task of ready){
    completed.add(task.id);
    pending.delete(task.id);
   }
  }

  return {projectId:plan.projectId,completed:[...completed],waves};
 }
}

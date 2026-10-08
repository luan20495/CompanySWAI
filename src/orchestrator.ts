import {ProjectPlan,type ProjectPlanValue,type ProjectPlanInput} from "./project.js";
import type {ProviderSelector,ProviderSelection} from "./provider-selector.js";
import {isProviderFailure} from "./provider-selector.js";
import {CapacityUnavailableError} from "./errors.js";
import {ApprovalRequiredError,assertBudget,budgetReport,type BudgetReport,type InFlightCost} from "./budget.js";
import {KeyedSemaphore} from "./semaphore.js";
import {TaskRunner,type RunTask} from "./runner.js";
import {CompanyState} from "./state.js";
import {REVIEW_REQUEST_PREFIX,condense,parseReviewVerdict} from "./output-parser.js";
import {LocalRepoWorkspace} from "./repo-workspace.js";
import {redactError} from "./secrets.js";
import type {ExecutionRecordValue} from "./execution-record.js";

export type ProjectRunSummary={
 projectId:string;completed:string[];paused:string[];approvalRequired:string[];failed:string[];waiting:string[];skipped:string[];
 waves:number;reviewRuns:number;revisions:number;failovers:number;budget:BudgetReport;
};
export type OrchestratorOptions={
 /** When set, a task that needs approval waits (polling the persisted approval) instead of ending the run. */
 approvalWait?:{pollMs:number;timeoutMs:number};
 /** Upper bound for the upstream context handed to a task, per dependency. */
 maxUpstreamChars?:number;
 sleep?:(ms:number)=>Promise<void>;
};
type SelectionFields={provider?:string;model?:string;capabilities:string[];estimatedInputTokens:number;estimatedOutputTokens:number;maxCost?:number;minContextWindow?:number;};
type TaskPlan=ProjectPlanValue["tasks"][number];
type Pause="PAUSED"|"APPROVAL_REQUIRED";
type Counters={reviewRuns:number;revisions:number;failovers:number};

class ReviewExhaustedError extends Error{constructor(taskId:string,rounds:number){super("Review still requires changes after "+rounds+" round(s) for "+taskId);this.name="ReviewExhaustedError";}}

class Mutex{
 private tail:Promise<unknown>=Promise.resolve();
 run<T>(fn:()=>Promise<T>):Promise<T>{const next=this.tail.then(fn,fn);this.tail=next.catch(()=>undefined);return next;}
}
const DEFAULT_UPSTREAM_CHARS=8000;

export class ProjectOrchestrator{
 private runner:TaskRunner;private capacity=new KeyedSemaphore();private budgetGate=new Mutex();private inFlight=new Set<InFlightCost>();
 constructor(private selectProvider:ProviderSelector,private state=new CompanyState(),private options:OrchestratorOptions={}){
  this.runner=new TaskRunner(state);
 }

 /** Structural validation: unique ids, known dependencies, acyclic graph, reviewers independent of their makers. */
 private validate(plan:ProjectPlanValue){
  const byId=new Map<string,TaskPlan>();
  for(const task of plan.tasks){if(byId.has(task.id))throw new Error("Duplicate task id: "+task.id);byId.set(task.id,task);}
  for(const task of plan.tasks){
   for(const dep of task.dependencies)if(!byId.has(dep))throw new Error("Missing dependency "+dep+" for "+task.id);
   if(task.review&&task.review.role===task.agentRole)throw new Error("Reviewer independence violated: "+task.id+" would be reviewed by its own role "+task.agentRole);
  }
  const visiting=new Set<string>(),done=new Set<string>();
  const visit=(id:string,path:string[])=>{
   if(done.has(id))return;
   if(visiting.has(id))throw new Error("Dependency cycle: "+[...path,id].join(" -> "));
   visiting.add(id);for(const dep of byId.get(id)!.dependencies)visit(dep,[...path,id]);visiting.delete(id);done.add(id);
  };
  for(const task of plan.tasks)visit(task.id,[]);
 }
 private requestFor(target:SelectionFields,exclude:ProviderSelection[]=[]){
  return {preferredProvider:target.provider,preferredModel:target.model,demand:{capabilities:target.capabilities,estimatedInputTokens:target.estimatedInputTokens,estimatedOutputTokens:target.estimatedOutputTokens,maxCost:target.maxCost,minContextWindow:target.minContextWindow},exclude:exclude.map(item=>({provider:item.profile.provider,model:item.profile.model,profileId:item.profile.id}))};
 }
 private downstream(plan:ProjectPlanValue,taskId:string){return plan.tasks.filter(t=>t.dependencies.includes(taskId)).map(t=>({taskId:t.id,role:t.agentRole}));}

 /** Derives a task's position from the persisted execution log alone; this is what makes resume deterministic. */
 private history(records:ExecutionRecordValue[],task:TaskPlan){
  const indexed=records.map((record,index)=>({record,index}));
  const maker=indexed.filter(x=>x.record.taskId===task.id&&x.record.status==="SUCCEEDED").at(-1);
  const reviews=indexed.filter(x=>x.record.taskId.startsWith(task.id+"--review-")&&x.record.status==="SUCCEEDED");
  const lastReview=reviews.at(-1),reviewedMaker=Boolean(maker&&lastReview&&lastReview.index>maker.index);
  const verdict=lastReview?parseReviewVerdict(lastReview.record.output)??"CHANGES_REQUIRED":undefined;
  return {
   maker:maker?.record,lastReview:lastReview?.record,reviewCount:reviews.length,
   complete:Boolean(maker&&(!task.review||(reviewedMaker&&verdict==="PASS"))),
   needsRevision:Boolean(task.review&&maker&&reviewedMaker&&verdict==="CHANGES_REQUIRED")
  };
 }
 /** A model response that was paid for but never finalized (crash between provider return and persistence). */
 private unfinalized(records:ExecutionRecordValue[],taskId:string){
  const terminal=new Set(records.filter(r=>r.status==="SUCCEEDED"||r.status==="FAILED").map(r=>r.id));
  return records.filter(r=>r.taskId===taskId&&r.status==="CHECKPOINTED"&&!terminal.has(r.id)).at(-1);
 }
 private latestOutput(records:ExecutionRecordValue[],taskId:string){
  const latest=records.filter(r=>r.taskId===taskId&&r.status==="SUCCEEDED").at(-1);
  if(!latest)throw new Error("No successful output: "+taskId);
  return latest.output;
 }
 /** Upstream context is the handoff-bearing sections of each dependency, bounded; full artifacts stay in the stores. */
 private buildPrompt(plan:ProjectPlanValue,task:TaskPlan,records:ExecutionRecordValue[]){
  if(!task.dependencies.length)return task.prompt;
  const limit=this.options.maxUpstreamChars??DEFAULT_UPSTREAM_CHARS;
  const upstream=task.dependencies.map(dep=>"UPSTREAM "+dep+"\n"+condense(this.latestOutput(records,dep),limit));
  return task.prompt+"\n\n--- UPSTREAM ARTIFACTS ---\n"+upstream.join("\n\n");
 }
 private makerRun(plan:ProjectPlanValue,task:TaskPlan,prompt:string,inputRefs=task.inputRefs):RunTask{
  return {projectId:plan.projectId,taskId:task.id,agentRole:task.agentRole,department:task.department,kind:"maker",produces:task.produces,inputRefs,system:task.system,prompt,maxTokens:task.maxTokens,contract:task.contract,workspace:plan.workspace,handoffTo:this.downstream(plan,task.id)};
 }

 private async waitForApproval(projectId:string,key:string,cost:number){
  const wait=this.options.approvalWait;if(!wait)return false;
  const sleep=this.options.sleep??(ms=>new Promise<void>(resolve=>setTimeout(resolve,ms)));
  const deadline=Date.now()+wait.timeoutMs;
  while(Date.now()<=deadline){
   if(await this.state.approvals.covers(projectId,key,cost))return true;
   await sleep(wait.pollMs);
  }
  return await this.state.approvals.covers(projectId,key,cost);
 }

 /** Budget check and in-flight reservation are one serialized step, so parallel tasks cannot jointly overspend. */
 private admit(plan:ProjectPlanValue,task:RunTask,approvalKey:string,selection:ProviderSelection){
  return this.budgetGate.run(async():Promise<{reservation:InFlightCost}|{approval:ApprovalRequiredError}>=>{
   // Subscription-billed profiles have no per-token price, so money limits and cost approvals do not apply to them.
   if(selection.profile.billing==="subscription")return {reservation:{taskId:approvalKey,department:task.department??"general",agentRole:task.agentRole,estimatedCost:0}};
   const records=await this.state.executions.list(plan.projectId);
   const approved=selection.estimatedCost==null?false:await this.state.approvals.covers(plan.projectId,approvalKey,selection.estimatedCost);
   const context={taskId:approvalKey,department:task.department??"general",agentRole:task.agentRole};
   try{assertBudget(plan.budget,records,context,selection.estimatedCost,approved,[...this.inFlight]);}
   catch(error){
    if(error instanceof ApprovalRequiredError)return {approval:error};
    throw error;
   }
   const reservation={...context,estimatedCost:selection.estimatedCost??0};
   this.inFlight.add(reservation);
   return {reservation};
  });
 }

 /** One model run with failover. Returns the SUCCEEDED record, or why the task cannot proceed right now. */
 private async execute(plan:ProjectPlanValue,target:SelectionFields,task:RunTask,approvalKey:string,counters:Counters):Promise<ExecutionRecordValue|Pause>{
  const pending=this.unfinalized(await this.state.executions.list(plan.projectId),task.taskId);
  if(pending)return this.runner.finalize(task,pending);
  const tried:ProviderSelection[]=[];
  for(;;){
   let selection:ProviderSelection;
   try{selection=this.selectProvider(this.requestFor(target,tried));}
   catch(error){if(error instanceof CapacityUnavailableError){await this.runner.pauseCapacity(task,error.message);return "PAUSED";}throw error;}
   let admission;
   try{admission=await this.admit(plan,task,approvalKey,selection);}
   catch(error){this.selectProvider.release?.(selection);throw error;}
   if("approval" in admission){
    this.selectProvider.release?.(selection);
    const needed=admission.approval.estimatedCost;
    await this.state.approvals.request(plan.projectId,approvalKey,needed);
    await this.state.memory.recordStatus(plan.projectId,approvalKey,"APPROVAL_REQUIRED",admission.approval.message);
    if(await this.waitForApproval(plan.projectId,approvalKey,needed))continue;
    return "APPROVAL_REQUIRED";
   }
   const priced={...task,billing:selection.profile.billing??"metered",estimatedCost:selection.estimatedCost,inputCostPerMillion:selection.profile.inputCostPerMillion,outputCostPerMillion:selection.profile.outputCostPerMillion};
   try{
    const result=await this.capacity.use(selection.profile.id??selection.profile.provider+"/"+selection.profile.model,selection.profile.maxConcurrency,()=>this.runner.run(priced,selection.provider));
    this.selectProvider.reportSuccess?.(selection,{inputTokens:result.inputTokens,outputTokens:result.outputTokens,actualCost:result.actualCost});
    return result;
   }catch(error){
    if(!isProviderFailure(error)){this.selectProvider.release?.(selection);throw error;}
    this.selectProvider.reportFailure?.(selection,error);tried.push(selection);counters.failovers++;
   }finally{this.inFlight.delete(admission.reservation);}
  }
 }

 /** Advances one task from whatever state the log says it is in until it is done, parked or failed. */
 private async advance(plan:ProjectPlanValue,task:TaskPlan,counters:Counters):Promise<"DONE"|Pause>{
  for(;;){
   const records=await this.state.executions.list(plan.projectId),state=this.history(records,task);
   if(state.complete)return "DONE";
   if(!state.maker){
    const result=await this.execute(plan,task,this.makerRun(plan,task,this.buildPrompt(plan,task,records)),task.id,counters);
    if(typeof result==="string")return result;
    continue;
   }
   const review=task.review;if(!review)return "DONE";
   if(state.reviewCount>=review.maxRounds)throw new ReviewExhaustedError(task.id,review.maxRounds);
   if(state.needsRevision&&state.lastReview){
    counters.revisions++;
    const prompt=this.buildPrompt(plan,task,records)+"\n\n--- PREVIOUS OUTPUT ---\n"+state.maker.output+"\n\n--- REVIEW FEEDBACK ---\n"+state.lastReview.output+"\n\nRevise the work to address every required change.";
    const result=await this.execute(plan,task,this.makerRun(plan,task,prompt,[...task.inputRefs,"execution:"+state.lastReview.taskId]),task.id,counters);
    if(typeof result==="string")return result;
    continue;
   }
   const round=state.reviewCount+1,reviewTaskId=task.id+"--review-"+round;
   const run:RunTask={projectId:plan.projectId,taskId:reviewTaskId,agentRole:review.role,department:review.department,kind:"review",inputRefs:[...task.inputRefs,"execution:"+task.id],system:review.system,prompt:REVIEW_REQUEST_PREFIX+" The first non-empty line MUST be PASS or CHANGES_REQUIRED.\n\n--- TASK ---\n"+task.prompt+"\n\n--- OUTPUT UNDER REVIEW ---\n"+state.maker.output,maxTokens:review.maxTokens,contract:review.contract};
   const result=await this.execute(plan,review,run,task.id,counters);
   if(typeof result==="string")return result;
   counters.reviewRuns++;
  }
 }

 private async fail(plan:ProjectPlanValue,task:TaskPlan,error:unknown){
  const message=redactError(error),at=new Date().toISOString();
  await this.state.memory.recordStatus(plan.projectId,task.id,"BLOCKED",message);
  await this.state.memory.append(plan.projectId,"BLOCKERS.md","\n## "+task.id+" — run failure\n\n"+message+"\n");
  await this.state.checkpoints.save(plan.projectId,{taskId:task.id,at,status:"BLOCKED",completed:[],remaining:["resolve: "+message.slice(0,200)],artifactRefs:[],decisionRefs:[],compactContext:message,inputTokens:0,outputTokens:0});
 }

 async run(input:ProjectPlanInput):Promise<ProjectRunSummary>{
  const plan=ProjectPlan.parse(input);this.validate(plan);
  if(plan.workspace)await new LocalRepoWorkspace(plan.workspace.path).validate({requireGit:plan.workspace.autoCommit});
  await this.state.memory.init(plan);
  const states=new Map<string,string>(),completed=new Set<string>(),paused=new Set<string>(),approvalRequired=new Set<string>(),failed=new Set<string>(),skipped=new Set<string>();
  const pending=new Map(plan.tasks.map(t=>[t.id,t])),counters:Counters={reviewRuns:0,revisions:0,failovers:0};
  const initialRecords=await this.state.executions.list(plan.projectId);
  for(const task of plan.tasks)if(this.history(initialRecords,task).complete){
   completed.add(task.id);pending.delete(task.id);skipped.add(task.id);states.set(task.id,"DONE");
   await this.state.memory.recordStatus(plan.projectId,task.id,"SKIPPED_ALREADY_COMPLETE");
  }
  await this.state.memory.syncPlan(plan,states);
  let waves=0;
  while(pending.size){
   const ready=[...pending.values()].filter(t=>t.dependencies.every(dep=>completed.has(dep)));
   if(!ready.length)break;
   waves++;
   await Promise.all(ready.map(async task=>{
    try{
     const outcome=await this.advance(plan,task,counters);
     if(outcome==="DONE"){
      completed.add(task.id);states.set(task.id,"DONE");
      await this.state.memory.recordStatus(plan.projectId,task.id,"DONE");
      const checkpoint=await this.state.checkpoints.load(plan.projectId,task.id);
      if(checkpoint)await this.state.checkpoints.save(plan.projectId,{...checkpoint,at:new Date().toISOString(),status:"DONE",remaining:[]});
     }
     else if(outcome==="PAUSED"){paused.add(task.id);states.set(task.id,"PAUSED_CAPACITY");}
     else{approvalRequired.add(task.id);states.set(task.id,"APPROVAL_REQUIRED");}
    }catch(error){failed.add(task.id);states.set(task.id,"BLOCKED");await this.fail(plan,task,error);}
   }));
   for(const task of ready)pending.delete(task.id);
   await this.state.memory.syncPlan(plan,states);
  }
  const waiting=[...pending.keys()];
  for(const id of waiting)states.set(id,"WAITING");
  await this.state.memory.syncPlan(plan,states);
  const budget=budgetReport(plan.budget,await this.state.executions.list(plan.projectId));
  return {projectId:plan.projectId,completed:[...completed],paused:[...paused],approvalRequired:[...approvalRequired],failed:[...failed],waiting,skipped:[...skipped],waves,...counters,budget};
 }
}

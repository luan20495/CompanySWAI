import {randomUUID} from "node:crypto";
import {ProjectPlan,type ProjectPlanInput,type ProjectPlanValue,type TaskPlanValue} from "./project.js";
import type {ProviderSelection,ProviderSelector} from "./provider-selector.js";
import {isProviderFailure} from "./provider-selector.js";
import {CapacityUnavailableError} from "./errors.js";
import {ApprovalRequiredError,assertBudget,budgetReport,type BudgetReport,type InFlightCost} from "./budget.js";
import {KeyedSemaphore} from "./semaphore.js";
import {TaskRunner,type RunTask} from "./runner.js";
import {CompanyState} from "./state.js";
import {parseReviewVerdict} from "./output-parser.js";
import {makerContext,reviewContext,type ContextEntry,type Upstream} from "./context.js";
import {LocalRepoWorkspace,WorkspaceError} from "./repo-workspace.js";
import {WorktreeManager} from "./worktrees.js";
import {join} from "node:path";
import {redactError} from "./secrets.js";
import {RunMetrics,type MetricsSnapshot,type TaskOutcome} from "./metrics.js";
import type {ExecutionRecordValue} from "./execution-record.js";
import {defaultConnectorRegistry,gatherResearch,renderRetrieved,type ConnectorRegistry,type ResearchDocument} from "./research-connectors.js";

export type ProjectRunSummary={
 projectId:string;runId:string;completed:string[];paused:string[];approvalRequired:string[];failed:string[];waiting:string[];skipped:string[];
 waves:number;reviewRuns:number;revisions:number;disagreements:number;failovers:number;budget:BudgetReport;metrics:MetricsSnapshot;
};
export type OrchestratorOptions={
 /** When set, a task that needs approval waits (polling the persisted approval) instead of ending the run. */
 approvalWait?:{pollMs:number;timeoutMs:number};
 /** Upper bound for the upstream context handed to a task, per dependency. */
 maxUpstreamChars?:number;
 /** Upper bound for the artifact a reviewer sees (they must see all of it). */
 maxReviewArtifactChars?:number;
 sleep?:(ms:number)=>Promise<void>;
 /** Tasks running at the same time within this project (backpressure); further ready tasks queue. */
 maxParallelTasks?:number;
 /** Longest a task waits for a rate-limited provider to cool down before it is parked as PAUSED_CAPACITY. */
 maxCooldownWaitMs?:number;
 /** One priority point is earned per this many ms of waiting, so low-priority tasks cannot starve. */
 agingMs?:number;
 /** Provider failures tolerated for one model step before the task fails. */
 maxProviderAttempts?:number;
 now?:()=>number;
 /** Extra model attempts after an isolated task conflicted with already-integrated work. */
 maxConflictRetries?:number;
 /** Extra model attempts after generated code failed its deterministic gates (the failure output is fed back). */
 maxGateRepairs?:number;
 /** Research connector kinds available to plans (default: static corpus and http-json). */
 connectors?:ConnectorRegistry;
};
type SelectionFields={provider?:string;model?:string;capabilities:string[];estimatedInputTokens:number;estimatedOutputTokens:number;maxCost?:number;minContextWindow?:number;routing?:string;minQualityTier?:number};
type Pause="PAUSED"|"APPROVAL_REQUIRED";
type Counters={reviewRuns:number;revisions:number;disagreements:number;failovers:number};

class ReviewExhaustedError extends Error{constructor(taskId:string,rounds:number){super("Review still requires changes after "+rounds+" round(s) for "+taskId);this.name="ReviewExhaustedError";}}
class GateError extends Error{constructor(message:string){super(message);this.name="GateError";}}

class Mutex{
 private tail:Promise<unknown>=Promise.resolve();
 run<T>(fn:()=>Promise<T>):Promise<T>{const next=this.tail.then(fn,fn);this.tail=next.catch(()=>undefined);return next;}
}
/** Event signal: waiters resume on the next notify() or when their timer fires. Nothing polls. */
class Signal{
 private waiters=new Set<()=>void>();
 notify(){for(const wake of [...this.waiters])wake();}
 wait(ms?:number){
  return new Promise<void>(resolve=>{
   let timer:NodeJS.Timeout|undefined;
   const wake=()=>{if(timer)clearTimeout(timer);this.waiters.delete(wake);resolve();};
   if(ms!=null)timer=setTimeout(wake,Math.max(1,ms));
   this.waiters.add(wake);
  });
 }
}
const DEFAULT_UPSTREAM_CHARS=30_000,DEFAULT_REVIEW_ARTIFACT_CHARS=80_000,DEFAULT_PARALLEL=4,DEFAULT_COOLDOWN_WAIT_MS=120_000,DEFAULT_AGING_MS=20_000,DEFAULT_PROVIDER_ATTEMPTS=8;

/** Highest effective priority first: static priority (critical-path weight) plus aging; ties by id for determinism. */
export function pickNext<T extends {id:string;priority:number}>(candidates:T[],readyAt:Map<string,number>,now:number,agingMs:number):T|undefined{
 let best:T|undefined,bestScore=-Infinity;
 for(const task of candidates){
  const score=task.priority+(now-(readyAt.get(task.id)??now))/agingMs;
  if(score>bestScore||(score===bestScore&&best&&task.id<best.id)){best=task;bestScore=score;}
 }
 return best;
}

export class ProjectOrchestrator{
 private runner:TaskRunner;private capacity=new KeyedSemaphore();private budgetGate=new Mutex();private inFlight=new Set<InFlightCost>();
 private retrieval=new Map<string,Promise<ResearchDocument[]>>();private slots=new Signal();private metrics=new RunMetrics();private telemetry:Promise<unknown>=Promise.resolve();private runId="";
 constructor(private selectProvider:ProviderSelector,private state=new CompanyState(),private options:OrchestratorOptions={}){
  this.runner=new TaskRunner(state);
 }
 private now(){return (this.options.now??Date.now)();}
 /** Best-effort structured event; telemetry must never break a run. */
 private emit(projectId:string,type:string,fields:{taskId?:string;profileId?:string;provider?:string;model?:string;detail?:string}={}){
  this.telemetry=this.telemetry.then(()=>this.state.telemetry.append(projectId,{runId:this.runId,type,...fields})).catch(()=>undefined);
 }

 /** Structural validation: unique ids, known dependencies, acyclic graph, reviewers independent of their makers. */
 private validate(plan:ProjectPlanValue){
  const byId=new Map<string,TaskPlanValue>();
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
  return {preferredProvider:target.provider,preferredModel:target.model,policy:target.routing,requireFreeSlot:true,demand:{capabilities:target.capabilities,estimatedInputTokens:target.estimatedInputTokens,estimatedOutputTokens:target.estimatedOutputTokens,maxCost:target.maxCost,minContextWindow:target.minContextWindow,minQualityTier:target.minQualityTier},exclude:exclude.map(item=>({provider:item.profile.provider,model:item.profile.model,profileId:item.profile.id}))};
 }
 private downstream(plan:ProjectPlanValue,taskId:string){return plan.tasks.filter(t=>t.dependencies.includes(taskId)).map(t=>({taskId:t.id,role:t.agentRole}));}
 private slotCount(task:TaskPlanValue){return task.review?Math.max(1,task.review.slots.length):0;}
 private slotConfig(task:TaskPlanValue,slot:number){
  const review=task.review!,configured=review.slots[slot];
  return configured??{lens:undefined,system:review.system,contract:review.contract};
 }
 private reviewTaskId(task:TaskPlanValue,version:number,slot:number){return task.id+"--review-"+version+"-"+slot;}

 /** Derives a task's position from the persisted execution log alone; this is what makes resume deterministic. */
 private history(records:ExecutionRecordValue[],task:TaskPlanValue,plan:ProjectPlanValue){
  const indexed=records.map((record,index)=>({record,index}));
  const makers=indexed.filter(x=>x.record.taskId===task.id&&x.record.status==="SUCCEEDED"),maker=makers.at(-1);
  const reviews=indexed.filter(x=>x.record.taskId.startsWith(task.id+"--review-")&&x.record.status==="SUCCEEDED");
  const since=reviews.filter(x=>maker&&x.index>maker.index).map(x=>x.record);
  const slots=this.slotCount(task),verdictBySlot=new Map<number,"PASS"|"CHANGES_REQUIRED">();
  for(const r of since)verdictBySlot.set(r.slot??0,parseReviewVerdict(r.output)??"CHANGES_REQUIRED");
  const reviewed=slots>0&&[...Array(slots).keys()].every(k=>verdictBySlot.has(k));
  const verdicts=[...verdictBySlot.values()],allPass=reviewed&&verdicts.every(v=>v==="PASS"),anyChanges=verdicts.includes("CHANGES_REQUIRED");
  const checksGate=Boolean(task.review?.gates.includes("checks")&&plan.workspace&&task.requiredGates.length);
  const gatesOk=!checksGate||Boolean(maker&&(maker.record.evidence.length>0||maker.record.gates.some(g=>g.status==="PASS")));
  return {
   maker:maker?.record,makerVersions:makers.length,reviewsTotal:reviews.length,since,
   missingSlots:[...Array(slots).keys()].filter(k=>!verdictBySlot.has(k)),
   disagreement:verdicts.includes("PASS")&&anyChanges,
   complete:Boolean(maker&&(!task.review||(allPass&&gatesOk))),
   needsRevision:Boolean(task.review&&maker&&reviewed&&anyChanges),
   gatesFailed:Boolean(maker&&task.review&&allPass&&!gatesOk)
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
 private upstreamOf(plan:ProjectPlanValue,task:TaskPlanValue,records:ExecutionRecordValue[]):Upstream[]{
  return task.dependencies.map(dep=>{
  const record=records.filter(r=>r.taskId===dep&&r.status==="SUCCEEDED").at(-1);
  const evidence=record?[...record.evidence,...record.gates.map(g=>"gate "+g.name+": "+g.status)].join("\n"):"";
  return {task:plan.tasks.find(t=>t.id===dep)!,output:this.latestOutput(records,dep),evidence:evidence||undefined};
 });
 }
 private refs(manifest:ContextEntry[]){return manifest.map(e=>e.ref+"["+e.sections.join(",")+"]");}
 private async validationContext(plan:ProjectPlanValue,contract:{validators?:string[]}){
  return contract.validators?.includes("qa-traceability")?{requirementIds:await this.state.traceability.requirementIds(plan.projectId)}:undefined;
 }
 /** Documents retrieved once per project run for research tasks; absent when research is off or no connector is configured. */
 private retrieved(plan:ProjectPlanValue,task:TaskPlanValue){
  if(!plan.research.enabled||!plan.research.connectors.length||!task.contract.validators.includes("research-evidence"))return Promise.resolve([] as ResearchDocument[]);
  const key=plan.projectId+"/"+task.id;
  if(!this.retrieval.has(key)){
   const registry=this.options.connectors??defaultConnectorRegistry();
   const queries=[task.prompt.split("\n")[0].slice(0,300),...plan.signals];
   this.retrieval.set(key,gatherResearch(plan.research.connectors.map(c=>registry.create(c)),queries).then(async docs=>{
    await this.state.research.saveRetrieval(plan.projectId,task.id,docs);
    this.emit(plan.projectId,"research.retrieved",{taskId:task.id,detail:docs.length+" document(s)"});
    return docs;
   }));
  }
  return this.retrieval.get(key)!;
 }
 private async makerRun(plan:ProjectPlanValue,task:TaskPlanValue,prompt:string,manifest:ContextEntry[],inputRefs=task.inputRefs):Promise<RunTask>{
  const documents=await this.retrieved(plan,task),withSources=documents.length?prompt+"\n\n"+renderRetrieved(documents):prompt;
  const base=await this.makerRunBase(plan,task,withSources,manifest,inputRefs);
  return documents.length?{...base,retrieved:documents.map(d=>({url:d.url,title:d.title,retrieved:d.retrieved,authority:d.authority,published:d.published})),validationContext:{...base.validationContext,retrievedUrls:documents.map(d=>d.url)}}:base;
 }
 private async makerRunBase(plan:ProjectPlanValue,task:TaskPlanValue,prompt:string,manifest:ContextEntry[],inputRefs=task.inputRefs):Promise<RunTask>{
  // Isolated work starts from the repository state the model is shown now, so a later integration detects overlapping edits.
  const baseSha=plan.workspace?.isolation==="worktree"?(await new LocalRepoWorkspace(plan.workspace.path).git(["rev-parse","HEAD"])).stdout.trim():undefined;
  return {baseSha,projectId:plan.projectId,taskId:task.id,agentRole:task.agentRole,department:task.department,kind:"maker",produces:task.produces,requiredGates:task.requiredGates,inputRefs,system:task.system,prompt,maxTokens:task.maxTokens,contract:task.contract,validationContext:await this.validationContext(plan,task.contract),contextRefs:this.refs(manifest),workspace:plan.workspace,handoffTo:this.downstream(plan,task.id)};
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

 /** One model run with failover, backpressure and cooldown waits. Returns the SUCCEEDED record, or why the task cannot proceed right now. */
 private async execute(plan:ProjectPlanValue,target:SelectionFields,task:RunTask,approvalKey:string,counters:Counters):Promise<ExecutionRecordValue|Pause>{
  const pending=this.unfinalized(await this.state.executions.list(plan.projectId),task.taskId);
  if(pending)return this.runner.finalize(task,pending);
  const tried:ProviderSelection[]=[],maxAttempts=this.options.maxProviderAttempts??DEFAULT_PROVIDER_ATTEMPTS,maxWait=this.options.maxCooldownWaitMs??DEFAULT_COOLDOWN_WAIT_MS;
  let waitedMs=0,failures=0;const everTried=new Set<string>();
  for(;;){
   let selection:ProviderSelection;
   try{selection=this.selectProvider(this.requestFor(target,tried));}
   catch(error){
    if(!(error instanceof CapacityUnavailableError))throw error;
    if(error.reason==="BUSY"){
     // Backpressure: every eligible provider is at its concurrency limit. Resume the moment any run finishes.
     this.metrics.capacityWaits++;this.emit(plan.projectId,"provider.waiting",{taskId:task.taskId,detail:"busy"});
     await this.slots.wait();continue;
    }
    if(error.reason==="COOLDOWN"&&error.retryAt!=null){
     const ms=Math.max(1,error.retryAt-this.now());
     if(waitedMs+ms<=maxWait){waitedMs+=ms;this.metrics.capacityWaits++;this.emit(plan.projectId,"provider.waiting",{taskId:task.taskId,detail:"cooldown "+ms+"ms"});await this.slots.wait(ms+5);continue;}
    }
    // Every profile we already tried may merely be cooling down: forget the exclusions once and let the selector say when.
    if(error.reason==="NONE"&&tried.length){tried.length=0;continue;}
    await this.runner.pauseCapacity(task,error.message);this.emit(plan.projectId,"task.paused",{taskId:task.taskId,detail:error.message});return "PAUSED";
   }
   let admission;
   try{admission=await this.admit(plan,task,approvalKey,selection);}
   catch(error){this.selectProvider.release?.(selection);this.slots.notify();throw error;}
   if("approval" in admission){
    this.selectProvider.release?.(selection);this.slots.notify();
    const needed=admission.approval.estimatedCost;
    await this.state.approvals.request(plan.projectId,approvalKey,needed);
    await this.state.memory.recordStatus(plan.projectId,approvalKey,"APPROVAL_REQUIRED",admission.approval.message);
    this.emit(plan.projectId,"approval.required",{taskId:approvalKey,detail:admission.approval.message});
    if(await this.waitForApproval(plan.projectId,approvalKey,needed))continue;
    return "APPROVAL_REQUIRED";
   }
   const profileId=selection.profile.id??selection.profile.provider+"/"+selection.profile.model;
   // The same profile again after a failure is a retry (it recovered from its cooldown); a different one is a failover.
   if(everTried.has(profileId))this.emit(plan.projectId,"provider.retry",{taskId:task.taskId,profileId});
   everTried.add(profileId);
   const priced={...task,profileId,billing:selection.profile.billing??"metered",estimatedCost:selection.estimatedCost,inputCostPerMillion:selection.profile.inputCostPerMillion,outputCostPerMillion:selection.profile.outputCostPerMillion};
   this.emit(plan.projectId,"provider.selected",{taskId:task.taskId,profileId,provider:selection.provider.name,model:selection.provider.model,detail:selection.policy});
   if(selection.qualityShortfall){this.emit(plan.projectId,"provider.quality-shortfall",{taskId:task.taskId,profileId,detail:"no profile met the requested quality tier; routed to the best available"});await this.state.memory.recordStatus(plan.projectId,task.taskId,"QUALITY_SHORTFALL","routed to "+profileId+" below the requested quality tier ("+(target.minQualityTier??"n/a")+")");}
   const began=this.now();
   try{
    const result=await this.capacity.use(profileId,selection.profile.maxConcurrency,()=>this.runner.run(priced,selection.provider));
    this.metrics.providerRun(profileId,selection.profile.maxConcurrency,this.now()-began);
    this.metrics.usage(result.inputTokens,result.outputTokens,result.actualCost,result.billing==="subscription");
    this.selectProvider.reportSuccess?.(selection,{inputTokens:result.inputTokens,outputTokens:result.outputTokens,actualCost:result.actualCost,latencyMs:this.now()-began});
    return result;
   }catch(error){
    this.metrics.providerRun(profileId,selection.profile.maxConcurrency,this.now()-began);
    if(!isProviderFailure(error)){this.selectProvider.release?.(selection);throw error;}
    this.selectProvider.reportFailure?.(selection,error);tried.push(selection);failures++;counters.failovers++;this.metrics.failovers++;this.metrics.retries++;
    this.emit(plan.projectId,"provider.failover",{taskId:task.taskId,profileId,detail:redactError(error)});
    if(failures>=maxAttempts)throw new Error("Giving up after "+failures+" provider failures: "+redactError(error));
   }finally{this.inFlight.delete(admission.reservation);this.slots.notify();}
  }
 }

 /**
  * A maker step. When isolated work conflicts with something another task already integrated, the model is asked once more
  * against the new state of the repository (its first answer is kept in the log; nothing was merged).
  */
 private async executeMaker(plan:ProjectPlanValue,task:TaskPlanValue,prompt:string,manifest:ContextEntry[],inputRefs:string[],counters:Counters){
  let attemptPrompt=prompt,conflicts=0,repairs=0;
  for(;;){
   try{return await this.execute(plan,task,await this.makerRun(plan,task,attemptPrompt,manifest,inputRefs),task.id,counters);}
   catch(error){
    if(!(error instanceof WorkspaceError))throw error;
    if(error.code==="GIT_CONFLICT"&&conflicts<(this.options.maxConflictRetries??1)){
     conflicts++;
     this.emit(plan.projectId,"integration.conflict",{taskId:task.id,detail:error.evidence.join("; ")});
     await this.state.memory.recordStatus(plan.projectId,task.id,"INTEGRATION_CONFLICT",error.evidence.join("; "));
     attemptPrompt=prompt+"\n\n--- INTEGRATION CONFLICT ---\nYour previous change could not be merged because other tasks changed the same code ("+error.evidence.join("; ")+"). Their work is now in the repository. Produce your change again against the current repository state, keeping their changes.";
     continue;
    }
    if((error.code==="CHECK_FAILED"||error.code==="INTEGRATION_FAILED")&&repairs<(this.options.maxGateRepairs??2)){
     repairs++;this.metrics.retries++;
     const previous=(await this.state.executions.list(plan.projectId)).filter(r=>r.taskId===task.id&&r.status==="FAILED"&&r.output).at(-1)?.output??"";
     this.emit(plan.projectId,"gate.repair",{taskId:task.id,detail:error.message});
     await this.state.memory.recordStatus(plan.projectId,task.id,"GATE_REPAIR","attempt "+repairs+": "+error.message.slice(0,300));
     attemptPrompt=prompt+"\n\n--- YOUR PREVIOUS ATTEMPT FAILED ITS DETERMINISTIC GATES ---\n"+error.evidence.join("\n")+"\n\n--- YOUR PREVIOUS ATTEMPT ---\n"+previous.slice(0,12000)+"\n\nFix the cause of the failure and emit the complete corrected files. Do not weaken or skip any check.";
     continue;
    }
    throw error;
   }
  }
 }

 /** Advances one task from whatever state the log says it is in until it is done, parked or failed. */
 private async advance(plan:ProjectPlanValue,task:TaskPlanValue,counters:Counters):Promise<"DONE"|Pause>{
  for(;;){
   const records=await this.state.executions.list(plan.projectId),state=this.history(records,task,plan);
   if(state.complete)return "DONE";
   if(!state.maker){
    const built=makerContext(task,this.upstreamOf(plan,task,records),this.options.maxUpstreamChars??DEFAULT_UPSTREAM_CHARS);
    const result=await this.executeMaker(plan,task,built.prompt,built.manifest,task.inputRefs,counters);
    if(typeof result==="string")return result;
    continue;
   }
   const review=task.review;if(!review)return "DONE";
   if(state.gatesFailed)throw new GateError("Review passed but required deterministic gates are not satisfied for "+task.id+": no passing check evidence was recorded");
   const slots=this.slotCount(task),rounds=Math.ceil(state.reviewsTotal/slots);
   if(state.needsRevision){
    if(rounds>=review.maxRounds)throw new ReviewExhaustedError(task.id,review.maxRounds);
    counters.revisions++;
    if(state.disagreement){counters.disagreements++;this.emit(plan.projectId,"review.disagreement",{taskId:task.id,detail:"reviewers split; the revision reconciles every finding"});await this.state.memory.recordStatus(plan.projectId,task.id,"REVIEWER_DISAGREEMENT","reviewers split between PASS and CHANGES_REQUIRED; revising against all findings");}
    const findings=state.since.filter(r=>(parseReviewVerdict(r.output)??"CHANGES_REQUIRED")==="CHANGES_REQUIRED").map((r,i)=>"REVIEWER FINDINGS "+(i+1)+":\n"+r.output).join("\n\n");
    const built=makerContext(task,this.upstreamOf(plan,task,records),this.options.maxUpstreamChars??DEFAULT_UPSTREAM_CHARS);
    const prompt=built.prompt+"\n\n--- PREVIOUS OUTPUT ---\n"+state.maker.output+"\n\n--- REVIEW FEEDBACK ---\n"+findings+(state.disagreement?"\n\nThe reviewers disagreed. Address every CHANGES_REQUIRED finding; if you reject one, say why under ## Decisions.":"")+"\n\nRevise the work to address every required change.";
    const result=await this.executeMaker(plan,task,prompt,built.manifest,[...task.inputRefs,"execution:"+state.since.at(-1)!.taskId],counters);
    if(typeof result==="string")return result;
    continue;
   }
   if(rounds>=review.maxRounds&&state.missingSlots.length===slots&&state.reviewsTotal>=review.maxRounds*slots)throw new ReviewExhaustedError(task.id,review.maxRounds);
   // Independent reviews: one fresh context per slot, run side by side. Each sees only its own earlier findings.
   const upstream=this.upstreamOf(plan,task,records),version=state.makerVersions;
   const runs=state.missingSlots.map(slot=>async()=>{
    const config=this.slotConfig(task,slot),previous=records.filter(r=>r.taskId.startsWith(task.id+"--review-")&&(r.slot??0)===slot&&r.status==="SUCCEEDED").at(-1)?.output;
    const built=reviewContext({task,maker:state.maker!,upstream,limit:this.options.maxUpstreamChars??DEFAULT_UPSTREAM_CHARS,artifactLimit:this.options.maxReviewArtifactChars??DEFAULT_REVIEW_ARTIFACT_CHARS,slot,slots,previousFindings:previous});
    const run:RunTask={projectId:plan.projectId,taskId:this.reviewTaskId(task,version,slot),agentRole:review.role,department:review.department,kind:"review",reviewedTaskId:task.id,slot,inputRefs:[...task.inputRefs,"execution:"+task.id],system:config.system,prompt:built.prompt,maxTokens:review.maxTokens,contract:config.contract,contextRefs:this.refs(built.manifest)};
    return this.execute(plan,review,run,task.id,counters);
   });
   const settled=await Promise.allSettled(runs.map(start=>start()));
   const failure=settled.find((x):x is PromiseRejectedResult=>x.status==="rejected");
   const parked=settled.find(x=>x.status==="fulfilled"&&typeof x.value==="string") as PromiseFulfilledResult<Pause>|undefined;
   counters.reviewRuns+=settled.filter(x=>x.status==="fulfilled"&&typeof x.value!=="string").length;
   if(failure)throw failure.reason;
   if(parked)return parked.value;
  }
 }

 private async fail(plan:ProjectPlanValue,task:TaskPlanValue,error:unknown){
  const message=redactError(error),at=new Date().toISOString();
  await this.state.memory.recordStatus(plan.projectId,task.id,"BLOCKED",message);
  await this.state.memory.append(plan.projectId,"BLOCKERS.md","\n## "+task.id+" — run failure\n\n"+message+"\n");
  await this.state.checkpoints.save(plan.projectId,{taskId:task.id,at,status:"BLOCKED",completed:[],remaining:["resolve: "+message.slice(0,200)],artifactRefs:[],decisionRefs:[],compactContext:message,inputTokens:0,outputTokens:0});
  this.emit(plan.projectId,"task.blocked",{taskId:task.id,detail:message});
 }

 async run(input:ProjectPlanInput):Promise<ProjectRunSummary>{
  const plan=ProjectPlan.parse(input);this.validate(plan);
  if(plan.workspace)await new LocalRepoWorkspace(plan.workspace.path).validate({requireGit:plan.workspace.autoCommit});
  await this.state.memory.init(plan);
  // Isolated worktrees left by a crashed run belong to nobody: remove them before starting.
  if(plan.workspace?.isolation==="worktree")await new WorktreeManager(plan.workspace.path,join(this.state.root,"worktrees")).cleanupStale(new Set(),15*60*1000);
  this.runId=randomUUID();this.metrics=new RunMetrics(this.options.now);
  this.emit(plan.projectId,"run.started",{detail:plan.mode});
  const states=new Map<string,string>(),completed=new Set<string>(),paused=new Set<string>(),approvalRequired=new Set<string>(),failed=new Set<string>(),skipped=new Set<string>();
  const pending=new Map(plan.tasks.map(t=>[t.id,t])),counters:Counters={reviewRuns:0,revisions:0,disagreements:0,failovers:0};
  const initialRecords=await this.state.executions.list(plan.projectId);
  for(const task of plan.tasks)if(this.history(initialRecords,task,plan).complete){
   completed.add(task.id);pending.delete(task.id);skipped.add(task.id);states.set(task.id,"DONE");
   await this.state.memory.recordStatus(plan.projectId,task.id,"SKIPPED_ALREADY_COMPLETE");
  }
  const planWrite=new Mutex(),syncPlan=()=>planWrite.run(()=>this.state.memory.syncPlan(plan,states));
  await syncPlan();
  const readyAt=new Map<string,number>(),running=new Map<string,Promise<void>>(),levels=new Map<string,number>();
  const maxParallel=Math.max(1,this.options.maxParallelTasks??DEFAULT_PARALLEL),agingMs=this.options.agingMs??DEFAULT_AGING_MS;
  const level=(task:TaskPlanValue):number=>{
   const known=levels.get(task.id);if(known!=null)return known;
   const value=1+Math.max(0,...task.dependencies.map(dep=>level(plan.tasks.find(t=>t.id===dep)!)));levels.set(task.id,value);return value;
  };
  let waves=0;
  const execute=async(task:TaskPlanValue)=>{
   this.metrics.taskStarted(task.id);this.emit(plan.projectId,"task.started",{taskId:task.id});
   let outcome:TaskOutcome;
   try{
    const result=await this.advance(plan,task,counters);
    if(result==="DONE"){
     outcome="DONE";completed.add(task.id);states.set(task.id,"DONE");waves=Math.max(waves,level(task));
     await this.state.memory.recordStatus(plan.projectId,task.id,"DONE");
     const checkpoint=await this.state.checkpoints.load(plan.projectId,task.id);
     if(checkpoint)await this.state.checkpoints.save(plan.projectId,{...checkpoint,at:new Date().toISOString(),status:"DONE",remaining:[]});
    }else if(result==="PAUSED"){outcome="PAUSED";paused.add(task.id);states.set(task.id,"PAUSED_CAPACITY");}
    else{outcome="APPROVAL_REQUIRED";approvalRequired.add(task.id);states.set(task.id,"APPROVAL_REQUIRED");}
   }catch(error){outcome="FAILED";failed.add(task.id);states.set(task.id,"BLOCKED");await this.fail(plan,task,error);}
   this.metrics.taskFinished(task.id,outcome);this.emit(plan.projectId,"task.finished",{taskId:task.id,detail:outcome});
   await syncPlan();
  };
  // Event-driven DAG scheduler: a task starts the moment its dependencies are done and a project slot is free.
  await new Promise<void>(resolve=>{
   const tick=()=>{
    while(running.size<maxParallel){
     const ready=[...pending.values()].filter(t=>t.dependencies.every(dep=>completed.has(dep)));
     for(const task of ready)if(!readyAt.has(task.id)){readyAt.set(task.id,this.now());this.metrics.taskReady(task.id);}
     const next=pickNext(ready,readyAt,this.now(),agingMs);
     if(!next)break;
     pending.delete(next.id);
     const job=execute(next).catch(()=>undefined).finally(()=>{running.delete(next.id);this.slots.notify();tick();});
     running.set(next.id,job);
    }
    if(running.size===0)resolve();
   };
   tick();
  });
  const waiting=[...pending.keys()];
  for(const id of waiting)states.set(id,"WAITING");
  await syncPlan();
  const budget=budgetReport(plan.budget,await this.state.executions.list(plan.projectId));
  this.emit(plan.projectId,"run.finished",{detail:failed.size?"failed":paused.size||approvalRequired.size||waiting.length?"parked":"done"});
  await this.telemetry;
  return {projectId:plan.projectId,runId:this.runId,completed:[...completed],paused:[...paused],approvalRequired:[...approvalRequired],failed:[...failed],waiting,skipped:[...skipped],waves,...counters,budget,metrics:this.metrics.snapshot()};
 }
}

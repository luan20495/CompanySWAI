import {execFile} from "node:child_process";
import {readdir} from "node:fs/promises";
import {join} from "node:path";
import {promisify} from "node:util";
import {SafeId} from "./ids.js";
import type {CompanyState} from "./state.js";
import type {ExecutionRecordValue} from "./execution-record.js";
import type {ProjectPlanValue,TaskPlanValue} from "./project.js";
import type {RunStateValue} from "./run-store.js";
import type {ReworkRequest} from "./rework-store.js";
import {taskHistory} from "./orchestrator.js";
import {parseReviewVerdict} from "./output-parser.js";
import {buildProjectStatus,type ProjectStatus,type TelemetryEvent} from "./telemetry.js";
import {PROJECT_APPROVAL_KEY} from "./autonomous.js";
import {redact} from "./secrets.js";

/**
 * Read model for the human-facing operator interface (Claude Code or a person at a terminal). It derives everything from the
 * persisted sources of truth — execution log, run state, plan, telemetry, checkpoints, approvals, artifact/handoff/review/
 * blocker stores and traceability — and stores nothing of its own. "Done" is the engine's own `taskHistory`, so what the
 * operator reports can never disagree with what the scheduler would do.
 */
export type OperatorErrorCode="INVALID_PROJECT_ID"|"UNKNOWN_PROJECT"|"AMBIGUOUS_PROJECT"|"NO_PROJECTS"|"NO_PLAN"|"UNKNOWN_TASK"|"UNKNOWN_AGENT"|"UNSUPPORTED"|"CONFLICT"|"USAGE";
export class OperatorError extends Error{
 constructor(readonly code:OperatorErrorCode,message:string,readonly candidates:string[]=[]){super(message);this.name="OperatorError";}
}

export type TaskState="DONE"|"RUNNING"|"BLOCKED"|"PAUSED"|"AWAITING_APPROVAL"|"WAITING"|"READY"|"INTERRUPTED";
export type TaskView={
 id:string;agentRole:string;department:string;title:string;state:TaskState;
 /** Where the task is in its own life cycle: implement, review, revision, qa-rework, gates, done. */
 stage:string;reason?:string;dependencies:string[];waitingOn:Array<{taskId:string;state:TaskState}>;produces:string[];
 reviewRole?:string;reviewLevel?:string;makerVersions:number;
 /** Distinct maker executions (model calls for the work itself) and distinct reviewer executions. */
 attempts:number;reviewRuns:number;
 reviewVerdicts:Array<{slot:number;verdict:string}>;
 running?:{role:string;step:string;provider:string;model:string;since:string;elapsedMs:number};
 lastActivityAt?:string;
};
export type ProjectModel={
 projectId:string;plan?:ProjectPlanValue;run?:RunStateValue;live:ProjectStatus;records:ExecutionRecordValue[];events:TelemetryEvent[];rework:ReworkRequest[];
 tasks:TaskView[];now:number;corruptLogLines:number;projectApprovalPending:boolean;
};

const clip=(text:string,limit:number)=>text.length>limit?text.slice(0,limit-1)+"…":text;
const oneLine=(text:string)=>text.replace(/\s+/g," ").trim();
const isReview=(taskId:string)=>/--review-/.test(taskId);
const reviewedOf=(taskId:string)=>taskId.replace(/--review-.*$/,"");
const stamp=(r:ExecutionRecordValue)=>r.finishedAt??r.startedAt;
/** First line of substance in a review body: past the verdict line and any headings. */
const gist=(body:string)=>clip(redact(oneLine(body.split("\n").find(l=>l.trim()&&!/^(PASS|CHANGES_REQUIRED)$/.test(l.trim())&&!l.trim().startsWith("#"))??"")),120);

async function names(dir:string){
 try{return await readdir(dir);}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return [];throw error;}
}

/** Known projects: anything with a run state, an execution log or a memory directory under the state root. */
export async function listProjectIds(state:CompanyState){
 const ids=new Set<string>(),add=(name:string)=>{if(SafeId.safeParse(name).success)ids.add(name);};
 for(const file of await names(join(state.root,"runs")))if(file.endsWith(".json")&&!file.endsWith(".plan.json"))add(file.slice(0,-".json".length));
 for(const dir of await names(join(state.root,"executions")))add(dir);
 for(const dir of await names(join(state.root,"projects")))add(dir);
 return [...ids].sort();
}

/**
 * Which project a command means. An explicit id must exist. Without one, a single known project is unambiguous; several
 * are not, and the operator must say which — it never guesses, and nothing is remembered between commands.
 */
export async function resolveProject(state:CompanyState,requested?:string):Promise<{projectId:string;implicit:boolean}>{
 const ids=await listProjectIds(state);
 if(requested!==undefined){
  if(!SafeId.safeParse(requested).success)throw new OperatorError("INVALID_PROJECT_ID","Invalid project id '"+clip(requested,60)+"': IDs may contain only letters, numbers, dot, underscore and dash.");
  if(!ids.includes(requested))throw new OperatorError("UNKNOWN_PROJECT","Unknown project '"+requested+"'."+(ids.length?" Known projects: "+ids.join(", ")+".":" No projects exist under "+state.root+"."),ids);
  return {projectId:requested,implicit:false};
 }
 if(ids.length===0)throw new OperatorError("NO_PROJECTS","No projects exist under "+state.root+". Start one with `npm run company -- <brief.json>`.");
 if(ids.length>1)throw new OperatorError("AMBIGUOUS_PROJECT","Several projects exist; say which one: "+ids.join(", ")+".",ids);
 return {projectId:ids[0],implicit:true};
}

export type LoadOptions={now?:number;isAlive?:(pid:number)=>boolean};

/** Everything about one project, with every task classified. Read-only: no engine, provider or workspace is touched. */
export async function loadProjectModel(state:CompanyState,projectId:string,options:LoadOptions={}):Promise<ProjectModel>{
 const now=options.now??Date.now();
 const [events,records,run,plan,rework]=await Promise.all([state.telemetry.list(projectId),state.executions.list(projectId),state.runs.load(projectId),state.runs.loadPlan(projectId),state.rework.list(projectId)]);
 const live=buildProjectStatus(projectId,events,records,{now,planTasks:plan?.tasks.map(t=>t.id),isAlive:options.isAlive});
 const [corruptLogLines,request,granted]=await Promise.all([state.executions.corruptLines(projectId),state.approvals.loadRequest(projectId,PROJECT_APPROVAL_KEY),state.approvals.load(projectId,PROJECT_APPROVAL_KEY)]);
 const model:ProjectModel={projectId,plan,run,live,records,events,rework,tasks:[],now,corruptLogLines,projectApprovalPending:Boolean(request&&request.status==="PENDING"&&!granted)};
 if(plan)model.tasks=await classifyTasks(state,model,plan);
 return model;
}

/** Records still in flight: started (or checkpointed) and never finalized or failed. */
function inFlight(records:ExecutionRecordValue[]){
 const terminal=new Set(records.filter(r=>r.status==="SUCCEEDED"||r.status==="FAILED"||r.status==="PAUSED_CAPACITY").map(r=>r.id));
 const latest=new Map<string,ExecutionRecordValue>();
 for(const r of records)if(!terminal.has(r.id)&&(r.status==="STARTED"||r.status==="CHECKPOINTED"))latest.set(r.id,r);
 return [...latest.values()];
}

async function classifyTasks(state:CompanyState,model:ProjectModel,plan:ProjectPlanValue):Promise<TaskView[]>{
 const {records,rework,live,now}=model,byId=new Map(plan.tasks.map(t=>[t.id,t]));
 const history=new Map(plan.tasks.map(t=>[t.id,taskHistory(records,t,plan,rework)]));
 const flight=inFlight(records);
 const extras=new Map<string,{checkpoint?:Awaited<ReturnType<typeof state.checkpoints.load>>;approvalPending:boolean}>();
 for(const t of plan.tasks){
  const [checkpoint,request,granted]=await Promise.all([state.checkpoints.load(model.projectId,t.id),state.approvals.loadRequest(model.projectId,t.id),state.approvals.load(model.projectId,t.id)]);
  extras.set(t.id,{checkpoint,approvalPending:Boolean(request&&request.status==="PENDING"&&!granted)});
 }
 const views=new Map<string,TaskView>(),visiting=new Set<string>();
 const build=(task:TaskPlanValue):TaskView=>{
  const known=views.get(task.id);if(known)return known;
  const hist=history.get(task.id)!,extra=extras.get(task.id)!;
  const own=records.filter(r=>r.taskId===task.id||r.taskId.startsWith(task.id+"--review-"));
  const flying=flight.filter(r=>r.taskId===task.id||r.taskId.startsWith(task.id+"--review-")).at(-1);
  const liveRun=live.state==="RUNNING"?live.running.find(r=>r.taskId===task.id):undefined;
  visiting.add(task.id);
  const unmet=task.dependencies.filter(dep=>!history.get(dep)?.complete);
  const waitingOn=unmet.map(dep=>({taskId:dep,state:visiting.has(dep)||!byId.has(dep)?"WAITING" as TaskState:build(byId.get(dep)!).state}));
  visiting.delete(task.id);
  const stage=!hist.maker?"implement":hist.complete?"done":hist.pendingRequest?"qa-rework":hist.needsRevision?"revision":hist.gatesFailed?"gates":hist.missingSlots.length?"review":"gates";
  let state_:TaskState,reason:string|undefined;
  const checkpoint=extra.checkpoint;
  if(hist.complete)state_="DONE";
  else if(liveRun){state_="RUNNING";}
  else if(checkpoint?.status==="BLOCKED"||live.failed.includes(task.id)){state_="BLOCKED";reason=redact(oneLine(checkpoint?.compactContext??live.blockers.find(b=>b.startsWith(task.id+":"))??"the last attempt failed"));}
  else if(extra.approvalPending){state_="AWAITING_APPROVAL";reason="a cost approval is pending (npm run approve -- "+model.projectId+" "+task.id+")";}
  else if(checkpoint?.status==="PAUSED_CAPACITY"){state_="PAUSED";reason="waiting for provider capacity";}
  else if(unmet.length){state_="WAITING";reason="waiting for "+waitingOn.map(w=>w.taskId+" ("+w.state+")").join(", ");}
  else if(flying&&live.state==="INTERRUPTED"){state_="INTERRUPTED";reason="the engine stopped mid-step; resume continues from the execution log";}
  else state_="READY";
  const running=state_==="RUNNING"?(()=>{
   const since=flying?.startedAt??new Date(now-(liveRun?.elapsedMs??0)).toISOString();
   const step=flying&&isReview(flying.taskId)?"review (slot "+(flying.slot??0)+")":hist.makerVersions>0?(hist.pendingRequest?"qa-rework":hist.needsRevision?"revision":"maker rerun"):"implementing";
   return {role:flying?.agentRole||liveRun?.agentRole||task.agentRole,step,provider:flying?.provider??liveRun?.provider??"",model:flying?.model??"",since,elapsedMs:Math.max(0,now-Date.parse(since))};
  })():undefined;
  const last=own.map(stamp).sort().at(-1);
  const view:TaskView={
   id:task.id,agentRole:task.agentRole,department:task.department,title:clip(oneLine(task.prompt.split("\n").find(l=>l.trim())??task.id),72),state:state_,stage,reason,dependencies:task.dependencies,waitingOn,produces:task.produces,
   reviewRole:task.review?.role,reviewLevel:task.review?.level,makerVersions:hist.makerVersions,attempts:new Set(own.filter(r=>r.taskId===task.id).map(r=>r.id)).size,reviewRuns:new Set(own.filter(r=>r.taskId!==task.id).map(r=>r.id)).size,
   reviewVerdicts:[...new Map(hist.since.map(r=>[r.slot??0,{slot:r.slot??0,verdict:parseReviewVerdict(r.output)??"CHANGES_REQUIRED"}])).values()],running,lastActivityAt:last
  };
  views.set(task.id,view);return view;
 };
 return plan.tasks.map(build);
}

export function counts(tasks:TaskView[]){
 const out:Record<TaskState,number>={DONE:0,RUNNING:0,BLOCKED:0,PAUSED:0,AWAITING_APPROVAL:0,WAITING:0,READY:0,INTERRUPTED:0};
 for(const t of tasks)out[t.state]++;
 return out;
}

/**
 * Rough remaining time: the critical path through tasks that are not done, using the per-step seconds the ESTIMATE phase stored.
 * It is an ESTIMATE at planned provider speed (no queueing, retries or rework) and is withheld when any needed figure is unknown.
 */
export function remainingEstimateSeconds(model:ProjectModel):number|undefined{
 const estimate=model.run?.estimate as {tasks?:Array<{taskId:string;seconds?:number}>;reviews?:Array<{taskId:string;seconds?:number}>}|undefined,plan=model.plan;
 if(!estimate?.tasks||!plan)return undefined;
 const open=new Map(model.tasks.filter(t=>t.state!=="DONE").map(t=>[t.id,t]));
 if(!open.size)return 0;
 const seconds=new Map(estimate.tasks.map(t=>[t.taskId,t.seconds]));
 let unknown=false;const memo=new Map<string,number>();
 const path=(id:string):number=>{
  const known=memo.get(id);if(known!==undefined)return known;
  const task=plan.tasks.find(t=>t.id===id)!,own=seconds.get(id);
  if(own==null)unknown=true;
  const review=Math.max(0,...(estimate.reviews??[]).filter(r=>r.taskId.startsWith(id+"--review-")).map(r=>r.seconds??0));
  memo.set(id,0);
  const value=(own??0)+review+Math.max(0,...task.dependencies.filter(d=>open.has(d)).map(path));
  memo.set(id,value);return value;
 };
 const total=Math.max(0,...[...open.keys()].map(path));
 return unknown?undefined:Math.round(total);
}

// ------------------------------------------------------------------ views

export type StatusView={
 projectId:string;engine:{state:ProjectStatus["state"];pid?:number;runId?:string;elapsedMs?:number};phase?:string;stopped?:string;
 final?:RunStateValue["final"];tasks:{total:number;done:number;counts:Record<TaskState,number>};
 /** Never a percentage: tasks differ in size, so only counts and measured durations are reported. */
 progress:string;
 running:TaskView[];waiting:TaskView[];blocked:TaskView[];ready:TaskView[];next:string[];
 etaSecondsEstimate?:number;usage:ProjectStatus["usage"];notes:string[];corruptLogLines:number;projectApprovalPending:boolean;hasPlan:boolean;
};
export function statusView(model:ProjectModel):StatusView{
 const c=counts(model.tasks),total=model.tasks.length;
 const blocked=model.tasks.filter(t=>["BLOCKED","PAUSED","AWAITING_APPROVAL","INTERRUPTED"].includes(t.state));
 const ready=model.tasks.filter(t=>t.state==="READY");
 const next=[
  ...(model.projectApprovalPending?["approve the project estimate: npm run approve -- "+model.projectId+" "+PROJECT_APPROVAL_KEY]:[]),
  ...blocked.map(t=>"unblock "+t.id+" ("+t.state.toLowerCase().replace("_"," ")+")"),
  ...ready.map(t=>(t.stage==="implement"?"run ":t.stage+" ")+t.id),
  ...model.tasks.filter(t=>t.state==="WAITING").map(t=>"run "+t.id+" after "+t.waitingOn.map(w=>w.taskId).join(","))
 ];
 return {
  projectId:model.projectId,engine:{state:model.live.state,pid:model.live.pid,runId:model.live.runId,elapsedMs:model.live.elapsedMs},phase:model.run?.phase,stopped:model.run?.stopped,final:model.run?.final,
  tasks:{total,done:c.DONE,counts:c},progress:total?c.DONE+"/"+total+" tasks done":"no plan persisted",
  running:model.tasks.filter(t=>t.state==="RUNNING"),waiting:model.tasks.filter(t=>t.state==="WAITING"),blocked,ready,next,
  etaSecondsEstimate:remainingEstimateSeconds(model),usage:model.live.usage,notes:model.run?.notes??[],corruptLogLines:model.corruptLogLines,projectApprovalPending:model.projectApprovalPending,hasPlan:Boolean(model.plan)
 };
}

export async function projectSummaries(state:CompanyState,options:LoadOptions={}){
 const out=[];
 for(const id of await listProjectIds(state)){
  const model=await loadProjectModel(state,id,options),c=counts(model.tasks);
  out.push({projectId:id,engine:model.live.state,phase:model.run?.phase,final:model.run?.final?.status,done:c.DONE,total:model.tasks.length,running:c.RUNNING});
 }
 return out;
}

export type AgentView={
 role:string;state:"RUNNING"|"BLOCKED"|"WAITING"|"DONE"|"IDLE";
 assignments:Array<{taskId:string;kind:"maker"|"review";state:TaskState;step?:string}>;
 current?:{taskId:string;step:string;provider:string;model:string;elapsedMs:number};
 waitingFor:string[];outputs:string[];pendingHandoffsIn:Array<{fromTask:string;fromRole:string;forTask:string}>;lastActivityAt?:string;
};
export async function agentsView(state:CompanyState,model:ProjectModel):Promise<AgentView[]>{
 const plan=model.plan;if(!plan)return [];
 const handoffs=await state.handoffs.list(model.projectId),byId=new Map(model.tasks.map(t=>[t.id,t]));
 const flight=inFlight(model.records),roles=new Set<string>();
 for(const t of plan.tasks){roles.add(t.agentRole);if(t.review)roles.add(t.review.role);}
 const views:AgentView[]=[];
 for(const role of [...roles].sort()){
  const assignments:AgentView["assignments"]=[];
  for(const t of plan.tasks){
   const v=byId.get(t.id)!;
   if(t.agentRole===role){
    // While a reviewer works on this task the maker is idle (its output is under review): it is not "running".
    const underReview=v.state==="RUNNING"&&v.running!==undefined&&v.running.role!==role;
    assignments.push({taskId:t.id,kind:"maker",state:underReview?"WAITING":v.state,step:underReview?"under review by "+v.running!.role:v.running&&v.running.role===role?v.running.step:undefined});
   }
   if(t.review?.role===role){
    const reviewing=flight.some(r=>isReview(r.taskId)&&reviewedOf(r.taskId)===t.id&&r.agentRole===role)&&v.state==="RUNNING";
    assignments.push({taskId:t.id,kind:"review",state:v.state==="DONE"?"DONE":reviewing?"RUNNING":v.stage==="review"&&v.state==="READY"?"READY":"WAITING",step:reviewing?"review":undefined});
   }
  }
  const running=assignments.find(a=>a.state==="RUNNING"&&byId.get(a.taskId)?.running?.role===role);
  const state_:AgentView["state"]=running?"RUNNING":assignments.some(a=>["BLOCKED","PAUSED","AWAITING_APPROVAL","INTERRUPTED"].includes(a.state))?"BLOCKED":assignments.some(a=>a.state!=="DONE")?"WAITING":assignments.length?"DONE":"IDLE";
  const mine=model.records.filter(r=>r.agentRole===role),done=mine.filter(r=>r.status==="SUCCEEDED");
  const pending=handoffs.filter(h=>h.toRole===role).flatMap(h=>plan.tasks.filter(t=>t.agentRole===role&&t.dependencies.includes(h.taskId)&&byId.get(t.id)?.state!=="DONE").map(t=>({fromTask:h.taskId,fromRole:h.fromRole,forTask:t.id})));
  const dedupe=new Map(pending.map(p=>[p.fromTask+">"+p.forTask,p]));
  const live=running?byId.get(running.taskId)?.running:undefined;
  views.push({
   role,state:state_,assignments,
   current:running&&live?{taskId:running.taskId,step:live.step,provider:live.provider,model:live.model,elapsedMs:live.elapsedMs}:undefined,
   waitingFor:[...new Set(assignments.filter(a=>a.state==="WAITING"||a.state==="READY").flatMap(a=>a.step?.startsWith("under review")?[a.taskId+" "+a.step]:byId.get(a.taskId)?.waitingOn.map(w=>w.taskId+" ("+w.state+")")??[]))],
   outputs:done.map(r=>r.taskId+(isReview(r.taskId)?"":": "+r.artifactRefs.filter(x=>!x.startsWith("handoff:")&&!x.startsWith("file:")&&!x.startsWith("commit:")).join(","))),
   pendingHandoffsIn:[...dedupe.values()],lastActivityAt:mine.map(stamp).sort().at(-1)
  });
 }
 return views;
}

export function resolveTask(model:ProjectModel,requested:string):TaskView{
 if(!model.plan)throw new OperatorError("NO_PLAN","Project '"+model.projectId+"' has no persisted plan, so tasks cannot be resolved.");
 const direct=model.tasks.find(t=>t.id===requested)??(isReview(requested)?model.tasks.find(t=>t.id===reviewedOf(requested)):undefined);
 if(!direct)throw new OperatorError("UNKNOWN_TASK","Unknown task '"+clip(requested,60)+"' in project '"+model.projectId+"'. Tasks: "+model.tasks.map(t=>t.id).join(", ")+".",model.tasks.map(t=>t.id));
 return direct;
}

export type HandoffView={
 id:string;from:string;to:string;task:string;createdAt:string;summary:string;
 /** `PENDING` until a receiving task has produced anything; `CONSUMED` once the receiver started or finished. */
 status:"PENDING"|"CONSUMED";receivers:Array<{taskId:string;role:string;state:TaskState}>;
 input:string[];output:Array<{ref:string;kind?:string;title?:string}>;decisions:string[];evidence:string[];blockers:string[];nextExpectedAction:string;
};
export async function handoffsView(state:CompanyState,model:ProjectModel):Promise<HandoffView[]>{
 const plan=model.plan,byId=new Map(model.tasks.map(t=>[t.id,t]));
 const [handoffs,decisions,blockers,artifacts]=await Promise.all([state.handoffs.list(model.projectId),state.decisions.list(model.projectId),state.blockers.list(model.projectId),state.artifacts.list(model.projectId)]);
 const out:HandoffView[]=[];
 for(const h of handoffs){
  const receivers=(plan?.tasks??[]).filter(t=>t.dependencies.includes(h.taskId)&&t.agentRole===h.toRole).map(t=>({taskId:t.id,role:t.agentRole,state:byId.get(t.id)!.state}));
  const exec=model.records.find(r=>r.status==="SUCCEEDED"&&r.taskId===h.taskId&&h.refs.some(ref=>r.artifactRefs.includes(ref)));
  const started=receivers.some(r=>model.records.some(x=>x.taskId===r.taskId));
  const next=receivers.find(r=>r.state!=="DONE");
  out.push({
   id:h.id,from:h.fromRole,to:h.toRole,task:h.taskId,createdAt:h.createdAt,summary:redact(h.summary),
   status:started||receivers.every(r=>r.state==="DONE")&&receivers.length>0?"CONSUMED":"PENDING",receivers,
   input:[...(exec?.inputRefs??[]),...(exec?.contextRefs??[])],
   output:h.refs.map(ref=>{const a=artifacts.find(x=>x.id===ref);return {ref,kind:a?.kind,title:a?.title};}),
   decisions:decisions.filter(d=>d.taskId===h.taskId).map(d=>redact(oneLine(d.decision))),
   evidence:[...(exec?.evidence??[]),...(exec?.gates??[]).map(g=>"gate "+g.name+": "+g.status)].map(e=>redact(oneLine(e))),
   blockers:blockers.filter(b=>b.taskId===h.taskId&&b.status==="OPEN").map(b=>redact(oneLine(b.body))),
   nextExpectedAction:next?next.taskId+" ("+next.role+") is "+next.state+(next.state==="WAITING"?": "+byId.get(next.taskId)!.reason:""):receivers.length?"none: every receiving task is done":"no downstream task consumes this handoff"
  });
 }
 return out.sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
}

export type BlockerView={kind:"task-blocked"|"capacity"|"approval"|"interrupted"|"declared"|"waiting"|"project";taskId?:string;agentRole?:string;text:string;since?:string};
export async function blockersView(state:CompanyState,model:ProjectModel):Promise<BlockerView[]>{
 const out:BlockerView[]=[],byId=new Map(model.tasks.map(t=>[t.id,t]));
 if(model.projectApprovalPending)out.push({kind:"project",text:"project cost approval required: npm run approve -- "+model.projectId+" "+PROJECT_APPROVAL_KEY});
 if(model.run?.stopped&&!model.run.stopped.startsWith("stopped by operator"))out.push({kind:"project",text:model.run.stopped});
 for(const t of model.tasks){
  if(t.state==="BLOCKED")out.push({kind:"task-blocked",taskId:t.id,agentRole:t.agentRole,text:t.reason??"blocked"});
  else if(t.state==="PAUSED")out.push({kind:"capacity",taskId:t.id,agentRole:t.agentRole,text:t.reason??"waiting for capacity"});
  else if(t.state==="AWAITING_APPROVAL")out.push({kind:"approval",taskId:t.id,agentRole:t.agentRole,text:t.reason??"approval pending"});
  else if(t.state==="INTERRUPTED")out.push({kind:"interrupted",taskId:t.id,agentRole:t.agentRole,text:t.reason??"interrupted"});
  else if(t.state==="WAITING"&&t.waitingOn.some(w=>w.state!=="WAITING"&&w.state!=="RUNNING"&&w.state!=="READY"))out.push({kind:"waiting",taskId:t.id,agentRole:t.agentRole,text:t.reason??"waiting"});
 }
 for(const b of await state.blockers.list(model.projectId)){
  const owner=byId.get(b.taskId);
  // A blocker an agent declared is history once that task finished and was accepted; only open ones on unfinished work are live.
  if(b.status==="OPEN"&&owner&&owner.state!=="DONE")out.push({kind:"declared",taskId:b.taskId,agentRole:b.agentRole,text:redact(oneLine(b.body)),since:b.createdAt});
 }
 return out;
}

export type ReviewsView={
 tasks:Array<{taskId:string;reviewRole:string;level?:string;stage:string;state:TaskState;slots:Array<{slot:number;verdict:string}>;rounds:number;changesRequested:number}>;
 stored:Array<{id:string;taskId:string;reviewerRole:string;verdict:string;createdAt:string;firstLine:string}>;
 gates:Array<{taskId:string;gate:string;status:string;detail?:string}>;
};
export async function reviewsView(state:CompanyState,model:ProjectModel):Promise<ReviewsView>{
 const stored=await state.reviews.list(model.projectId);
 const tasks=model.tasks.filter(t=>t.reviewRole).map(t=>({
  taskId:t.id,reviewRole:t.reviewRole!,level:t.reviewLevel,stage:t.stage,state:t.state,slots:t.reviewVerdicts,
  rounds:Math.ceil(stored.filter(r=>r.taskId===t.id).length/Math.max(1,model.plan?.tasks.find(x=>x.id===t.id)?.review?.slots.length||1)),
  changesRequested:stored.filter(r=>r.taskId===t.id&&r.verdict==="CHANGES_REQUIRED").length
 }));
 const gates=model.tasks.flatMap(t=>{
  const last=model.records.filter(r=>r.taskId===t.id&&r.status==="SUCCEEDED").at(-1);
  return (last?.gates??[]).map(g=>({taskId:t.id,gate:g.name,status:g.status,detail:g.detail?redact(oneLine(g.detail)):undefined}));
 });
 return {tasks,stored:stored.map(r=>({id:r.id,taskId:r.taskId,reviewerRole:r.reviewerRole,verdict:r.verdict,createdAt:r.createdAt,firstLine:gist(r.body)})),gates};
}

export type QaView={
 qa:{taskId:string;overall:string;at:string}|undefined;final?:string;required?:boolean;
 requirements:{total:number;tested:number;untested:string[]};
 tests:Array<{id?:string;requirementId:string;status:string;text:string;evidence?:string;owner?:string}>;
 rework:{rounds:number;limit?:number;pending:Array<{taskId:string;kind:string;round:number}>};
 state?:TaskState;
};
export async function qaView(state:CompanyState,model:ProjectModel):Promise<QaView>{
 const trace=await state.traceability.load(model.projectId),qaTask=model.plan?.tasks.find(t=>t.contract.validators.includes("qa-traceability"));
 const tested=new Set(trace.tests.map(t=>t.requirementId)),untested=trace.requirements.map(r=>r.id).filter(id=>!tested.has(id));
 const rounds=Math.max(0,...model.rework.map(r=>r.round));
 return {
  qa:trace.qa,final:model.run?.final?.qa.status,required:model.run?.final?.qa.required,
  requirements:{total:trace.requirements.length,tested:tested.size,untested},
  tests:trace.tests.map(t=>({id:t.id,requirementId:t.requirementId,status:t.status,text:redact(clip(oneLine(t.text),160)),evidence:t.evidence?redact(clip(oneLine(t.evidence),200)):undefined,owner:t.owner})),
  rework:{rounds,limit:model.plan?.maxQAReworkRounds,pending:model.tasks.filter(t=>t.stage==="qa-rework").map(t=>({taskId:t.id,kind:"fix",round:model.rework.filter(r=>r.taskId===t.id).at(-1)?.round??0}))},
  state:qaTask?model.tasks.find(t=>t.id===qaTask.id)?.state:undefined
 };
}

export type LogEntry={ts:string;source:"execution"|"telemetry";taskId?:string;agentRole?:string;kind:string;text:string;body?:string};
const NOISE=new Set(["provider.selected","provider.waiting","research.retrieved"]);
/** Latest meaningful events (telemetry plus execution attempts). Raw model output is only included with `full`. */
export function logEntries(model:ProjectModel,filter:{taskId?:string;agentRole?:string;full?:boolean}={}):LogEntry[]{
 const owner=new Map((model.plan?.tasks??[]).map(t=>[t.id,t.agentRole]));
 const matchTask=(id?:string)=>!filter.taskId||(id!==undefined&&(id===filter.taskId||id.startsWith(filter.taskId+"--review-")));
 const out:LogEntry[]=[];
 for(const r of model.records){
  if(!matchTask(r.taskId)||(filter.agentRole&&r.agentRole!==filter.agentRole))continue;
  if(r.status==="STARTED"&&!filter.full)continue;
  const tokens=r.inputTokens||r.outputTokens?" tokens "+r.inputTokens+"/"+r.outputTokens:"";
  const gates=r.gates.length?" gates "+r.gates.map(g=>g.name+"="+g.status).join(","):"";
  const text=r.agentRole+" "+r.status+" via "+r.provider+"/"+r.model+tokens+gates+(r.commitSha?" commit "+r.commitSha.slice(0,10):"")+(r.error?" — "+clip(oneLine(redact(r.error)),300):"");
  out.push({ts:stamp(r),source:"execution",taskId:r.taskId,agentRole:r.agentRole,kind:r.status,text,body:filter.full&&r.output?redact(r.output):undefined});
 }
 for(const e of model.events){
  if(filter.taskId&&!matchTask(e.taskId))continue;
  if(filter.agentRole&&(!e.taskId||owner.get(e.taskId)!==filter.agentRole))continue;
  if(!filter.full&&NOISE.has(e.type))continue;
  out.push({ts:e.ts,source:"telemetry",taskId:e.taskId,agentRole:e.taskId?owner.get(e.taskId):undefined,kind:e.type,text:e.type+(e.detail?" — "+clip(oneLine(redact(e.detail)),300):"")});
 }
 return out.sort((a,b)=>a.ts.localeCompare(b.ts));
}

export type UsageView={tokens:{input:number;output:number};knownCost:number;subscriptionRuns:number;unknownCostRuns:number;retries:number;failovers:number;providers:Record<string,number>;modelCalls:number;byAgent:Array<{role:string;calls:number;inputTokens:number;outputTokens:number}>};
export function usageView(model:ProjectModel):UsageView{
 const u=model.live.usage,done=model.records.filter(r=>r.status==="SUCCEEDED"),by=new Map<string,{role:string;calls:number;inputTokens:number;outputTokens:number}>();
 for(const r of done){const e=by.get(r.agentRole)??{role:r.agentRole,calls:0,inputTokens:0,outputTokens:0};e.calls++;e.inputTokens+=r.inputTokens;e.outputTokens+=r.outputTokens;by.set(r.agentRole,e);}
 return {tokens:{input:u.inputTokens,output:u.outputTokens},knownCost:u.knownCost,subscriptionRuns:u.subscriptionRuns,unknownCostRuns:u.unknownCostRuns,retries:model.live.retries,failovers:model.live.failovers,providers:model.live.providers,modelCalls:done.length,byAgent:[...by.values()].sort((a,b)=>a.role.localeCompare(b.role))};
}

// ------------------------------------------------------------------ task detail

const execFileAsync=promisify(execFile);
/** Read-only: does the recorded commit exist in the workspace repository? `unknown` when it cannot be checked. */
async function commitExists(workspace:string|undefined,sha:string):Promise<"yes"|"no"|"unknown">{
 if(!workspace||!/^[0-9a-f]{7,64}$/i.test(sha))return "unknown";
 try{await execFileAsync("git",["-C",workspace,"cat-file","-e",sha+"^{commit}"],{timeout:5000,env:{...process.env,GIT_OPTIONAL_LOCKS:"0"}});return "yes";}
 catch(error){return (error as {code?:number}).code===1||(error as {code?:number}).code===128?"no":"unknown";}
}

export type TaskDetail={
 task:TaskView;prompt?:string;skills:string[];
 evidence?:{
  inputArtifacts:string[];outputArtifacts:Array<{id:string;kind:string;title:string;createdAt:string;chars:number}>;
  handoffsOut:Array<{id:string;to:string}>;handoffsIn:Array<{id:string;from:string;fromTask:string}>;decisions:string[];blockers:string[];
  gates:Array<{name:string;status:string;detail?:string}>;changedFiles:string[];commits:Array<{sha:string;inRepository:"yes"|"no"|"unknown"}>;baseSha?:string;
  attempts:Array<{id:string;taskId:string;role:string;status:string;startedAt:string;finishedAt?:string;provider:string;model:string;inputTokens:number;outputTokens:number;cost?:number;billing:string;error?:string}>;
  reviews:Array<{id:string;reviewerRole:string;verdict:string;createdAt:string;firstLine:string}>;checkpoint?:{status:string;at:string;remaining:string[]};
  logTail:LogEntry[];logLocation:string;
 };
};
export async function taskDetail(state:CompanyState,model:ProjectModel,taskId:string,evidence:boolean):Promise<TaskDetail>{
 const task=resolveTask(model,taskId),plan=model.plan!,def=plan.tasks.find(t=>t.id===task.id)!;
 const base:TaskDetail={task,prompt:evidence?redact(def.prompt):undefined,skills:def.skills};
 if(!evidence)return base;
 const own=model.records.filter(r=>r.taskId===task.id||r.taskId.startsWith(task.id+"--review-"));
 const [artifacts,handoffs,decisions,blockers,reviews,checkpoint]=await Promise.all([state.artifacts.list(model.projectId),state.handoffs.list(model.projectId),state.decisions.list(model.projectId),state.blockers.list(model.projectId),state.reviews.list(model.projectId),state.checkpoints.load(model.projectId,task.id)]);
 const makerRecords=own.filter(r=>r.taskId===task.id&&r.status==="SUCCEEDED"),last=makerRecords.at(-1);
 const commits=[...new Set(makerRecords.map(r=>r.commitSha).filter((x):x is string=>Boolean(x)))];
 return {...base,evidence:{
  inputArtifacts:[...new Set(own.flatMap(r=>[...r.inputRefs,...r.contextRefs]))],
  outputArtifacts:artifacts.filter(a=>a.taskId===task.id).map(a=>({id:a.id,kind:a.kind,title:a.title,createdAt:a.createdAt,chars:a.content.length})),
  handoffsOut:handoffs.filter(h=>h.taskId===task.id).map(h=>({id:h.id,to:h.toRole})),
  handoffsIn:handoffs.filter(h=>def.dependencies.includes(h.taskId)&&h.toRole===def.agentRole).map(h=>({id:h.id,from:h.fromRole,fromTask:h.taskId})),
  decisions:decisions.filter(d=>d.taskId===task.id).map(d=>redact(oneLine(d.decision))),
  blockers:blockers.filter(b=>b.taskId===task.id).map(b=>b.status+": "+redact(oneLine(b.body))),
  gates:(last?.gates??[]).map(g=>({name:g.name,status:g.status,detail:g.detail?redact(oneLine(g.detail)):undefined})),
  changedFiles:last?.changedFiles??[],
  commits:await Promise.all(commits.map(async sha=>({sha,inRepository:await commitExists(plan.workspace?.path,sha)}))),
  baseSha:last?.baseSha,
  attempts:[...new Map(own.filter(r=>r.status!=="STARTED").map(r=>[r.id,r])).values()].map(r=>({id:r.id,taskId:r.taskId,role:r.agentRole,status:r.status,startedAt:r.startedAt,finishedAt:r.finishedAt,provider:r.provider,model:r.model,inputTokens:r.inputTokens,outputTokens:r.outputTokens,cost:r.actualCost,billing:r.billing,error:r.error?redact(clip(oneLine(r.error),400)):undefined})),
  reviews:reviews.filter(r=>r.taskId===task.id).map(r=>({id:r.id,reviewerRole:r.reviewerRole,verdict:r.verdict,createdAt:r.createdAt,firstLine:clip(redact(oneLine(r.body.split("\n").find(l=>l.trim()&&!/^(PASS|CHANGES_REQUIRED)$/.test(l.trim()))??"")),120)})),
  checkpoint:checkpoint?{status:checkpoint.status,at:checkpoint.at,remaining:checkpoint.remaining.map(x=>redact(x))}:undefined,
  logTail:logEntries(model,{taskId:task.id}).slice(-10),
  logLocation:join(state.root,"executions",model.projectId,"records.jsonl")+" (execution log), "+join(state.root,"telemetry",model.projectId,"events.jsonl")+" (events)"
 }};
}

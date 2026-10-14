import {readdir,readFile} from "node:fs/promises";
import {join} from "node:path";
import {z} from "zod";
import {SafeId} from "./ids.js";
import type {CompanyState} from "./state.js";
import type {ExecutionRecordValue} from "./execution-record.js";
import {ProjectPlan,type ProjectPlanValue,type TaskPlanValue} from "./project.js";
import type {RunStateValue} from "./run-store.js";
import type {ReworkRequest} from "./rework-store.js";
import {taskHistory} from "./orchestrator.js";
import {parseReviewVerdict,section} from "./output-parser.js";
import {impliedQaStatus,parseQa} from "./structured.js";
import {buildProjectStatus,type TelemetryEvent} from "./telemetry.js";
import {redact} from "./secrets.js";
import type {CompanyVersionValue} from "./company-version.js";
import {derivedPlanSource,lessonsInjected} from "./plan-provenance.js";
import type {InterventionValue} from "./intervention-log.js";
import {METRICS,METRIC_CATALOG_VERSION,type MetricDefinition} from "./metric-catalog.js";

/**
 * Company-wide, read-only scorecard over a CompanySWAI state directory: what is running, what finished or failed and why, who was
 * responsible, how long it took, what it consumed, and the catalog metrics with their sources and coverage.
 *
 * It never writes: execution logs are read with FileExecutionStore.read() (which does not quarantine unreadable lines), and every
 * other store is only listed or loaded. Unknown is reported as unknown: tokens without provider usage, money for subscription
 * runs, human interventions before the intervention log existed, provenance and company version for runs older than Phase 0.
 */

export type TokenClass="reported"|"estimated"|"partial"|"unknown";
export type Basis="recorded"|"derived"|"unknown";
export type AttemptStatus="SUCCEEDED"|"FAILED"|"PAUSED_CAPACITY"|"IN_FLIGHT";
export type AttemptFact={
 id:string;taskId:string;kind:"maker"|"review";role:string;provider:string;model:string;status:AttemptStatus;startedAt:string;finishedAt?:string;durationMs?:number;
 inputTokens:number;outputTokens:number;cacheReadInputTokens?:number;cacheCreationInputTokens?:number;token:{class:TokenClass;basis:Basis};
 billing:string;
 /** Money for this attempt and what it is: tokens × configured nominal prices (an estimate, never a bill) or a billed amount. */
 cost?:number;costBasis?:{value:"nominal-rate-estimate"|"billed";basis:Basis};gates:Array<{name:string;status:string}>;error?:string;
};
export type QaVerdict="PASS"|"FAIL"|"BLOCKED"|"NOT_APPLICABLE"|"UNPARSED";
export type TaskFact={
 taskId:string;role:string;attempts:number;firstAttempt?:AttemptStatus;lastAttempt?:AttemptStatus;
 /** The engine's own DONE (taskHistory); undefined when the plan is missing. */
 done?:boolean;makerVersions?:number;reviews:{pass:number;changesRequired:number};qa?:QaVerdict;
 startedAt?:string;endedAt?:string;wallMs?:number;failure?:string;
};
export type TokenTally={
 reported:{input:number;output:number;cacheRead:number;cacheCreation:number;attempts:number};
 estimated:{input:number;output:number;attempts:number};partialAttempts:number;unknownAttempts:number;
};
export type RunFact={
 projectId:string;phase?:string;final?:string;finalQa?:string;startedAt?:string;endedAt?:string;activeMs?:number;
 engine:{state:"IDLE"|"RUNNING"|"INTERRUPTED"|"FINISHED";pid?:number;running:Array<{taskId:string;role:string;elapsedMs:number}>};
 planSource:{value:string;basis:Basis};lessonsInjected:{value?:number;basis:Basis};companyVersion?:CompanyVersionValue;
 tasks:TaskFact[];attempts:{maker:number;review:number;failed:number;inFlight:number};
 /** Times the engine parked a step because no provider had capacity (no provider call was made). */
 capacityPauses:number;tokens:TokenTally;knownCost:number;subscriptionAttempts:number;
 reviewVerdicts:{pass:number;changesRequired:number};qa:Array<{taskId:string;verdict:QaVerdict}>;qaConflict:boolean;
 failures:Array<{taskId:string;role:string;reason:string;at?:string}>;interventions?:number;issues:string[];
 /** The interval interventions were matched against (see attributeInterventions). */
 interventionWindow?:{from?:string;to?:string;basis:RunWindow["basis"]};
 skillsSelected:Record<string,number>;
};
export type MetricResult={
 id:string;name:string;unit:MetricDefinition["unit"];status:"MEASURED"|"UNKNOWN"|"NOT_AVAILABLE";value:number|null;
 numerator:number|null;denominator:number|null;coverage?:string;reason?:string;source:string;limitations:string;
};
export type ProgramPhase={id:string;title:string;status:string;ownerUat:string;issue?:number;branch?:string;pr?:number|null};
export type Scorecard={
 generatedAt:string;stateDir:string;readOnly:true;catalogVersion:number;
 window:{since?:string;until?:string;firstActivity?:string;lastActivity?:string};
 checkout?:CompanyVersionValue;program?:{name:string;phases:ProgramPhase[]};
 totals:{projects:number;runs:number;byFinal:Record<string,number>;running:number;attempts:number;makerTasks:number};
 runs:RunFact[];metrics:MetricResult[];
 interventions:{logExists:boolean;since?:string;total:number;attributed:number;unattributed:number;unattributedReasons:Partial<Record<UnattributedReason,number>>;unreadable:number;byKind:Record<string,number>};
 coverage:{capacityPauses:number;unreadableLogLines:number;runsWithoutState:number;runsWithoutPlan:number;unreadableRunFiles:number;attemptsWithoutFinish:number;estimatedTokenAttempts:number;unknownTokenAttempts:number;provenanceRecorded:number;versionRecorded:number};
};

const Program=z.object({name:z.string(),phases:z.array(z.object({id:z.string(),title:z.string(),status:z.string(),ownerUat:z.string(),issue:z.number().optional(),branch:z.string().optional(),pr:z.number().nullable().optional()}))});

const oneLine=(text:string)=>text.replace(/\s+/g," ").trim();
const clip=(text:string,limit:number)=>text.length>limit?text.slice(0,limit-1)+"…":text;
const reason=(text:string)=>clip(redact(oneLine(text)),180);
const isReview=(taskId:string)=>/--review-/.test(taskId);
const ms=(a?:string,b?:string)=>a&&b?Math.max(0,Date.parse(b)-Date.parse(a)):undefined;
/** A QA verdict exists when the task's contract is QA traceability or its output carries a "QA Status" section. Role names are never used: roles live in Markdown. */
const qaContract=(task:TaskPlanValue|undefined)=>Boolean(task?.contract.validators.includes("qa-traceability"));
const hasQaStatus=(output:string)=>section(output,"QA Status")!==undefined;
const ACCEPTED=new Set(["ACCEPTED","ACCEPTED_WITH_RISKS"]);

async function names(dir:string){try{return await readdir(dir);}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return [];throw error;}}

/** Every project id known under the state root (run state, execution log or memory), without creating anything. */
export async function scorecardProjectIds(root:string){
 const ids=new Set<string>(),add=(name:string)=>{if(SafeId.safeParse(name).success)ids.add(name);};
 for(const file of await names(join(root,"runs")))if(file.endsWith(".json")&&!file.endsWith(".plan.json"))add(file.slice(0,-5));
 for(const dir of await names(join(root,"executions")))add(dir);
 for(const dir of await names(join(root,"projects")))add(dir);
 return [...ids].sort();
}

function linesById(records:ExecutionRecordValue[]){
 const byId=new Map<string,ExecutionRecordValue[]>();
 for(const r of records){const list=byId.get(r.id)??[];list.push(r);byId.set(r.id,list);}
 return byId;
}
/**
 * A capacity pause (TaskRunner.pauseCapacity) is a standalone PAUSED_CAPACITY record written when no provider could take the step:
 * no STARTED line, no provider call. It is not an execution attempt and is counted separately.
 */
const isCapacityPause=(lines:ExecutionRecordValue[])=>!lines.some(l=>l.status==="STARTED")&&lines.at(-1)!.status==="PAUSED_CAPACITY";
export function countCapacityPauses(records:ExecutionRecordValue[]){return [...linesById(records).values()].filter(isCapacityPause).length;}

/**
 * One attempt per execution-record id (one provider call plus its repair rounds): its last line decides the status; tokens come
 * from the last line that carries them. Capacity pauses are excluded (see isCapacityPause).
 */
export function foldAttempts(records:ExecutionRecordValue[]):AttemptFact[]{
 const out:AttemptFact[]=[];
 for(const lines of linesById(records).values()){
  if(isCapacityPause(lines))continue;
  const last=lines.at(-1)!,status:AttemptStatus=last.status==="STARTED"||last.status==="CHECKPOINTED"?"IN_FLIGHT":last.status;
  const usage=[...lines].reverse().find(l=>l.tokenSource||l.inputTokens+l.outputTokens>0)??last;
  const token:AttemptFact["token"]=usage.tokenSource?{class:usage.tokenSource,basis:"recorded"}
   :last.provider==="dry-run"?{class:"estimated",basis:"derived"}
   :usage.inputTokens+usage.outputTokens>0?{class:"reported",basis:"derived"}:{class:"unknown",basis:"unknown"};
  const finishedAt=status==="IN_FLIGHT"?undefined:[...lines].reverse().find(l=>l.finishedAt)?.finishedAt;
  out.push({
   id:last.id,taskId:last.taskId,kind:isReview(last.taskId)?"review":"maker",role:last.agentRole,provider:last.provider,model:last.model,status,
   startedAt:lines[0].startedAt,finishedAt,durationMs:ms(lines[0].startedAt,finishedAt),
   // Physical input: providers whose inputTokens excludes prompt-cache tokens (Anthropic Messages API) get them added back here.
   inputTokens:token.class==="unknown"?0:usage.inputTokens+(usage.cacheTokensInInput===false?(usage.cacheCreationInputTokens??0)+(usage.cacheReadInputTokens??0):0),outputTokens:token.class==="unknown"?0:usage.outputTokens,
   cacheReadInputTokens:usage.cacheReadInputTokens,cacheCreationInputTokens:usage.cacheCreationInputTokens,token,
   billing:last.billing,cost:last.actualCost,costBasis:last.actualCost==null?undefined:last.costBasis?{value:last.costBasis,basis:"recorded"}:{value:"nominal-rate-estimate",basis:"derived"},gates:last.gates.map(g=>({name:g.name,status:g.status})),error:last.error?reason(last.error):undefined
  });
 }
 return out.sort((a,b)=>a.startedAt.localeCompare(b.startedAt)||a.id.localeCompare(b.id));
}

export function tallyTokens(attempts:AttemptFact[]):TokenTally{
 const t:TokenTally={reported:{input:0,output:0,cacheRead:0,cacheCreation:0,attempts:0},estimated:{input:0,output:0,attempts:0},partialAttempts:0,unknownAttempts:0};
 for(const a of attempts){
  if(a.status==="IN_FLIGHT")continue;
  if(a.token.class==="reported"||a.token.class==="partial"){
   t.reported.input+=a.inputTokens;t.reported.output+=a.outputTokens;t.reported.cacheRead+=a.cacheReadInputTokens??0;t.reported.cacheCreation+=a.cacheCreationInputTokens??0;t.reported.attempts++;
   if(a.token.class==="partial")t.partialAttempts++;
  }else if(a.token.class==="estimated"){t.estimated.input+=a.inputTokens;t.estimated.output+=a.outputTokens;t.estimated.attempts++;}
  else t.unknownAttempts++;
 }
 return t;
}

function qaVerdictOf(output:string):QaVerdict{
 const parsed=parseQa(output);
 return parsed.overall??(parsed.tests.length?impliedQaStatus(parsed.tests):"UNPARSED");
}

type Loaded={projectId:string;run?:RunStateValue;plan?:ProjectPlanValue;records:ExecutionRecordValue[];unreadable:number;events:TelemetryEvent[];rework:ReworkRequest[];reviews:Array<{taskId:string;verdict:string}>;issues:string[]};

async function loadProject(state:CompanyState,projectId:string):Promise<Loaded>{
 const issues:string[]=[];
 const [log,events,rework,reviews]=await Promise.all([
  state.executions.read(projectId),state.telemetry.list(projectId),
  state.rework.list(projectId).catch(()=>{issues.push("rework file unreadable");return [] as ReworkRequest[];}),
  state.reviews.list(projectId).catch(()=>{issues.push("reviews unreadable");return [];})
 ]);
 let run:RunStateValue|undefined,plan:ProjectPlanValue|undefined;
 try{run=await state.runs.load(projectId);}catch{issues.push("run state unreadable");}
 try{plan=await state.runs.loadPlan(projectId);}catch{
  // A plan that no longer matches the current schema is still useful for provenance counting.
  try{const raw=JSON.parse(await readFile(join(state.root,"runs",projectId+".plan.json"),"utf8"));const safe=ProjectPlan.safeParse(raw);if(safe.success)plan=safe.data;else issues.push("plan does not match the current schema");}
  catch{issues.push("plan unreadable");}
 }
 if(log.unreadable)issues.push(log.unreadable+" unreadable execution log line(s)");
 return {projectId,run,plan,records:log.records,unreadable:log.unreadable,events,rework,reviews:reviews.map(r=>({taskId:r.taskId,verdict:r.verdict})),issues};
}

function buildRun(p:Loaded,options:{now:number;isAlive?:(pid:number)=>boolean}):RunFact{
 const {run,plan,records}=p,attempts=foldAttempts(records),byTaskPlan=new Map((plan?.tasks??[]).map(t=>[t.id,t]));
 const live=buildProjectStatus(p.projectId,p.events,records,{now:options.now,isAlive:options.isAlive,planTasks:plan?.tasks.map(t=>t.id)});
 const makerIds=[...new Set([...(plan?.tasks.map(t=>t.id)??[]),...attempts.filter(a=>a.kind==="maker").map(a=>a.taskId)])];
 const reviewsFor=(taskId:string)=>p.reviews.filter(r=>r.taskId===taskId);
 const tasks:TaskFact[]=makerIds.map(taskId=>{
  const own=attempts.filter(a=>a.kind==="maker"&&a.taskId===taskId),planTask=byTaskPlan.get(taskId);
  const relatedRecords=records.filter(r=>r.taskId===taskId||r.taskId.startsWith(taskId+"--review-"));
  const hist=planTask&&plan?taskHistory(records,planTask,plan,p.rework):undefined;
  const stored=reviewsFor(taskId);
  const reviewVerdicts=stored.length?stored.map(r=>r.verdict):records.filter(r=>r.taskId.startsWith(taskId+"--review-")&&r.status==="SUCCEEDED").map(r=>parseReviewVerdict(r.output)??"CHANGES_REQUIRED");
  const role=planTask?.agentRole??own[0]?.role??"unknown";
  const lastSuccess=[...records].reverse().find(r=>r.taskId===taskId&&r.status==="SUCCEEDED");
  const lastFailed=own.at(-1)?.status==="FAILED"?own.at(-1):undefined;
  const endedAt=relatedRecords.map(r=>r.finishedAt).filter((x):x is string=>Boolean(x)).sort().at(-1);
  return {
   taskId,role,attempts:own.length,firstAttempt:own[0]?.status,lastAttempt:own.at(-1)?.status,done:hist?.complete,makerVersions:hist?.makerVersions,
   reviews:{pass:reviewVerdicts.filter(v=>v==="PASS").length,changesRequired:reviewVerdicts.filter(v=>v==="CHANGES_REQUIRED").length},
   qa:lastSuccess&&(qaContract(planTask)||hasQaStatus(lastSuccess.output))?qaVerdictOf(lastSuccess.output):undefined,
   startedAt:own[0]?.startedAt,endedAt,wallMs:ms(own[0]?.startedAt,endedAt),failure:lastFailed?.error
  };
 });
 const qa=tasks.filter(t=>t.qa).map(t=>({taskId:t.taskId,verdict:t.qa!}));
 const recordedSource=run?.provenance?.source,derived=run?derivedPlanSource(run):"unknown";
 const planSource=recordedSource?{value:recordedSource,basis:"recorded" as Basis}:derived!=="unknown"?{value:derived,basis:"derived" as Basis}:{value:"unknown",basis:"unknown" as Basis};
 const lessons=run?.provenance?{value:run.provenance.lessonsInjected,basis:"recorded" as Basis}:plan?{value:lessonsInjected(plan),basis:"derived" as Basis}:{value:undefined,basis:"unknown" as Basis};
 const starts=attempts.map(a=>a.startedAt).sort(),ends=attempts.map(a=>a.finishedAt).filter((x):x is string=>Boolean(x)).sort();
 const skillsSelected:Record<string,number>={};
 for(const r of records)if(r.status==="SUCCEEDED"||r.status==="FAILED")for(const u of r.skillTrace?.used??[])skillsSelected[u.name]=(skillsSelected[u.name]??0)+1;
 const final=run?.final?.status;
 return {
  projectId:p.projectId,phase:run?.phase,final,finalQa:run?.final?.qa.status,startedAt:run?.startedAt??starts[0],endedAt:run?.final?.at??ends.at(-1),activeMs:ms(starts[0],ends.at(-1)),
  engine:{state:live.state,pid:live.pid,running:live.running.map(r=>({taskId:r.taskId,role:r.agentRole||byTaskPlan.get(r.taskId)?.agentRole||"unknown",elapsedMs:r.elapsedMs}))},
  planSource,lessonsInjected:lessons,companyVersion:run?.companyVersion,tasks,
  capacityPauses:countCapacityPauses(records),
  attempts:{maker:attempts.filter(a=>a.kind==="maker").length,review:attempts.filter(a=>a.kind==="review").length,failed:attempts.filter(a=>a.status==="FAILED").length,inFlight:attempts.filter(a=>a.status==="IN_FLIGHT").length},
  tokens:tallyTokens(attempts),knownCost:attempts.reduce((n,a)=>n+(a.billing==="metered"&&a.cost!=null?a.cost:0),0),subscriptionAttempts:attempts.filter(a=>a.billing==="subscription").length,
  reviewVerdicts:{pass:tasks.reduce((n,t)=>n+t.reviews.pass,0),changesRequired:tasks.reduce((n,t)=>n+t.reviews.changesRequired,0)},
  qa,qaConflict:Boolean(final&&ACCEPTED.has(final)&&qa.some(q=>q.verdict==="FAIL"||q.verdict==="BLOCKED")),
  failures:tasks.filter(t=>t.lastAttempt==="FAILED").map(t=>({taskId:t.taskId,role:t.role,reason:t.failure??"failed (no error recorded)",at:t.endedAt})),
  issues:[...p.issues,...(!run?["no run state"]:[]),...(!plan?["no plan"]:[])],skillsSelected
 };
}

const ratio=(n:number,d:number)=>d>0?Number((n/d).toFixed(4)):null;
function median(values:number[]){if(!values.length)return null;const s=[...values].sort((a,b)=>a-b),m=Math.floor(s.length/2);return s.length%2?s[m]:Math.round((s[m-1]+s[m])/2);}
/** Union of [start,end] intervals: total covered milliseconds and the gaps between them. */
function union(intervals:Array<[number,number]>){
 const sorted=intervals.filter(([a,b])=>b>=a).sort((x,y)=>x[0]-y[0]);let covered=0,gap=0,cur:[number,number]|undefined;
 for(const [a,b] of sorted){if(!cur){cur=[a,b];continue;}if(a>cur[1]){covered+=cur[1]-cur[0];gap+=a-cur[1];cur=[a,b];}else cur[1]=Math.max(cur[1],b);}
 if(cur)covered+=cur[1]-cur[0];
 return {covered,gap};
}

function metric(id:string,values:Partial<MetricResult>):MetricResult{
 const def=METRICS.find(m=>m.id===id)!;
 if(def.unavailable)return {id,name:def.name,unit:def.unit,status:"NOT_AVAILABLE",value:null,numerator:null,denominator:null,reason:def.unavailable,source:def.source,limitations:def.limitations};
 const value=values.value??null;
 return {id,name:def.name,unit:def.unit,status:value===null?"UNKNOWN":"MEASURED",value,numerator:values.numerator??null,denominator:values.denominator??null,coverage:values.coverage,reason:value===null?(values.reason??"no data in the window"):values.reason,source:def.source,limitations:def.limitations};
}

function computeMetrics(runs:RunFact[],loaded:Map<string,Loaded>,interventions:{exists:boolean;since?:string;unattributed:number},now:number):MetricResult[]{
 const finished=runs.filter(r=>r.final),accepted=finished.filter(r=>ACCEPTED.has(r.final!));
 const qaBad=runs.filter(r=>r.qa.some(q=>q.verdict==="FAIL"||q.verdict==="BLOCKED"));
 const makerTasks=runs.flatMap(r=>r.tasks.filter(t=>t.attempts>0&&t.firstAttempt&&t.firstAttempt!=="IN_FLIGHT"));
 const planned=runs.flatMap(r=>r.tasks.filter(t=>t.done!==undefined));
 const terminal=planned.filter(t=>t.done||t.lastAttempt==="FAILED");
 const firstPass=terminal.filter(t=>t.done&&t.makerVersions===1&&t.attempts===1&&t.reviews.changesRequired===0);
 const allAttempts=runs.flatMap(r=>foldAttempts(loaded.get(r.projectId)!.records));
 const makerFinished=allAttempts.filter(a=>a.kind==="maker"&&(a.status==="SUCCEEDED"||a.status==="FAILED"));
 const reportedAll=allAttempts.filter(a=>a.status!=="IN_FLIGHT"&&(a.token.class==="reported"||a.token.class==="partial"));
 const sum=(xs:AttemptFact[])=>xs.reduce((n,a)=>n+a.inputTokens+a.outputTokens,0);
 const finishedAttempts=allAttempts.filter(a=>a.status==="SUCCEEDED"||a.status==="FAILED");
 const reviewTotal=runs.reduce((n,r)=>n+r.reviewVerdicts.pass+r.reviewVerdicts.changesRequired,0),reviewChanges=runs.reduce((n,r)=>n+r.reviewVerdicts.changesRequired,0);
 // Reviewer escape, same run only: a QA FAIL whose reviewed upstream tasks all ended with a PASS review.
 let escapes=0,escapeBase=0;
 for(const r of runs){
  const plan=loaded.get(r.projectId)!.plan;if(!plan)continue;
  for(const q of r.qa.filter(x=>x.verdict==="FAIL")){
   const upstream=(plan.tasks.find(t=>t.id===q.taskId)?.dependencies??[]).map(id=>r.tasks.find(t=>t.taskId===id)).filter((t):t is TaskFact=>Boolean(t&&plan.tasks.find(x=>x.id===t.taskId)?.review));
   if(!upstream.length)continue;escapeBase++;
   if(upstream.every(t=>t.done&&t.reviews.pass>0))escapes++;
  }
 }
 const sourced=runs.filter(r=>r.planSource.value!=="unknown"),supplied=sourced.filter(r=>r.planSource.value==="supplied-plan");
 const withPlan=runs.filter(r=>r.lessonsInjected.value!==undefined),withLessons=withPlan.filter(r=>(r.lessonsInjected.value??0)>0);
 const acceptedReported=accepted.reduce((n,r)=>n+r.tokens.reported.input+r.tokens.reported.output,0),acceptedWithUsage=accepted.filter(r=>r.tokens.reported.attempts>0);
 const durations=finishedAttempts.map(a=>a.durationMs).filter((x):x is number=>x!==undefined);
 // Activity = union of individual attempt intervals: waits between attempts (approval, capacity, a person) are not busy time.
 // Only an attempt still in flight on a live engine extends to now; an interrupted one counts from its start only.
 const intervals=runs.flatMap(r=>foldAttempts(loaded.get(r.projectId)!.records).map(a=>[Date.parse(a.startedAt),a.finishedAt?Date.parse(a.finishedAt):a.status==="IN_FLIGHT"&&r.engine.state==="RUNNING"?now:Date.parse(a.startedAt)] as [number,number]));
 const activity=union(intervals);
 const covered=runs.filter(r=>r.interventions!==undefined),coveredAccepted=covered.filter(r=>r.final&&ACCEPTED.has(r.final));
 const attributed=covered.reduce((n,r)=>n+(r.interventions??0),0);
 const priced=allAttempts.filter(a=>a.billing==="metered"&&a.cost!=null),subscription=allAttempts.filter(a=>a.billing==="subscription");
 // A runner cost computed from unreported usage (0 tokens) is "0 at nominal rates" for an unknown amount: excluded, and counted.
 const estimated=priced.filter(a=>a.costBasis?.value!=="billed"&&a.token.class!=="unknown"),billed=priced.filter(a=>a.costBasis?.value==="billed");
 const pricedUnknown=priced.filter(a=>a.costBasis?.value!=="billed"&&a.token.class==="unknown").length;
 const tokenCoverage=finishedAttempts.length?reportedAll.length+"/"+finishedAttempts.length+" finished attempts have provider-reported usage":undefined;
 return [
  metric("accepted_run_rate",{numerator:accepted.length,denominator:finished.length,value:ratio(accepted.length,finished.length)}),
  metric("qa_conflict_rate",{numerator:qaBad.filter(r=>r.qaConflict).length,denominator:qaBad.length,value:ratio(qaBad.filter(r=>r.qaConflict).length,qaBad.length),coverage:runs.filter(r=>r.qa.length).length+" run(s) with a QA verdict"}),
  metric("first_attempt_gate_pass",{numerator:makerTasks.filter(t=>t.firstAttempt==="SUCCEEDED").length,denominator:makerTasks.length,value:ratio(makerTasks.filter(t=>t.firstAttempt==="SUCCEEDED").length,makerTasks.length)}),
  metric("first_pass_acceptance",{numerator:firstPass.length,denominator:terminal.length,value:ratio(firstPass.length,terminal.length),coverage:runs.filter(r=>loaded.get(r.projectId)!.plan).length+"/"+runs.length+" runs have a readable plan"}),
  metric("attempt_failure_rate",{numerator:makerFinished.filter(a=>a.status==="FAILED").length,denominator:makerFinished.length,value:ratio(makerFinished.filter(a=>a.status==="FAILED").length,makerFinished.length)}),
  metric("rework_token_share",{numerator:sum(reportedAll.filter(a=>a.status==="FAILED")),denominator:sum(reportedAll),value:ratio(sum(reportedAll.filter(a=>a.status==="FAILED")),sum(reportedAll)),coverage:tokenCoverage}),
  metric("review_changes_required_rate",{numerator:reviewChanges,denominator:reviewTotal,value:ratio(reviewChanges,reviewTotal)}),
  metric("reviewer_escape_rate",{numerator:escapes,denominator:escapeBase,value:ratio(escapes,escapeBase),coverage:"same-run links only; "+runs.filter(r=>r.qa.some(q=>q.verdict==="FAIL")).length+" run(s) with a QA FAIL",reason:escapeBase?undefined:"no QA FAIL with a reviewed upstream task in the same run"}),
  metric("planner_bypass_rate",{numerator:supplied.length,denominator:sourced.length,value:ratio(supplied.length,sourced.length),coverage:sourced.filter(r=>r.planSource.basis==="recorded").length+" recorded, "+sourced.filter(r=>r.planSource.basis==="derived").length+" derived from hashes"}),
  metric("lesson_injection_rate",{numerator:withLessons.length,denominator:withPlan.length,value:ratio(withLessons.length,withPlan.length)}),
  metric("reported_tokens",{numerator:sum(reportedAll),denominator:null,value:reportedAll.length?sum(reportedAll):null,coverage:tokenCoverage,reason:reportedAll.length?undefined:"no attempt has provider-reported usage"}),
  metric("tokens_per_accepted_run",{numerator:acceptedReported,denominator:acceptedWithUsage.length,value:acceptedWithUsage.length?Math.round(acceptedReported/acceptedWithUsage.length):null,coverage:acceptedWithUsage.length+"/"+accepted.length+" accepted runs have reported usage",reason:acceptedWithUsage.length?undefined:"no accepted run has reported usage"}),
  metric("median_attempt_ms",{numerator:null,denominator:durations.length,value:median(durations)}),
  metric("accepted_runs_per_busy_hour",{numerator:accepted.length,denominator:Number((activity.covered/3_600_000).toFixed(3)),value:activity.covered>0?Number((accepted.length/(activity.covered/3_600_000)).toFixed(2)):null}),
  metric("dispatch_gap_ms",{numerator:activity.gap,denominator:null,value:intervals.length>1?activity.gap:null,reason:intervals.length>1?undefined:"fewer than two attempts"}),
  metric("interventions_per_accepted_run",interventions.exists&&interventions.since?{numerator:attributed,denominator:coveredAccepted.length,value:ratio(attributed,coveredAccepted.length),coverage:covered.length+" run(s) started after the log began ("+interventions.since+"); "+interventions.unattributed+" intervention(s) not attributable to a run in view",reason:coveredAccepted.length?undefined:"no accepted run started after the intervention log began"}:{value:null,reason:"no intervention log: interventions before Phase 0 were never recorded"}),
  metric("estimated_metered_cost",{numerator:null,denominator:null,value:estimated.length?Number(estimated.reduce((n,a)=>n+(a.cost??0),0).toFixed(6)):null,coverage:estimated.length+" metered attempt(s) priced at configured nominal rates ("+estimated.filter(a=>a.costBasis?.basis==="recorded").length+" recorded, "+estimated.filter(a=>a.costBasis?.basis==="derived").length+" derived); "+pricedUnknown+" priced attempt(s) with unreported usage excluded; "+subscription.length+" subscription attempt(s) excluded",reason:estimated.length?undefined:"no metered attempt with a configured price"}),
  metric("billed_cost",{numerator:null,denominator:null,value:billed.length?Number(billed.reduce((n,a)=>n+(a.cost??0),0).toFixed(6)):null,coverage:billed.length+" attempt(s) with a billed amount",reason:billed.length?undefined:"no provider billing source: estimates and subscription usage are never presented as billed money"}),
  ...["skill_outcome_effect","repeated_error_rate","model_escalation_success","release_readiness"].map(id=>metric(id,{}))
 ];
}

/** A dispatch is recorded just before the run it starts; dispatch-like entries this long before a run's start still belong to it. */
export const DISPATCH_GRACE_MS=10*60_000;
const DISPATCH_KINDS=new Set(["dispatch","replan"]);
const epoch=(iso:string|undefined,name:string)=>{if(iso===undefined)return undefined;const ms=Date.parse(iso);if(Number.isNaN(ms))throw new Error(name+" is not a valid timestamp: "+iso);return ms;};

export type UnattributedReason="invalid-timestamp"|"future"|"no-project"|"project-not-in-view"|"run-time-unknown"|"before-run"|"after-run";
/** The interval in which interventions can belong to a run. `to` is open (now) only while its engine is live. */
export type RunWindow={projectId:string;from?:number;to?:number;basis:"final"|"run-state"|"activity"|"live"|"unknown"};
/**
 * Attributes interventions to runs by project id AND time: an entry belongs to a run when it falls inside the run's window
 * [start, end] — dispatch-like entries (dispatch, replan) may precede the start by DISPATCH_GRACE_MS. The end is the run's final
 * verdict time (updated on every pass, so a resume that ran is inside it), else its last run-state write, else its last recorded
 * activity; only a live engine extends to `now`. Anything else — after the run ended (a later reopen or manual action is not proof of
 * a new epoch), before it, in the future, without a parseable timestamp, without a project, or for a project not in view — is
 * unattributed, with the reason, never assumed.
 */
export function attributeInterventions(windows:RunWindow[],entries:InterventionValue[],now:number){
 const byRun=new Map<string,number>(),reasons:Partial<Record<UnattributedReason,number>>={},ids=new Map(windows.map(w=>[w.projectId,w]));
 const miss=(reason:UnattributedReason)=>{reasons[reason]=(reasons[reason]??0)+1;};
 for(const w of windows)byRun.set(w.projectId,0);
 for(const e of entries){
  const t=Date.parse(e.ts);
  if(Number.isNaN(t)){miss("invalid-timestamp");continue;}
  if(t>now){miss("future");continue;}
  if(!e.projectId){miss("no-project");continue;}
  const w=ids.get(e.projectId);
  if(!w){miss("project-not-in-view");continue;}
  if(w.from===undefined||w.to===undefined){miss("run-time-unknown");continue;}
  if(t<w.from-(DISPATCH_KINDS.has(e.kind)?DISPATCH_GRACE_MS:0)){miss("before-run");continue;}
  if(t>w.to){miss("after-run");continue;}
  byRun.set(w.projectId,byRun.get(w.projectId)!+1);
 }
 return {byRun,unattributed:Object.values(reasons).reduce((a,b)=>a+(b??0),0),reasons};
}

export type ScorecardOptions={since?:string;until?:string;now?:number;isAlive?:(pid:number)=>boolean;checkout?:CompanyVersionValue;programPath?:string;projects?:string[]};

export async function buildScorecard(state:CompanyState,options:ScorecardOptions={}):Promise<Scorecard>{
 const now=options.now??Date.now();
 const ids=options.projects??await scorecardProjectIds(state.root);
 const loaded=new Map<string,Loaded>();
 for(const id of ids)loaded.set(id,await loadProject(state,id));
 const log=await state.interventions.read();
 // Instants are compared as epoch milliseconds, never as strings ("…00Z" and "…00.000Z" or "+07:00" are the same instant).
 const sinceMs=epoch(options.since,"since"),untilMs=epoch(options.until,"until");
 const stamps=log.entries.map(e=>Date.parse(e.ts)).filter(t=>Number.isFinite(t)&&t<=now);
 const logStart=stamps.length?Math.min(...stamps):undefined,since=logStart!==undefined?new Date(logStart).toISOString():undefined;
 let runs=[...loaded.values()].map(p=>buildRun(p,{now,isAlive:options.isAlive}));
 if(sinceMs!==undefined||untilMs!==undefined)runs=runs.filter(r=>{const t=r.startedAt?Date.parse(r.startedAt):NaN;return !Number.isNaN(t)&&(sinceMs===undefined||t>=sinceMs)&&(untilMs===undefined||t<untilMs);});
 const windows:RunWindow[]=runs.map(r=>{
  const run=loaded.get(r.projectId)!.run,from=r.startedAt?Date.parse(r.startedAt):NaN;
  if(Number.isNaN(from))return {projectId:r.projectId,basis:"unknown"};
  if(r.engine.state==="RUNNING")return {projectId:r.projectId,from,to:now,basis:"live"};
  const end=run?.final?.at??run?.updatedAt??r.endedAt,basis:RunWindow["basis"]=run?.final?.at?"final":run?.updatedAt?"run-state":"activity";
  const to=end?Date.parse(end):NaN;
  return Number.isNaN(to)?{projectId:r.projectId,from,basis:"unknown"}:{projectId:r.projectId,from,to:Math.max(from,to),basis};
 });
 const attribution=attributeInterventions(windows,log.entries,now);
 for(const [i,r] of runs.entries()){const w=windows[i];r.interventionWindow={from:w.from!==undefined?new Date(w.from).toISOString():undefined,to:w.to!==undefined?new Date(w.to).toISOString():undefined,basis:w.basis};
  r.interventions=logStart!==undefined&&w.from!==undefined&&w.to!==undefined&&w.from>=logStart-DISPATCH_GRACE_MS?attribution.byRun.get(r.projectId)??0:undefined;}
 const allAttempts=runs.flatMap(r=>foldAttempts(loaded.get(r.projectId)!.records));
 const byFinal:Record<string,number>={};for(const r of runs){const k=r.final??(r.engine.state==="RUNNING"?"RUNNING":"NO_FINAL_STATUS");byFinal[k]=(byFinal[k]??0)+1;}
 const byKind:Record<string,number>={};for(const e of log.entries)byKind[e.kind]=(byKind[e.kind]??0)+1;
 let program:Scorecard["program"];
 if(options.programPath){try{program=Program.parse(JSON.parse(await readFile(options.programPath,"utf8")));}catch{program=undefined;}}
 const times=allAttempts.flatMap(a=>[a.startedAt,a.finishedAt].filter((x):x is string=>Boolean(x))).sort();
 return {
  generatedAt:new Date(now).toISOString(),stateDir:state.root,readOnly:true,catalogVersion:METRIC_CATALOG_VERSION,
  window:{since:sinceMs!==undefined?new Date(sinceMs).toISOString():undefined,until:untilMs!==undefined?new Date(untilMs).toISOString():undefined,firstActivity:times[0],lastActivity:times.at(-1)},checkout:options.checkout,program,
  totals:{projects:ids.length,runs:runs.length,byFinal,running:runs.filter(r=>r.engine.state==="RUNNING").length,attempts:allAttempts.length,makerTasks:runs.reduce((n,r)=>n+r.tasks.filter(t=>t.attempts>0).length,0)},
  runs,metrics:computeMetrics(runs,loaded,{exists:log.exists,since,unattributed:attribution.unattributed},now),
  interventions:{logExists:log.exists,since,total:log.entries.length,attributed:[...attribution.byRun.values()].reduce((a,b)=>a+b,0),unattributed:attribution.unattributed,unattributedReasons:attribution.reasons,unreadable:log.unreadable,byKind},
  coverage:{
   capacityPauses:runs.reduce((n,r)=>n+r.capacityPauses,0),
   unreadableLogLines:runs.reduce((n,r)=>n+loaded.get(r.projectId)!.unreadable,0),
   runsWithoutState:runs.filter(r=>!loaded.get(r.projectId)!.run).length,runsWithoutPlan:runs.filter(r=>!loaded.get(r.projectId)!.plan).length,
   unreadableRunFiles:runs.filter(r=>r.issues.some(i=>i.includes("unreadable")&&!i.includes("log line"))).length,
   attemptsWithoutFinish:allAttempts.filter(a=>a.status==="IN_FLIGHT").length,
   estimatedTokenAttempts:allAttempts.filter(a=>a.token.class==="estimated").length,unknownTokenAttempts:allAttempts.filter(a=>a.token.class==="unknown"&&a.status!=="IN_FLIGHT").length,
   provenanceRecorded:runs.filter(r=>r.planSource.basis==="recorded").length,versionRecorded:runs.filter(r=>r.companyVersion).length
  }
 };
}

export type BaselineClaim={id:string;claim:string;numerator:number|null;denominator:number|null;result:string;basis:string};
/** The historical audit's headline claims, recomputed from this state directory with the scorecard's own definitions. */
export function baselineClaims(card:Scorecard):BaselineClaim[]{
 const m=(id:string)=>card.metrics.find(x=>x.id===id)!;
 const fmt=(x:MetricResult)=>x.value===null?"UNKNOWN":x.numerator+"/"+x.denominator;
 const bypass=m("planner_bypass_rate"),lessons=m("lesson_injection_rate"),qa=m("qa_conflict_rate");
 const skillTotal=card.runs.reduce((n,r)=>n+Object.values(r.skillsSelected).reduce((a,b)=>a+b,0),0);
 return [
  {id:"C1",claim:"Most runs bypassed the company planner (plan supplied whole)",numerator:bypass.numerator,denominator:bypass.denominator,result:fmt(bypass),basis:bypass.coverage??""},
  {id:"C2",claim:"Prior lessons were not applied to plans",numerator:lessons.numerator,denominator:lessons.denominator,result:fmt(lessons)+" plans carry a lessons block",basis:"lessons header in persisted plans"},
  {id:"C3",claim:"QA FAIL/BLOCKED runs were reported ACCEPTED",numerator:qa.numerator,denominator:qa.denominator,result:fmt(qa),basis:"engine parseQa on QA task output; final.status"},
  {id:"C4",claim:"Maker agents lacked internal verification tools",numerator:null,denominator:null,result:"structural (code), not a runtime metric",basis:"claude-code provider runs the CLI with --tools \"\" (src/providers/claude-code.ts); agents cannot execute commands"},
  {id:"C5",claim:"Skill selection was not proven to improve outcomes",numerator:skillTotal,denominator:null,result:skillTotal+" skill selections recorded; 0 outcome measurements",basis:"skillTrace on execution records; no per-skill outcome exists"}
 ];
}

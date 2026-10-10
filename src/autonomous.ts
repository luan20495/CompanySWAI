import {ProjectPlan,type ProjectPlanValue} from "./project.js";
import {ProjectBrief,type ProjectBriefInput} from "./work-planner.js";
import {compileBriefToProjectPlan,type Learning} from "./plan-compiler.js";
import {estimateProject} from "./estimate.js";
import type {CapacityProfile} from "./capacity.js";
import {ProjectOrchestrator,type OrchestratorOptions,type ProjectRunSummary} from "./orchestrator.js";
import type {ProviderSelector} from "./provider-selector.js";
import {closeProject} from "./closeout.js";
import {computeFinalStatus} from "./final-status.js";
import {PHASES,hashOf,type FinalStatusValue,type Phase,type RunStateValue} from "./run-store.js";
import type {CompanyState} from "./state.js";

/**
 * One command from brief to retrospective. Every phase persists its result before the next starts, so a crash anywhere
 * resumes at the first unfinished phase; EXECUTE itself resumes task by task from the execution log.
 *   PLAN -> ESTIMATE -> APPROVAL -> EXECUTE -> FINALIZE -> RETROSPECTIVE -> DONE
 * (research, requirements, architecture, decomposition, implementation, review, revision, QA, gates and repo integration
 *  are the plan's tasks and run inside EXECUTE.)
 */
export type AutonomousInput={brief?:ProjectBriefInput;plan?:ProjectPlanValue};
export type AutonomousOptions={
 state:CompanyState;selector:ProviderSelector;dryRun?:boolean;
 /** Recompile a changed brief over an existing run instead of refusing. Finished tasks still count as finished. */
 replan?:boolean;
 /** Resume from the plan already persisted for this project: the supplied plan IS the stored one, so the input-change check is skipped. */
 resumeStored?:boolean;
 orchestrator?:OrchestratorOptions;
 approvalWait?:{pollMs:number;timeoutMs:number};
 knownRoles?:string[];knownSkills?:string[];
 /** Test hook: runs after each completed phase (throw to simulate a crash). */
 afterPhase?:(phase:Phase)=>void|Promise<void>;
};
export type AutonomousResult={
 projectId:string;phase:Phase;stopped?:string;plan:ProjectPlanValue;estimate?:ReturnType<typeof estimateProject>;
 summary?:ProjectRunSummary;final?:FinalStatusValue;notes:string[];
};
export const PROJECT_APPROVAL_KEY="project-approval";

export class PlanChangedError extends Error{constructor(projectId:string){super("The brief for '"+projectId+"' changed since the run started. Re-run with --replan to recompile it (finished tasks stay finished), or restore the original brief.");this.name="PlanChangedError";}}

export async function runAutonomous(input:AutonomousInput,options:AutonomousOptions):Promise<AutonomousResult>{
 const {state}=options,runs=state.runs;
 if(!input.brief&&!input.plan)throw new Error("runAutonomous needs a brief or a plan");
 const asBrief=input.brief?ProjectBrief.parse(input.brief):undefined,givenPlan=input.plan?ProjectPlan.parse(input.plan):undefined;
 const projectId=(asBrief??givenPlan!).projectId;
 const inputHash=hashOf(asBrief??givenPlan);
 let run=await runs.load(projectId);
 const done=(phase:Phase)=>run?.completedPhases.includes(phase)??false;
 const complete=async(phase:Phase)=>{
  run={...run!,completedPhases:[...new Set([...run!.completedPhases,phase])],phase:PHASES[Math.min(PHASES.indexOf(phase)+1,PHASES.length-1)]};
  run=await runs.save(run);
  await options.afterPhase?.(phase);
 };
 const stop=async(phase:Phase,reason:string)=>{run=await runs.save({...run!,phase,stopped:reason});return reason;};

 // ---------------------------------------------------------------- PLAN
 let plan=await runs.loadPlan(projectId);
 if(run&&plan&&run.briefHash&&run.briefHash!==inputHash&&!options.replan&&!options.resumeStored)throw new PlanChangedError(projectId);
 if(!run||!plan||(options.replan&&run.briefHash!==inputHash)){
  if(asBrief){
   const prior=await state.retrospectives.load(projectId);
   const learning:Learning={projectLessons:prior?.lessons,experience:await state.experience.validatedLessons()};
   plan=await compileBriefToProjectPlan(asBrief,learning);
  }else plan=givenPlan!;
  await runs.savePlan(plan);
  const now=new Date().toISOString();
  run=await runs.save({version:1,projectId,planHash:hashOf(plan),briefHash:inputHash,completedPhases:[],phase:"PLAN",startedAt:run?.startedAt??now,updatedAt:now,notes:[]});
  await state.memory.recordStatus(projectId,"autonomous","PLAN","compiled "+plan.tasks.length+" task(s), mode "+plan.mode);
 }
 const notes=run!.notes;
 if(!done("PLAN"))await complete("PLAN");
 const settled=plan!;

 // ---------------------------------------------------------------- ESTIMATE
 let estimate=run!.estimate as ReturnType<typeof estimateProject>|undefined;
 if(!done("ESTIMATE")){
  const profiles:CapacityProfile[]|undefined=options.selector.snapshot?.();
  if(profiles?.length){
   estimate=estimateProject(settled,profiles);
   run=await runs.save({...run!,estimate});
   if(estimate.blockedTasks.length)notes.push("estimate: no provider can currently serve "+estimate.blockedTasks.map(b=>b.taskId).join(", ")+"; those tasks will pause until capacity exists");
   if(estimate.budget.limit!=null&&estimate.unknownCostTasks.length===0&&estimate.totalKnownCost>estimate.budget.limit){
    run=await runs.save({...run!,notes});
    const reason="estimated cost "+estimate.totalKnownCost.toFixed(4)+" exceeds the project budget "+estimate.budget.limit;
    await stop("ESTIMATE",reason);await state.memory.recordStatus(projectId,"autonomous","BLOCKED_BUDGET",reason);
    return {projectId,phase:"ESTIMATE",stopped:reason,plan:settled,estimate,notes};
   }
  }else notes.push("estimate skipped: the provider selector exposes no capacity profiles");
  run=await runs.save({...run!,notes});
  await complete("ESTIMATE");
 }

 // ---------------------------------------------------------------- APPROVAL
 if(!done("APPROVAL")){
  const threshold=settled.budget.projectApprovalThreshold,cost=estimate?.totalKnownCost;
  if(threshold!=null&&cost!=null&&cost>threshold){
   const approvals=state.approvals;
   await approvals.request(projectId,PROJECT_APPROVAL_KEY,cost);
   await state.memory.recordStatus(projectId,"autonomous","APPROVAL_REQUIRED","estimated project cost "+cost.toFixed(4)+" exceeds the approval threshold "+threshold);
   let approved=await approvals.covers(projectId,PROJECT_APPROVAL_KEY,cost);
   const wait=options.approvalWait;
   if(!approved&&wait){
    const deadline=Date.now()+wait.timeoutMs;
    while(!approved&&Date.now()<=deadline){await new Promise(r=>setTimeout(r,wait.pollMs));approved=await approvals.covers(projectId,PROJECT_APPROVAL_KEY,cost);}
   }
   if(!approved){
    const reason="project approval required for estimated cost "+cost.toFixed(4)+" (npm run approve -- "+projectId+" "+PROJECT_APPROVAL_KEY+")";
    await stop("APPROVAL",reason);
    return {projectId,phase:"APPROVAL",stopped:reason,plan:settled,estimate,notes};
   }
  }
  run=await runs.save({...run!,stopped:undefined});
  await complete("APPROVAL");
 }

 // ---------------------------------------------------------------- EXECUTE
 const orchestrator=()=>new ProjectOrchestrator(options.selector,state,{...options.orchestrator,approvalWait:options.approvalWait??options.orchestrator?.approvalWait});
 // After EXECUTE finished earlier this is a cheap pass that skips every completed task and keeps the summary current.
 const summary=await orchestrator().run(settled);
 const parked=Boolean(summary.paused.length||summary.approvalRequired.length||summary.waiting.length||summary.failed.length);
 if(parked)run=await runs.save({...run!,phase:"EXECUTE",stopped:summary.stopped?"stopped by operator: "+summary.stopped:undefined});
 else{
  if(run!.stopped)run=await runs.save({...run!,stopped:undefined});
  if(!done("EXECUTE"))await complete("EXECUTE");
 }

 // ---------------------------------------------------------------- FINALIZE
 const records=await state.executions.list(projectId),trace=await state.traceability.load(projectId);
 const computed=computeFinalStatus(settled,summary,records,trace),final=summary.stopped?{...computed,reasons:["stopped by operator: "+summary.stopped,...computed.reasons]}:computed;
 await state.memory.upsert(projectId,"STATUS.md","final","FINAL STATUS — "+final.status,[...final.reasons.map(r=>"- "+r),...(final.risks.length?["","Risks:",...final.risks.map(r=>"- "+r)]:[]),"","QA: "+final.qa.status].join("\n"));
 run=await runs.save({...run!,final});
 if(!parked&&!done("FINALIZE"))await complete("FINALIZE");

 // ---------------------------------------------------------------- RETROSPECTIVE
 // The retrospective is rewritten on every pass, but the company only learns from a project once, when it finishes.
 await closeProject(state,summary,{dryRun:options.dryRun,knownRoles:options.knownRoles,knownSkills:options.knownSkills,plan:settled,observe:!parked&&!done("RETROSPECTIVE")});
 if(!parked&&!done("RETROSPECTIVE"))await complete("RETROSPECTIVE");
 if(!parked&&!done("DONE"))await complete("DONE");
 return {projectId,phase:run!.phase,stopped:summary.stopped,plan:settled,estimate,summary,final,notes:run!.notes};
}
export type {RunStateValue};

export type SuperviseOptions={
 /** Give up after this long in total (default 6 hours). */
 maxWaitMs?:number;
 /** First and largest pause between resumes; the pause doubles after every parked pass. */
 minPauseMs?:number;maxPauseMs?:number;
 sleep?:(ms:number)=>Promise<void>;now?:()=>number;
 onPass?:(result:AutonomousResult,pass:number)=>void;
};
/**
 * Unattended operation: run the pipeline, and while it is only parked for capacity (providers rate limited, out of quota,
 * temporarily unavailable) wait with backoff and resume. Failures, QA outcomes and approvals are never retried blindly:
 * those need a person, so the loop returns them.
 */
export async function superviseAutonomous(run:()=>Promise<AutonomousResult>,options:SuperviseOptions={}):Promise<AutonomousResult>{
 const sleep=options.sleep??(ms=>new Promise<void>(resolve=>setTimeout(resolve,ms))),now=options.now??Date.now,deadline=now()+(options.maxWaitMs??6*3600_000);
 let pause=options.minPauseMs??30_000,pass=0;
 for(;;){
  const result=await run();pass++;options.onPass?.(result,pass);
  const waitingForCapacity=result.summary&&result.summary.paused.length>0&&result.summary.failed.length===0&&result.summary.approvalRequired.length===0;
  if(!waitingForCapacity||result.stopped||now()+pause>deadline)return result;
  await sleep(pause);pause=Math.min(pause*2,options.maxPauseMs??600_000);
 }
}

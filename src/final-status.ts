import type {ExecutionRecordValue} from "./execution-record.js";
import type {ProjectRunSummary} from "./orchestrator.js";
import type {FinalStatusValue} from "./run-store.js";
import type {ProjectPlanValue} from "./project.js";
import type {TraceValue} from "./traceability.js";

/**
 * The project-level verdict, derived only from persisted facts. ACCEPTED means: every task is done, every review passed,
 * QA did not fail or block (when a QA gate applies), and nothing was left unverified. Anything weaker says exactly why.
 */
export function computeFinalStatus(plan:ProjectPlanValue,summary:Pick<ProjectRunSummary,"completed"|"failed"|"paused"|"waiting"|"approvalRequired"|"disagreements">,records:ExecutionRecordValue[],trace:TraceValue,now=new Date()):FinalStatusValue{
 const tasks={completed:summary.completed.length,failed:summary.failed.length,paused:summary.paused.length,waiting:summary.waiting.length,approvalRequired:summary.approvalRequired.length};
 const qaTask=plan.tasks.some(t=>t.contract.validators.includes("qa-traceability")),highRisk=plan.tasks.some(t=>t.review?.level==="HIGH_RISK");
 const qaStatus=trace.qa?.overall??"NOT_RUN",reasons:string[]=[],risks:string[]=[];
 const base={tasks,qa:{status:qaStatus,required:highRisk},at:now.toISOString()};
 if(summary.failed.length)return {...base,status:"FAILED",reasons:["tasks failed: "+summary.failed.join(", ")],risks};
 if(summary.paused.length||summary.approvalRequired.length||summary.waiting.length){
  if(summary.paused.length)reasons.push("waiting for provider capacity: "+summary.paused.join(", "));
  if(summary.approvalRequired.length)reasons.push("waiting for approval: "+summary.approvalRequired.join(", "));
  if(summary.waiting.length)reasons.push("blocked behind unfinished work: "+summary.waiting.join(", "));
  return {...base,status:"PARKED",reasons,risks};
 }
 if(qaStatus==="FAIL")return {...base,status:"FAILED_QA",reasons:["QA reported FAIL for at least one requirement"],risks};
 if(qaStatus==="BLOCKED")return {...base,status:"BLOCKED",reasons:["QA is BLOCKED: tests could not be run for at least one requirement"],risks};
 if(highRisk&&(qaStatus==="NOT_RUN"||!qaTask))return {...base,status:"INCOMPLETE",reasons:["a HIGH_RISK review level requires a passing QA gate, but QA did not run"],risks};
 const assumptions=trace.requirements.filter(r=>r.basis==="ASSUMPTION").length;
 if(assumptions)risks.push(assumptions+" requirement(s) rest on unconfirmed assumptions");
 for(const arch of trace.architecture)for(const risk of arch.unresolvedRisks)risks.push("architecture: "+risk);
 if(summary.disagreements)risks.push(summary.disagreements+" reviewer disagreement(s) were reconciled by revision");
 if(plan.tasks.some(t=>t.deliversCode)&&!plan.workspace)risks.push("code deliverables were not verified by deterministic gates (no workspace configured)");
 if(plan.tasks.some(t=>t.deliversCode)&&plan.workspace){
  const unverified=plan.tasks.filter(t=>t.deliversCode&&!records.some(r=>r.taskId===t.id&&r.status==="SUCCEEDED"&&r.gates.some(g=>g.status==="PASS")));
  if(unverified.length)risks.push("no passing gate evidence for "+unverified.map(t=>t.id).join(", "));
 }
 const shortfall=records.filter(r=>r.status==="SUCCEEDED"&&r.evidence.some(e=>/quality tier/i.test(e))).length;
 if(shortfall)risks.push(shortfall+" step(s) ran below the requested provider quality tier");
 if(qaTask&&qaStatus==="NOT_APPLICABLE")risks.push("QA classified every requirement NOT_APPLICABLE");
 return {...base,status:risks.length?"ACCEPTED_WITH_RISKS":"ACCEPTED",reasons:["every task completed and reviewed"+(qaStatus==="PASS"?"; QA passed":"")],risks};
}

import type {z} from "zod";
import type {ExecutionRecordValue} from "./execution-record.js";
import type {BudgetPolicyObject} from "./project.js";
import {BudgetExceededError} from "./errors.js";

export type BudgetPolicy=Partial<z.input<typeof BudgetPolicyObject>>;
export type BudgetContext={taskId:string;department:string;agentRole:string};
/** Cost reserved by a model call that has been admitted but has not produced a record yet. */
export type InFlightCost=BudgetContext&{estimatedCost:number};

export class ApprovalRequiredError extends Error{
 readonly code="APPROVAL_REQUIRED";
 constructor(readonly estimatedCost:number){super("Approval required for estimated task cost "+estimatedCost.toFixed(6));this.name="ApprovalRequiredError";}
}

/** Review executions are accounted to the task they review. */
export const baseTaskId=(taskId:string)=>taskId.replace(/--review-\d+$/,"");
/**
 * Money is spent once a model call returned. Each execution id counts once, through its latest
 * record that carries usage (CHECKPOINTED, then SUCCEEDED, or FAILED when finalization failed).
 */
export function settledRecords(records:ExecutionRecordValue[]){
 const latest=new Map<string,ExecutionRecordValue>();
 for(const r of records)if((r.status==="CHECKPOINTED"||r.status==="SUCCEEDED"||r.status==="FAILED")&&(r.actualCost!=null||r.inputTokens+r.outputTokens>0))latest.set(r.id,r);
 return [...latest.values()];
}
const sum=(rows:ExecutionRecordValue[])=>rows.reduce((total,record)=>total+(record.actualCost??0),0);
const hasLimits=(policy:BudgetPolicy)=>policy.maxProjectCost!=null||policy.maxTaskCost!=null||policy.approvalThreshold!=null||Object.keys(policy.maxTeamCost??{}).length>0||Object.keys(policy.maxAgentCost??{}).length>0;

export function assertBudget(policy:BudgetPolicy,records:ExecutionRecordValue[],context:BudgetContext,estimatedCost?:number,approved=false,inFlight:InFlightCost[]=[]){
 if(estimatedCost==null){
  if(hasLimits(policy))throw new BudgetExceededError("Cost of the selected provider profile is unknown while budget limits are configured; set inputCostPerMillion/outputCostPerMillion on the profile");
  return;
 }
 const rows=settledRecords(records),reserved=(pick:(item:InFlightCost)=>boolean)=>inFlight.filter(pick).reduce((total,item)=>total+item.estimatedCost,0);
 const projectSpent=sum(rows)+reserved(()=>true);
 const taskSpent=sum(rows.filter(r=>baseTaskId(r.taskId)===baseTaskId(context.taskId)))+reserved(item=>baseTaskId(item.taskId)===baseTaskId(context.taskId));
 const teamSpent=sum(rows.filter(r=>r.department===context.department))+reserved(item=>item.department===context.department);
 const agentSpent=sum(rows.filter(r=>r.agentRole===context.agentRole))+reserved(item=>item.agentRole===context.agentRole);
 if(policy.maxProjectCost!=null&&projectSpent+estimatedCost>policy.maxProjectCost)throw new BudgetExceededError("Project budget exceeded");
 if(policy.maxTaskCost!=null&&taskSpent+estimatedCost>policy.maxTaskCost)throw new BudgetExceededError("Task budget exceeded: "+context.taskId);
 const teamLimit=policy.maxTeamCost?.[context.department];if(teamLimit!=null&&teamSpent+estimatedCost>teamLimit)throw new BudgetExceededError("Team budget exceeded: "+context.department);
 const agentLimit=policy.maxAgentCost?.[context.agentRole];if(agentLimit!=null&&agentSpent+estimatedCost>agentLimit)throw new BudgetExceededError("Agent budget exceeded: "+context.agentRole);
 if(!approved&&policy.approvalThreshold!=null&&estimatedCost>policy.approvalThreshold)throw new ApprovalRequiredError(estimatedCost);
}

export type BudgetLine={limit?:number;estimated:number;actual:number;runs:number;/** runs on subscription-billed profiles: counted in runs, absent from the money totals */subscriptionRuns:number;utilization?:number};
export type BudgetReport={project:BudgetLine;departments:Record<string,BudgetLine>;tasks:Record<string,BudgetLine>;agents:Record<string,BudgetLine>};
const line=(rows:ExecutionRecordValue[],limit?:number):BudgetLine=>{
 const estimated=rows.reduce((t,r)=>t+(r.estimatedCost??0),0),actual=sum(rows);
 return {limit,estimated,actual,runs:rows.length,subscriptionRuns:rows.filter(r=>r.billing==="subscription").length,...(limit?{utilization:actual/limit}:{})};
};
const group=(rows:ExecutionRecordValue[],by:(r:ExecutionRecordValue)=>string,limits:Record<string,number>={})=>{
 const out:Record<string,BudgetLine>={},keys=[...new Set(rows.map(by))].sort();
 for(const key of keys)out[key]=line(rows.filter(r=>by(r)===key),limits[key]);
 return out;
};
/** Estimate versus actual spend at project, department, task and agent level, next to the configured limits. */
export function budgetReport(policy:BudgetPolicy,records:ExecutionRecordValue[]):BudgetReport{
 const rows=settledRecords(records);
 return {
  project:line(rows,policy.maxProjectCost),
  departments:group(rows,r=>r.department,policy.maxTeamCost),
  tasks:group(rows,r=>baseTaskId(r.taskId),{}),
  agents:group(rows,r=>r.agentRole,policy.maxAgentCost)
 };
}

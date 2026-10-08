import type {ExecutionRecordValue} from "./execution-record.js";
import {BudgetExceededError} from "./errors.js";

export type BudgetPolicy={
 maxProjectCost?:number;maxTaskCost?:number;maxTeamCost?:Record<string,number>;maxAgentCost?:Record<string,number>;approvalThreshold?:number;
};
export type BudgetContext={taskId:string;department:string;agentRole:string};

export class ApprovalRequiredError extends Error{
 readonly code="APPROVAL_REQUIRED";
 constructor(readonly estimatedCost:number){super("Approval required for estimated task cost "+estimatedCost.toFixed(6));this.name="ApprovalRequiredError";}
}
const successful=(records:ExecutionRecordValue[])=>records.filter(record=>record.status==="SUCCEEDED");
const sum=(records:ExecutionRecordValue[])=>records.reduce((total,record)=>total+(record.actualCost??0),0);
export function spentCost(records:ExecutionRecordValue[],taskId?:string){
 const rows=successful(records);return sum(taskId?rows.filter(r=>r.taskId===taskId||r.taskId.startsWith(taskId+"--review-")):rows);
}
export function assertBudget(policy:BudgetPolicy,records:ExecutionRecordValue[],context:BudgetContext,estimatedCost?:number,approved=false){
 if(estimatedCost==null)return;
 const rows=successful(records),projectSpent=sum(rows),taskSpent=sum(rows.filter(r=>r.taskId===context.taskId||r.taskId.startsWith(context.taskId+"--review-"))),teamSpent=sum(rows.filter(r=>r.department===context.department)),agentSpent=sum(rows.filter(r=>r.agentRole===context.agentRole));
 if(policy.maxProjectCost!=null&&projectSpent+estimatedCost>policy.maxProjectCost)throw new BudgetExceededError("Project budget exceeded");
 if(policy.maxTaskCost!=null&&taskSpent+estimatedCost>policy.maxTaskCost)throw new BudgetExceededError("Task budget exceeded: "+context.taskId);
 const teamLimit=policy.maxTeamCost?.[context.department];if(teamLimit!=null&&teamSpent+estimatedCost>teamLimit)throw new BudgetExceededError("Team budget exceeded: "+context.department);
 const agentLimit=policy.maxAgentCost?.[context.agentRole];if(agentLimit!=null&&agentSpent+estimatedCost>agentLimit)throw new BudgetExceededError("Agent budget exceeded: "+context.agentRole);
 if(!approved&&policy.approvalThreshold!=null&&estimatedCost>policy.approvalThreshold)throw new ApprovalRequiredError(estimatedCost);
}

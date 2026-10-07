import type {ExecutionRecordValue} from "./execution-record.js";

export type BudgetPolicy={
 maxProjectCost?:number;
 maxTaskCost?:number;
 approvalThreshold?:number;
};

export function spentCost(records:ExecutionRecordValue[],taskId?:string){
 return records
  .filter(record=>record.status==="SUCCEEDED"&&(!taskId||record.taskId===taskId))
  .reduce((sum,record)=>sum+(record.actualCost??0),0);
}

export function assertBudget(policy:BudgetPolicy,records:ExecutionRecordValue[],taskId:string,estimatedCost?:number){
 if(estimatedCost==null)return;
 const projectSpent=spentCost(records);
 const taskSpent=spentCost(records,taskId);
 if(policy.maxProjectCost!=null&&projectSpent+estimatedCost>policy.maxProjectCost){
  throw new Error("Project budget exceeded");
 }
 if(policy.maxTaskCost!=null&&taskSpent+estimatedCost>policy.maxTaskCost){
  throw new Error("Task budget exceeded: "+taskId);
 }
 if(policy.approvalThreshold!=null&&estimatedCost>policy.approvalThreshold){
  throw new Error("Approval required for estimated task cost "+estimatedCost.toFixed(6));
 }
}

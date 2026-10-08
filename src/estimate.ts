import type {CapacityProfile,TaskDemand} from "./capacity.js";
import {estimateCost,routeTask} from "./capacity.js";
import type {ProjectPlanValue} from "./project.js";

/** "subscription": billed by plan, no per-token price (cost is n/a, not $0). "unknown": metered but the profile has no prices. */
export type CostBasis="metered"|"subscription"|"unknown";
export type TaskEstimate={taskId:string;agentRole:string;provider?:string;model?:string;profileId?:string;tokens:number;cost?:number;costBasis:CostBasis;seconds?:number;confidence:"HIGH"|"MEDIUM"|"LOW";issues:string[]};
function demand(task:ProjectPlanValue["tasks"][number]):TaskDemand{return {capabilities:task.capabilities,estimatedInputTokens:task.estimatedInputTokens,estimatedOutputTokens:task.estimatedOutputTokens,maxCost:task.maxCost,minContextWindow:task.minContextWindow};}
function diagnose(profiles:CapacityProfile[],d:TaskDemand){
 const issues:string[]=[];if(!profiles.some(p=>p.state==="AVAILABLE"||p.state==="QUOTA_LOW"))issues.push("No provider profile is currently available.");
 if(!profiles.some(p=>d.capabilities.every(c=>p.capabilities.includes(c))))issues.push("No provider profile exposes all required capabilities: "+d.capabilities.join(", "));
 if(!profiles.some(p=>(d.minContextWindow??0)<=p.contextWindow))issues.push("Configured context windows are too small.");
 const total=d.estimatedInputTokens+d.estimatedOutputTokens;if(profiles.every(p=>p.tokenQuotaRemaining!=null&&p.tokenQuotaRemaining<total))issues.push("Configured token quota is insufficient; reduce work, add capacity or wait for reset.");
 if(!issues.length)issues.push("Profiles exist but current state, budget, credit or quota constraints prevent routing.");
 return issues;
}
export function estimateProject(plan:ProjectPlanValue,profiles:CapacityProfile[]){
 const taskEstimates:TaskEstimate[]=plan.tasks.map(task=>{
  const d=demand(task),selected=task.provider&&task.model?routeTask(profiles.filter(p=>p.provider===task.provider&&p.model===task.model),d):routeTask(profiles,d);
  if(!selected)return {taskId:task.id,agentRole:task.agentRole,tokens:d.estimatedInputTokens+d.estimatedOutputTokens,costBasis:"unknown",confidence:"LOW",issues:diagnose(profiles,d)};
  const cost=estimateCost(selected,d),seconds=selected.estimatedTokensPerSecond?(d.estimatedInputTokens+d.estimatedOutputTokens)/selected.estimatedTokensPerSecond:undefined;
  const costBasis:CostBasis=selected.billing==="subscription"?"subscription":cost!=null?"metered":"unknown",priced=costBasis!=="unknown";
  const confidence=priced&&seconds!=null?"HIGH":priced||seconds!=null?"MEDIUM":"LOW";
  return {taskId:task.id,agentRole:task.agentRole,provider:selected.provider,model:selected.model,profileId:selected.id,tokens:d.estimatedInputTokens+d.estimatedOutputTokens,cost,costBasis,seconds,confidence,issues:[]};
 });
 const byId=new Map(taskEstimates.map(x=>[x.taskId,x])),duration=new Map<string,number>();
 const critical=(id:string):number=>{if(duration.has(id))return duration.get(id)!;const task=plan.tasks.find(t=>t.id===id)!;const own=byId.get(id)?.seconds??0,dep=Math.max(0,...task.dependencies.map(critical));const total=dep+own;duration.set(id,total);return total;};
 const criticalPathSeconds=Math.max(0,...plan.tasks.map(t=>critical(t.id)));
 const knownCosts=taskEstimates.filter(x=>x.cost!=null),totalKnownCost=knownCosts.reduce((s,x)=>s+(x.cost??0),0),unknownCostTasks=taskEstimates.filter(x=>x.costBasis==="unknown").map(x=>x.taskId),subscriptionTasks=taskEstimates.filter(x=>x.costBasis==="subscription").map(x=>x.taskId);
 const modelMix=Object.values(taskEstimates.reduce<Record<string,{provider:string;model:string;profileId?:string;costBasis:CostBasis;tasks:number}>>((acc,x)=>{if(!x.provider||!x.model)return acc;const k=x.profileId??x.provider+"/"+x.model;acc[k]??={provider:x.provider,model:x.model,profileId:x.profileId,costBasis:x.costBasis,tasks:0};acc[k].tasks++;return acc;},{}));
 const confidence=taskEstimates.some(x=>x.confidence==="LOW")?"LOW":taskEstimates.some(x=>x.confidence==="MEDIUM")?"MEDIUM":"HIGH";
 const limit=plan.budget.maxProjectCost,budget={limit,withinBudget:limit==null||(unknownCostTasks.length===0&&totalKnownCost<=limit),...(subscriptionTasks.length?{note:subscriptionTasks.length+" task(s) run on subscription-billed profiles: they have no per-token price and are not covered by money budgets"}:{})};
 return {projectId:plan.projectId,budget,totalEstimatedTokens:taskEstimates.reduce((s,x)=>s+x.tokens,0),totalKnownCost,unknownCostTasks,subscriptionTasks,criticalPathSeconds:taskEstimates.every(x=>x.seconds!=null)?criticalPathSeconds:undefined,confidence,modelMix,tasks:taskEstimates,blockedTasks:taskEstimates.filter(x=>!x.provider).map(x=>({taskId:x.taskId,issues:x.issues}))};
}

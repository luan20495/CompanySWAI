import type {TaskDemand,CapacityProfile} from "./capacity.js";
import {routeTask} from "./capacity.js";

export type WorkStatus="READY"|"DOING"|"REVIEW"|"BLOCKED"|"PAUSED_CAPACITY"|"DONE";
export type WorkItem={id:string;dependencies:string[];status:WorkStatus;demand:TaskDemand;provider?:string;model?:string};

export function readyWork(items:WorkItem[]){
 const done=new Set(items.filter(item=>item.status==="DONE").map(item=>item.id));
 return items.filter(item=>item.status==="READY"&&item.dependencies.every(dep=>done.has(dep)));
}

export function assignReadyWork(items:WorkItem[],providers:CapacityProfile[]){
 return readyWork(items).map(item=>{
  const selected=routeTask(providers,item.demand);
  if(!selected)return {...item,status:"PAUSED_CAPACITY" as const};
  return {...item,provider:selected.provider,model:selected.model};
 });
}

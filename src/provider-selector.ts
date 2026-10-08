import type {ModelProvider} from "./provider.js";
import type {CapacityProfile,TaskDemand,ProviderState} from "./capacity.js";
import {eligible,estimateCost,routeTask} from "./capacity.js";
import {CapacityUnavailableError} from "./errors.js";

export type ProviderSelectionRequest={preferredProvider?:string;preferredModel?:string;demand:TaskDemand;exclude?:Array<{provider:string;model:string;profileId?:string}>;};
export type ProviderSelection={provider:ModelProvider;profile:CapacityProfile;estimatedCost?:number;reservedTokens?:number;reservedCost?:number;};
export type UsageReport={inputTokens:number;outputTokens:number;actualCost?:number};
export type ProviderSelector=((request:ProviderSelectionRequest)=>ProviderSelection)&{reportSuccess?:(selection:ProviderSelection,usage:UsageReport)=>void;reportFailure?:(selection:ProviderSelection,error:unknown)=>void;snapshot?:()=>CapacityProfile[];};
export type ProviderInstantiator=(provider:string,model:string,profile?:CapacityProfile)=>ModelProvider;

const key=(p:{provider:string;model:string;id?:string;profileId?:string})=>p.profileId??p.id??(p.provider+"\n"+p.model);
const classify=(error:unknown):ProviderState|undefined=>{const text=error instanceof Error?error.message.toLowerCase():String(error).toLowerCase();if(/out.?of.?credit|insufficient.?credit|billing/.test(text))return "OUT_OF_CREDIT";if(/quota/.test(text))return "QUOTA_LOW";if(/429|rate.?limit|overloaded|capacity/.test(text))return "RATE_LIMITED";return undefined;};

export function createCapacitySelector(profiles:CapacityProfile[],instantiate:ProviderInstantiator):ProviderSelector{
 const state=profiles.map((p,index)=>({...p,id:p.id??p.provider+"-"+p.model.replace(/[^A-Za-z0-9._-]/g,"-")+"-"+index}));
 const find=(selection:ProviderSelection)=>state.find(p=>key(p)===key(selection.profile));
 const selector=((request:ProviderSelectionRequest)=>{
  const excluded=new Set((request.exclude??[]).map(key));
  const filtered=state.filter(profile=>!excluded.has(key(profile))&&(!request.preferredProvider||profile.provider===request.preferredProvider)&&(!request.preferredModel||profile.model===request.preferredModel));
  const selected=request.preferredProvider&&request.preferredModel?routeTask(filtered,request.demand):routeTask(filtered,request.demand);
  if(!selected){const preference=request.preferredProvider?request.preferredProvider+"/"+request.preferredModel:"automatic routing";throw new CapacityUnavailableError("No eligible provider capacity for "+preference);}
  const reservedTokens=request.demand.estimatedInputTokens+request.demand.estimatedOutputTokens,reservedCost=estimateCost(selected,request.demand);
  if(selected.tokenQuotaRemaining!=null)selected.tokenQuotaRemaining=Math.max(0,selected.tokenQuotaRemaining-reservedTokens);
  if(selected.creditRemaining!=null&&reservedCost!=null)selected.creditRemaining=Math.max(0,selected.creditRemaining-reservedCost);
  return {provider:instantiate(selected.provider,selected.model,selected),profile:{...selected},estimatedCost:reservedCost,reservedTokens,reservedCost};
 }) as ProviderSelector;
 selector.reportSuccess=(selection,usage)=>{const profile=find(selection);if(!profile)return;const actualTokens=usage.inputTokens+usage.outputTokens,tokenDelta=(selection.reservedTokens??0)-actualTokens;if(profile.tokenQuotaRemaining!=null)profile.tokenQuotaRemaining=Math.max(0,profile.tokenQuotaRemaining+tokenDelta);if(profile.creditRemaining!=null&&selection.reservedCost!=null&&usage.actualCost!=null)profile.creditRemaining=Math.max(0,profile.creditRemaining+(selection.reservedCost-usage.actualCost));};
 selector.reportFailure=(selection,error)=>{const profile=find(selection),next=classify(error);if(profile&&next)profile.state=next;};
 selector.snapshot=()=>state.map(p=>({...p}));
 return selector;
}

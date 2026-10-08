import type {ModelProvider} from "./provider.js";
import type {CapacityProfile,TaskDemand,ProviderState} from "./capacity.js";
import {estimateCost,routeTask} from "./capacity.js";
import {CapacityUnavailableError} from "./errors.js";

export type ProviderSelectionRequest={preferredProvider?:string;preferredModel?:string;demand:TaskDemand;exclude?:Array<{provider:string;model:string;profileId?:string}>;};
export type ProviderSelection={provider:ModelProvider;profile:CapacityProfile;estimatedCost?:number;reservedTokens?:number;reservedCost?:number;};
export type UsageReport={inputTokens:number;outputTokens:number;actualCost?:number};
/**
 * A selection reserves token quota, credit and one concurrency slot on its profile.
 * Every selection must be settled exactly once through reportSuccess, reportFailure or release.
 */
export type ProviderSelector=((request:ProviderSelectionRequest)=>ProviderSelection)&{
 reportSuccess?:(selection:ProviderSelection,usage:UsageReport)=>void;
 reportFailure?:(selection:ProviderSelection,error:unknown)=>void;
 release?:(selection:ProviderSelection)=>void;
 snapshot?:()=>CapacityProfile[];
};
export type ProviderInstantiator=(provider:string,model:string,profile?:CapacityProfile)=>ModelProvider;
export type SelectorOptions={now?:()=>number;cooldownMs?:number;unavailableCooldownMs?:number};

export type ProviderFailure={state:ProviderState;cooldown:"rate"|"unavailable"|"none"};
/** Maps a provider error to the capacity state it implies, or undefined when it is not a capacity/availability failure. */
export function classifyProviderError(error:unknown):ProviderFailure|undefined{
 if(error instanceof CapacityUnavailableError)return {state:"RATE_LIMITED",cooldown:"none"};
 const text=(error instanceof Error?error.message:String(error)).toLowerCase();
 if(/out.?of.?credit|insufficient.?credit|billing|payment required|\b402\b/.test(text))return {state:"OUT_OF_CREDIT",cooldown:"none"};
 if(/quota|\b429\b|rate.?limit|overloaded|capacity/.test(text))return {state:"RATE_LIMITED",cooldown:"rate"};
 if(/\b50[0234]\b|timeout|timed out|econnreset|econnrefused|enotfound|fetch failed|network|socket hang up/.test(text))return {state:"UNAVAILABLE",cooldown:"unavailable"};
 return undefined;
}
export const isProviderFailure=(error:unknown)=>classifyProviderError(error)!==undefined;

const key=(p:{provider:string;model:string;id?:string;profileId?:string})=>p.profileId??p.id??(p.provider+"\n"+p.model);

export function createCapacitySelector(profiles:CapacityProfile[],instantiate:ProviderInstantiator,options:SelectorOptions={}):ProviderSelector{
 const now=options.now??Date.now,rateCooldown=options.cooldownMs??60_000,unavailableCooldown=options.unavailableCooldownMs??15_000;
 const state=profiles.map((p,index)=>({...p,id:p.id??p.provider+"-"+p.model.replace(/[^A-Za-z0-9._-]/g,"-")+"-"+index}));
 const inFlight=new Map<string,number>(),settled=new WeakSet<ProviderSelection>();
 const find=(selection:ProviderSelection)=>state.find(p=>key(p)===key(selection.profile));
 const active=(p:CapacityProfile)=>inFlight.get(key(p))??0;
 const settle=(selection:ProviderSelection,reconcile:(profile:CapacityProfile)=>void)=>{
  if(settled.has(selection))return;settled.add(selection);
  const profile=find(selection);if(!profile)return;
  inFlight.set(key(profile),Math.max(0,active(profile)-1));
  reconcile(profile);
 };
 const returnReservation=(profile:CapacityProfile,selection:ProviderSelection)=>{
  if(profile.tokenQuotaRemaining!=null)profile.tokenQuotaRemaining+=selection.reservedTokens??0;
  if(profile.creditRemaining!=null&&selection.reservedCost!=null)profile.creditRemaining+=selection.reservedCost;
 };
 const selector=((request:ProviderSelectionRequest)=>{
  const excluded=new Set((request.exclude??[]).map(key)),at=now();
  const filtered=state.filter(profile=>!excluded.has(key(profile))&&(!request.preferredProvider||profile.provider===request.preferredProvider)&&(!request.preferredModel||profile.model===request.preferredModel));
  // Capacity aware: prefer profiles with a free concurrency slot, queue on a saturated one only when nothing else can serve.
  const free=filtered.filter(profile=>active(profile)<profile.maxConcurrency);
  const selected=routeTask(free,request.demand,at)??routeTask(filtered,request.demand,at);
  if(!selected){const preference=request.preferredProvider?request.preferredProvider+"/"+request.preferredModel:"automatic routing";throw new CapacityUnavailableError("No eligible provider capacity for "+preference);}
  const reservedTokens=request.demand.estimatedInputTokens+request.demand.estimatedOutputTokens,reservedCost=estimateCost(selected,request.demand);
  if(selected.tokenQuotaRemaining!=null)selected.tokenQuotaRemaining=Math.max(0,selected.tokenQuotaRemaining-reservedTokens);
  if(selected.creditRemaining!=null&&reservedCost!=null)selected.creditRemaining=Math.max(0,selected.creditRemaining-reservedCost);
  inFlight.set(key(selected),active(selected)+1);
  return {provider:instantiate(selected.provider,selected.model,selected),profile:{...selected},estimatedCost:reservedCost,reservedTokens,reservedCost};
 }) as ProviderSelector;
 selector.reportSuccess=(selection,usage)=>settle(selection,profile=>{
  const actualTokens=usage.inputTokens+usage.outputTokens,tokenDelta=(selection.reservedTokens??0)-actualTokens;
  if(profile.tokenQuotaRemaining!=null)profile.tokenQuotaRemaining=Math.max(0,profile.tokenQuotaRemaining+tokenDelta);
  if(profile.creditRemaining!=null&&selection.reservedCost!=null&&usage.actualCost!=null)profile.creditRemaining=Math.max(0,profile.creditRemaining+(selection.reservedCost-usage.actualCost));
 });
 selector.release=selection=>settle(selection,profile=>returnReservation(profile,selection));
 selector.reportFailure=(selection,error)=>settle(selection,profile=>{
  returnReservation(profile,selection);
  const failure=classifyProviderError(error);if(!failure)return;
  profile.state=failure.state;
  const cooldown=failure.cooldown==="rate"?rateCooldown:failure.cooldown==="unavailable"?unavailableCooldown:undefined;
  profile.resetAt=cooldown!=null?new Date(now()+cooldown).toISOString():undefined;
 });
 selector.snapshot=()=>state.map(p=>({...p}));
 return selector;
}

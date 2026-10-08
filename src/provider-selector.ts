import type {ModelProvider} from "./provider.js";
import type {CapacityProfile,ProfileHealth,ProviderState,RoutingPolicyName,TaskDemand} from "./capacity.js";
import {effectiveState,eligible,estimateCost,routeTask} from "./capacity.js";
import {CapacityUnavailableError} from "./errors.js";

export type ProviderSelectionRequest={
 preferredProvider?:string;preferredModel?:string;demand:TaskDemand;exclude?:Array<{provider:string;model:string;profileId?:string}>;
 /** Routing policy for this request (quality/balanced/cost/local first); the selector default applies when omitted. */
 policy?:string;
 /** Only profiles with a free concurrency slot qualify; otherwise a BUSY/COOLDOWN CapacityUnavailableError tells the caller how to wait. */
 requireFreeSlot?:boolean;
};
export type ProviderSelection={provider:ModelProvider;profile:CapacityProfile;estimatedCost?:number;reservedTokens?:number;reservedCost?:number;/** True when no profile met the requested quality tier and the best available one was used instead. */qualityShortfall?:boolean;policy?:string};
export type UsageReport={inputTokens:number;outputTokens:number;actualCost?:number;latencyMs?:number};
/**
 * A selection reserves token quota, credit and one concurrency slot on its profile.
 * Every selection must be settled exactly once through reportSuccess, reportFailure or release.
 */
export type ProviderSelector=((request:ProviderSelectionRequest)=>ProviderSelection)&{
 reportSuccess?:(selection:ProviderSelection,usage:UsageReport)=>void;
 reportFailure?:(selection:ProviderSelection,error:unknown)=>void;
 release?:(selection:ProviderSelection)=>void;
 snapshot?:()=>CapacityProfile[];
 /** Rolling health (failure rate, latency, score) per profile id. */
 health?:()=>Record<string,ProfileHealth>;
};
export type ProviderInstantiator=(provider:string,model:string,profile?:CapacityProfile)=>ModelProvider;
export type SelectorOptions={now?:()=>number;cooldownMs?:number;unavailableCooldownMs?:number;/** Policy used when a request names none. */defaultPolicy?:RoutingPolicyName|string;/** Outcomes kept per profile for health scoring. */healthWindow?:number};
type Outcome={ok:boolean;latencyMs?:number};

export type ProviderFailure={state:ProviderState;cooldown:"rate"|"unavailable"|"none"};
/** Maps a provider error to the capacity state it implies, or undefined when it is not a capacity/availability failure. */
export function classifyProviderError(error:unknown):ProviderFailure|undefined{
 if(error instanceof CapacityUnavailableError)return {state:"RATE_LIMITED",cooldown:"none"};
 const text=(error instanceof Error?error.message:String(error)).toLowerCase();
 if(/out.?of.?credit|insufficient.?credit|billing|payment required|\b402\b/.test(text))return {state:"OUT_OF_CREDIT",cooldown:"none"};
 if(/quota|\b429\b|rate.?limit|usage limit|limit reached|overloaded|capacity/.test(text))return {state:"RATE_LIMITED",cooldown:"rate"};
 if(/claude code is not logged in|claude code executable|was not found on path/.test(text))return {state:"UNAVAILABLE",cooldown:"none"};
 if(/\b50[0234]\b|timeout|timed out|econnreset|econnrefused|enotfound|fetch failed|network|socket hang up/.test(text))return {state:"UNAVAILABLE",cooldown:"unavailable"};
 return undefined;
}
export const isProviderFailure=(error:unknown)=>classifyProviderError(error)!==undefined;

const key=(p:{provider:string;model:string;id?:string;profileId?:string})=>p.profileId??p.id??(p.provider+"\n"+p.model);

export function createCapacitySelector(profiles:CapacityProfile[],instantiate:ProviderInstantiator,options:SelectorOptions={}):ProviderSelector{
 const now=options.now??Date.now,rateCooldown=options.cooldownMs??60_000,unavailableCooldown=options.unavailableCooldownMs??15_000;
 const state=profiles.map((p,index)=>({...p,id:p.id??p.provider+"-"+p.model.replace(/[^A-Za-z0-9._-]/g,"-")+"-"+index}));
 const inFlight=new Map<string,number>(),settled=new WeakSet<ProviderSelection>(),outcomes=new Map<string,Outcome[]>(),window=options.healthWindow??20,defaultPolicy=options.defaultPolicy??"COST_FIRST";
 const record=(profile:CapacityProfile,outcome:Outcome)=>{const list=outcomes.get(key(profile))??[];list.push(outcome);while(list.length>window)list.shift();outcomes.set(key(profile),list);};
 const healthOf=(profile:CapacityProfile):ProfileHealth|undefined=>{
  const list=outcomes.get(key(profile));if(!list?.length)return undefined;
  const failures=list.filter(o=>!o.ok).length,latencies=list.filter(o=>o.ok&&o.latencyMs!=null).map(o=>o.latencyMs!);
  // Laplace-smoothed success rate: one early failure does not condemn a profile, a streak does.
  return {samples:list.length,failureRate:failures/list.length,avgLatencyMs:latencies.length?latencies.reduce((a,b)=>a+b,0)/latencies.length:undefined,score:(list.length-failures+1)/(list.length+2)};
 };
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
  const policy=request.policy??defaultPolicy,route={policy,health:healthOf};
  let ignoreFloor=false,eligibleNow=filtered.filter(profile=>eligible(profile,request.demand,at));
  if(!eligibleNow.length&&request.demand.minQualityTier){eligibleNow=filtered.filter(profile=>eligible(profile,request.demand,at,{ignoreQualityFloor:true}));ignoreFloor=eligibleNow.length>0;}
  const free=eligibleNow.filter(profile=>active(profile)<profile.maxConcurrency);
  // Capacity aware: prefer profiles with a free concurrency slot; queue on a saturated one only when the caller allows it.
  const selected=routeTask(free,request.demand,at,{...route,ignoreQualityFloor:ignoreFloor})??(request.requireFreeSlot?undefined:routeTask(eligibleNow,request.demand,at,{...route,ignoreQualityFloor:ignoreFloor}));
  if(!selected){
   const preference=request.preferredProvider?request.preferredProvider+"/"+request.preferredModel:"automatic routing";
   if(eligibleNow.length)throw new CapacityUnavailableError("All eligible provider capacity for "+preference+" is busy","BUSY");
   // Profiles that would qualify except that they are cooling down tell the caller when to look again.
   const cooling=filtered.filter(profile=>effectiveState(profile,at)!=="AVAILABLE"&&effectiveState(profile,at)!=="QUOTA_LOW"&&profile.resetAt&&Date.parse(profile.resetAt)>at&&eligible({...profile,state:"AVAILABLE"},request.demand,at));
   if(cooling.length)throw new CapacityUnavailableError("Eligible provider capacity for "+preference+" is cooling down","COOLDOWN",Math.min(...cooling.map(profile=>Date.parse(profile.resetAt!))));
   throw new CapacityUnavailableError("No eligible provider capacity for "+preference);
  }
  const reservedTokens=request.demand.estimatedInputTokens+request.demand.estimatedOutputTokens,reservedCost=estimateCost(selected,request.demand);
  if(selected.tokenQuotaRemaining!=null)selected.tokenQuotaRemaining=Math.max(0,selected.tokenQuotaRemaining-reservedTokens);
  if(selected.creditRemaining!=null&&reservedCost!=null)selected.creditRemaining=Math.max(0,selected.creditRemaining-reservedCost);
  inFlight.set(key(selected),active(selected)+1);
  return {provider:instantiate(selected.provider,selected.model,selected),profile:{...selected},estimatedCost:reservedCost,reservedTokens,reservedCost,policy:String(policy),...(ignoreFloor?{qualityShortfall:true}:{})};
 }) as ProviderSelector;
 selector.reportSuccess=(selection,usage)=>settle(selection,profile=>{
  record(profile,{ok:true,latencyMs:usage.latencyMs});
  const actualTokens=usage.inputTokens+usage.outputTokens,tokenDelta=(selection.reservedTokens??0)-actualTokens;
  if(profile.tokenQuotaRemaining!=null)profile.tokenQuotaRemaining=Math.max(0,profile.tokenQuotaRemaining+tokenDelta);
  if(profile.creditRemaining!=null&&selection.reservedCost!=null&&usage.actualCost!=null)profile.creditRemaining=Math.max(0,profile.creditRemaining+(selection.reservedCost-usage.actualCost));
 });
 selector.release=selection=>settle(selection,profile=>returnReservation(profile,selection));
 selector.reportFailure=(selection,error)=>settle(selection,profile=>{
  returnReservation(profile,selection);
  if(classifyProviderError(error))record(profile,{ok:false});
  const failure=classifyProviderError(error);if(!failure)return;
  profile.state=failure.state;
  const cooldown=failure.cooldown==="rate"?rateCooldown:failure.cooldown==="unavailable"?unavailableCooldown:undefined;
  profile.resetAt=cooldown!=null?new Date(now()+cooldown).toISOString():undefined;
 });
 selector.snapshot=()=>state.map(p=>({...p}));
 selector.health=()=>Object.fromEntries(state.flatMap(p=>{const h=healthOf(p);return h?[[key(p),h]]:[];}));
 return selector;
}

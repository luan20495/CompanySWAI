export type ProviderState="AVAILABLE"|"QUOTA_LOW"|"RATE_LIMITED"|"OUT_OF_CREDIT"|"UNAVAILABLE";
export type CapacityProfile={
 id?:string;provider:string;model:string;state:ProviderState;capabilities:string[];contextWindow:number;
 inputCostPerMillion?:number;outputCostPerMillion?:number;creditRemaining?:number;tokenQuotaRemaining?:number;
 resetAt?:string;maxConcurrency:number;estimatedTokensPerSecond?:number;
 /** "subscription" profiles (e.g. Claude Code) have no per-token price: cost is not applicable, never $0. */
 billing?:"metered"|"subscription";
 /** 1 (economy) … 5 (strongest). Routing policies and quality modes compare tiers; unspecified means 3. */
 qualityTier?:number;
 /** Runs on this machine (local CLI, loopback server) or remotely; LOCAL_FIRST prefers local. */
 locality?:"local"|"remote";
};
export type TaskDemand={capabilities:string[];estimatedInputTokens:number;estimatedOutputTokens:number;maxCost?:number;minContextWindow?:number;minQualityTier?:number};
export type RoutingPolicyName="QUALITY_FIRST"|"BALANCED"|"COST_FIRST"|"LOCAL_FIRST";
/** Rolling health of one profile, from recent real outcomes. */
export type ProfileHealth={samples:number;failureRate:number;avgLatencyMs?:number;score:number};
export type RouteOptions={policy?:RoutingPolicyName|string;health?:(profile:CapacityProfile)=>ProfileHealth|undefined;ignoreQualityFloor?:boolean};

export const DEFAULT_TIER=3;
export const tierOf=(p:CapacityProfile)=>p.qualityTier??DEFAULT_TIER;

export function estimateCost(p:CapacityProfile,d:TaskDemand){
 if(p.billing==="subscription"||p.inputCostPerMillion==null||p.outputCostPerMillion==null)return undefined;
 return d.estimatedInputTokens/1e6*p.inputCostPerMillion+d.estimatedOutputTokens/1e6*p.outputCostPerMillion;
}
/** A throttled/unavailable profile becomes usable again once its resetAt has passed. */
export function effectiveState(p:CapacityProfile,now=Date.now()):ProviderState{
 if(p.state==="AVAILABLE"||p.state==="QUOTA_LOW")return p.state;
 const reset=p.resetAt?Date.parse(p.resetAt):NaN;
 return Number.isFinite(reset)&&reset<=now?"AVAILABLE":p.state;
}
export function eligible(p:CapacityProfile,d:TaskDemand,now=Date.now(),options:{ignoreQualityFloor?:boolean}={}){
 const state=effectiveState(p,now);
 if(state!=="AVAILABLE"&&state!=="QUOTA_LOW")return false;
 if((d.minContextWindow??0)>p.contextWindow)return false;
 if(!options.ignoreQualityFloor&&(d.minQualityTier??0)>tierOf(p))return false;
 if(!d.capabilities.every(c=>p.capabilities.includes(c)))return false;
 const total=d.estimatedInputTokens+d.estimatedOutputTokens;
 if(p.tokenQuotaRemaining!=null&&p.tokenQuotaRemaining<total)return false;
 const cost=estimateCost(p,d);
 if(cost!=null&&p.creditRemaining!=null&&p.creditRemaining<cost)return false;
 if(cost!=null&&d.maxCost!=null&&cost>d.maxCost)return false;
 return true;
}

/** Marginal money cost used for ranking: subscription work costs nothing extra, unknown metered cost ranks last. */
const marginal=(p:CapacityProfile,d:TaskDemand)=>p.billing==="subscription"?0:estimateCost(p,d)??Number.MAX_SAFE_INTEGER;
const latencySeconds=(p:CapacityProfile,d:TaskDemand,health?:ProfileHealth)=>{
 if(health?.avgLatencyMs!=null&&health.samples>=3)return health.avgLatencyMs/1000;
 return p.estimatedTokensPerSecond?(d.estimatedInputTokens+d.estimatedOutputTokens)/p.estimatedTokensPerSecond:undefined;
};
const normalise=(value:number|undefined,values:number[])=>{
 if(value==null)return 0.5;
 const known=values.filter(v=>Number.isFinite(v)&&v<Number.MAX_SAFE_INTEGER),min=Math.min(...known),max=Math.max(...known);
 return max===min?0:Math.min(1,Math.max(0,(value-min)/(max-min)));
};

/**
 * Chooses among eligible profiles by policy:
 *  COST_FIRST    cheapest first (subscription = free), then quality
 *  QUALITY_FIRST highest tier, then health, then cost
 *  BALANCED      weighted quality / health / cost / latency
 *  LOCAL_FIRST   local profiles first (balanced among them), remote only when no local one qualifies
 * Ties always resolve deterministically by profile id.
 */
export function routeTask(providers:CapacityProfile[],d:TaskDemand,now=Date.now(),options:RouteOptions={}){
 const pool=providers.filter(p=>eligible(p,d,now,options));
 return rank(pool,d,options)[0];
}
export function rank(pool:CapacityProfile[],d:TaskDemand,options:RouteOptions={}):CapacityProfile[]{
 const policy=(options.policy??"COST_FIRST") as RoutingPolicyName,healthOf=(p:CapacityProfile)=>options.health?.(p);
 const healthScore=(p:CapacityProfile)=>healthOf(p)?.score??1;
 const byId=(a:CapacityProfile,b:CapacityProfile)=>(a.id??a.provider+a.model).localeCompare(b.id??b.provider+b.model);
 if(policy==="LOCAL_FIRST"){
  const local=pool.filter(p=>p.locality==="local");
  return rank(local.length?local:pool,d,{...options,policy:"BALANCED"});
 }
 const sorted=[...pool];
 if(policy==="QUALITY_FIRST")return sorted.sort((a,b)=>tierOf(b)-tierOf(a)||healthScore(b)-healthScore(a)||marginal(a,d)-marginal(b,d)||b.contextWindow-a.contextWindow||byId(a,b));
 if(policy==="BALANCED"){
  const costs=pool.map(p=>marginal(p,d)),lats=pool.map(p=>latencySeconds(p,d,healthOf(p))??NaN);
  const score=(p:CapacityProfile)=>{
   const quality=(tierOf(p)-1)/4,cost=marginal(p,d),lat=latencySeconds(p,d,healthOf(p));
   const costScore=cost>=Number.MAX_SAFE_INTEGER?0.5:1-normalise(cost,costs),latencyScore=lat==null?0.5:1-normalise(lat,lats);
   return 0.35*quality+0.25*healthScore(p)+0.25*costScore+0.15*latencyScore;
  };
  return sorted.sort((a,b)=>score(b)-score(a)||tierOf(b)-tierOf(a)||byId(a,b));
 }
 // COST_FIRST (also the unspecified default)
 return sorted.sort((a,b)=>marginal(a,d)-marginal(b,d)||tierOf(b)-tierOf(a)||b.contextWindow-a.contextWindow||byId(a,b));
}

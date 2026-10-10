/**
 * Run metrics, collected as events happen (no polling): queue wait, task latency, provider utilisation,
 * retries, throughput and token/cost usage.
 */
export type TaskOutcome="DONE"|"PAUSED"|"APPROVAL_REQUIRED"|"FAILED"|"STOPPED";
type Stat={count:number;totalMs:number;maxMs:number};
const stat=():Stat=>({count:0,totalMs:0,maxMs:0});
const add=(s:Stat,ms:number)=>{s.count++;s.totalMs+=ms;s.maxMs=Math.max(s.maxMs,ms);};
const summary=(s:Stat)=>({count:s.count,avgMs:s.count?Math.round(s.totalMs/s.count):0,maxMs:Math.round(s.maxMs)});

export class RunMetrics{
 private started=Date.now();private ready=new Map<string,number>();private began=new Map<string,number>();
 private queueWait=stat();private latency=stat();private outcomes:Record<TaskOutcome,number>={DONE:0,PAUSED:0,APPROVAL_REQUIRED:0,FAILED:0,STOPPED:0};
 private busy=new Map<string,{busyMs:number;runs:number;maxConcurrency:number}>();
 retries=0;failovers=0;capacityWaits=0;private tokensIn=0;private tokensOut=0;private cost=0;private subscriptionRuns=0;
 constructor(private now:()=>number=Date.now){this.started=now();}

 taskReady(id:string){if(!this.ready.has(id))this.ready.set(id,this.now());}
 taskStarted(id:string){
  const at=this.now(),ready=this.ready.get(id);
  if(ready!=null&&!this.began.has(id))add(this.queueWait,at-ready);
  if(!this.began.has(id))this.began.set(id,at);
 }
 taskFinished(id:string,outcome:TaskOutcome){
  const begun=this.began.get(id);
  if(begun!=null)add(this.latency,this.now()-begun);
  this.outcomes[outcome]++;
 }
 /** One model call's wall time on a provider profile. */
 providerRun(profileId:string,maxConcurrency:number,ms:number){
  const entry=this.busy.get(profileId)??{busyMs:0,runs:0,maxConcurrency};
  entry.busyMs+=ms;entry.runs++;entry.maxConcurrency=maxConcurrency;this.busy.set(profileId,entry);
 }
 usage(inputTokens:number,outputTokens:number,cost?:number,subscription=false){
  this.tokensIn+=inputTokens;this.tokensOut+=outputTokens;if(cost!=null)this.cost+=cost;if(subscription)this.subscriptionRuns++;
 }
 snapshot(){
  const wallMs=Math.max(1,this.now()-this.started),finished=this.outcomes.DONE+this.outcomes.FAILED;
  const providers:Record<string,{runs:number;busyMs:number;utilization:number}>={};
  for(const [id,e] of this.busy)providers[id]={runs:e.runs,busyMs:Math.round(e.busyMs),utilization:Number((e.busyMs/(wallMs*Math.max(1,e.maxConcurrency))).toFixed(3))};
  return {
   wallMs,tasks:{...this.outcomes},queueWait:summary(this.queueWait),taskLatency:summary(this.latency),providers,
   retries:this.retries,failovers:this.failovers,capacityWaits:this.capacityWaits,
   throughputPerMinute:Number((finished/(wallMs/60000)).toFixed(2)),
   usage:{inputTokens:this.tokensIn,outputTokens:this.tokensOut,knownCost:Number(this.cost.toFixed(6)),subscriptionRuns:this.subscriptionRuns}
  };
 }
}
export type MetricsSnapshot=ReturnType<RunMetrics["snapshot"]>;

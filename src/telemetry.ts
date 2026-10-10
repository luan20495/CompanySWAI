import {appendFile,mkdir,readFile} from "node:fs/promises";
import {dirname,join} from "node:path";
import {SafeId} from "./ids.js";
import type {ExecutionRecordValue} from "./execution-record.js";
import {redact} from "./secrets.js";

/**
 * Structured local telemetry: an append-only event log per project (who ran what, on which provider, when, why it
 * waited or retried). `buildProjectStatus` folds it with the execution log into the live view the status CLI/API serves.
 */
export type TelemetryEvent={
 ts:string;runId:string;pid:number;type:string;taskId?:string;profileId?:string;provider?:string;model?:string;detail?:string;
};

export class TelemetryStore{
 constructor(private root=".companyswai/telemetry"){}
 private path(projectId:string){return join(this.root,SafeId.parse(projectId),"events.jsonl");}
 async append(projectId:string,event:Omit<TelemetryEvent,"ts"|"pid">&{ts?:string}){
  const path=this.path(projectId);
  await mkdir(dirname(path),{recursive:true});
  const full:TelemetryEvent={ts:event.ts??new Date().toISOString(),pid:process.pid,...event,detail:event.detail?redact(event.detail).slice(0,500):undefined};
  await appendFile(path,JSON.stringify(full)+"\n","utf8");
 }
 async list(projectId:string):Promise<TelemetryEvent[]>{
  let text:string;
  try{text=await readFile(this.path(projectId),"utf8");}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return [];throw error;}
  const out:TelemetryEvent[]=[];
  for(const line of text.split("\n")){if(!line.trim())continue;try{out.push(JSON.parse(line) as TelemetryEvent);}catch{/* torn last line */}}
  return out;
 }
}

export type ProjectStatus={
 projectId:string;state:"IDLE"|"RUNNING"|"INTERRUPTED"|"FINISHED";runId?:string;pid?:number;elapsedMs?:number;
 running:Array<{taskId:string;agentRole:string;provider?:string;profileId?:string;elapsedMs:number}>;
 queued:string[];completed:string[];failed:string[];paused:string[];blockers:string[];
 retries:number;failovers:number;providers:Record<string,number>;
 usage:{inputTokens:number;outputTokens:number;knownCost:number;subscriptionRuns:number;unknownCostRuns:number};
};

/** `isAlive` is injectable so tests (and other hosts) can decide whether the process that wrote the log still exists. */
export function buildProjectStatus(projectId:string,events:TelemetryEvent[],records:ExecutionRecordValue[],options:{now?:number;isAlive?:(pid:number)=>boolean;planTasks?:string[]}={}):ProjectStatus{
 const now=options.now??Date.now(),alive=options.isAlive??(pid=>{try{process.kill(pid,0);return true;}catch{return false;}});
 const runStarts=events.filter(e=>e.type==="run.started"),lastRun=runStarts.at(-1);
 const runEvents=lastRun?events.filter(e=>e.runId===lastRun.runId):[];
 const finished=runEvents.some(e=>e.type==="run.finished");
 let state:ProjectStatus["state"]=!lastRun?"IDLE":finished?"FINISHED":alive(lastRun.pid)?"RUNNING":"INTERRUPTED";
 const started=new Map<string,TelemetryEvent>(),done=new Set<string>(),failed=new Set<string>(),paused=new Set<string>();
 const blockers:string[]=[],selected=new Map<string,TelemetryEvent>();let retries=0,failovers=0;const providers:Record<string,number>={};
 for(const e of runEvents){
  if(e.type==="task.started"&&e.taskId)started.set(e.taskId,e);
  if(e.type==="task.finished"&&e.taskId){started.delete(e.taskId);const outcome=e.detail??"";
   if(outcome==="DONE")done.add(e.taskId);else if(outcome==="FAILED")failed.add(e.taskId);else if(outcome!=="STOPPED")paused.add(e.taskId);}
  if(e.type==="task.blocked"&&e.detail)blockers.push((e.taskId??"")+": "+e.detail);
  if(e.type==="provider.retry")retries++;
  if(e.type==="provider.failover")failovers++;
  if(e.type==="provider.selected"&&e.profileId){providers[e.profileId]=(providers[e.profileId]??0)+1;if(e.taskId)selected.set(e.taskId,e);}
 }
 const settled=records.filter(r=>r.status==="SUCCEEDED"||r.status==="CHECKPOINTED"||r.status==="FAILED");
 const usage={inputTokens:0,outputTokens:0,knownCost:0,subscriptionRuns:0,unknownCostRuns:0};
 const latest=new Map<string,ExecutionRecordValue>();for(const r of settled)if(r.inputTokens+r.outputTokens>0)latest.set(r.id,r);
 for(const r of latest.values()){usage.inputTokens+=r.inputTokens;usage.outputTokens+=r.outputTokens;if(r.billing==="subscription")usage.subscriptionRuns++;else if(r.actualCost!=null)usage.knownCost+=r.actualCost;else usage.unknownCostRuns++;}
 const running=state==="RUNNING"?[...started.values()].map(e=>({taskId:e.taskId!,agentRole:records.find(r=>r.taskId===e.taskId)?.agentRole??"",provider:selected.get(e.taskId!)?.provider??e.provider,profileId:selected.get(e.taskId!)?.profileId??e.profileId,elapsedMs:now-Date.parse(e.ts)})):[];
 const all=options.planTasks??[],queued=state==="RUNNING"?all.filter(id=>!started.has(id)&&!done.has(id)&&!failed.has(id)&&!paused.has(id)):[];
 return {projectId,state,runId:lastRun?.runId,pid:lastRun?.pid,elapsedMs:lastRun?now-Date.parse(lastRun.ts):undefined,running,queued,completed:[...done],failed:[...failed],paused:[...paused],blockers,retries,failovers,providers,usage:{...usage,knownCost:Number(usage.knownCost.toFixed(6))}};
}

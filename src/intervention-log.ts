import {appendFile,mkdir,readFile} from "node:fs/promises";
import {dirname} from "node:path";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {SafeId} from "./ids.js";
import {redact} from "./secrets.js";

/**
 * Append-only log of human (or operator) actions taken on CompanySWAI's behalf: starting and resuming work, stopping it, changing
 * priorities, approving, and anything done by hand outside the engine (re-dispatching a failed project, switching a model, editing
 * a plan). It exists so "how much did a person have to step in?" can be measured instead of guessed.
 *
 * The actor is self-declared (`--actor`, COMPANYSWAI_ACTOR, or the approver name a command already takes) and is recorded as
 * unverified: nothing here authenticates anyone. Entries written by the engine's own commands are automatic; `manual` entries
 * cover what happens outside it. Before this log existed nothing was recorded, and readers must say so rather than assume zero.
 */
export const INTERVENTION_KINDS=["dispatch","replan","resume","stop","priority","approval","experience-decision","takeover-approval","redispatch","model-change","plan-edit","config-change","external-fix","manual"] as const;
export const InterventionKind=z.enum(INTERVENTION_KINDS);
export type InterventionKindValue=z.infer<typeof InterventionKind>;
/** Kinds only a person reports (via `npm run intervene`); the rest are written by the commands themselves. */
export const MANUAL_KINDS:InterventionKindValue[]=["redispatch","model-change","plan-edit","config-change","external-fix","manual"];

export const Intervention=z.object({
 id:z.string(),ts:z.string(),kind:InterventionKind,projectId:SafeId.optional(),taskId:z.string().max(200).optional(),
 actor:z.string().min(1).max(100),actorVerified:z.literal(false),via:z.string().max(100),detail:z.string().max(500).optional()
});
export type InterventionValue=z.infer<typeof Intervention>;

export const DEFAULT_ACTOR="unspecified";
/** The declared actor: an explicit value, else COMPANYSWAI_ACTOR, else "unspecified". */
export function interventionActor(explicit?:string,env:NodeJS.ProcessEnv=process.env){
 const value=(explicit??env.COMPANYSWAI_ACTOR??"").trim();
 return value?value.slice(0,100):DEFAULT_ACTOR;
}

export class InterventionLog{
 constructor(readonly path=".companyswai/interventions.jsonl"){}
 async append(entry:Omit<InterventionValue,"id"|"ts"|"actorVerified">&{ts?:string}):Promise<InterventionValue>{
  const record=Intervention.parse({...entry,id:randomUUID(),ts:entry.ts??new Date().toISOString(),actorVerified:false,actor:redact(entry.actor).slice(0,100),detail:entry.detail?redact(entry.detail).slice(0,500):undefined});
  await mkdir(dirname(this.path),{recursive:true});
  const existing=await readFile(this.path,"utf8").catch(()=>"");
  await appendFile(this.path,(existing&&!existing.endsWith("\n")?"\n":"")+JSON.stringify(record)+"\n","utf8");
  return record;
 }
 /** Read-only: unreadable lines are counted, never rewritten or moved. */
 async read():Promise<{entries:InterventionValue[];unreadable:number;exists:boolean}>{
  let text:string;
  try{text=await readFile(this.path,"utf8");}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return {entries:[],unreadable:0,exists:false};throw error;}
  const entries:InterventionValue[]=[];let unreadable=0;
  for(const line of text.split("\n")){if(!line.trim())continue;try{entries.push(Intervention.parse(JSON.parse(line)));}catch{unreadable++;}}
  return {entries,unreadable,exists:true};
 }
}

/** Records an intervention without ever failing the command that made it: a logging problem is reported on stderr. */
export async function noteIntervention(log:InterventionLog,entry:Parameters<InterventionLog["append"]>[0]){
 try{return await log.append(entry);}
 catch(error){process.stderr.write("warning: could not record the intervention ("+redact(error instanceof Error?error.message:String(error))+")\n");return undefined;}
}

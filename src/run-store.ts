import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {z} from "zod";
import {SafeId} from "./ids.js";
import {writeFileAtomic} from "./fs-atomic.js";
import {ProjectPlan,type ProjectPlanValue} from "./project.js";

/** The phases of the autonomous pipeline, in order. A run resumes at the first phase that is not recorded as complete. */
export const PHASES=["PLAN","ESTIMATE","APPROVAL","EXECUTE","FINALIZE","RETROSPECTIVE","DONE"] as const;
export type Phase=(typeof PHASES)[number];

const FinalStatus=z.object({
 status:z.enum(["ACCEPTED","ACCEPTED_WITH_RISKS","FAILED_QA","BLOCKED","FAILED","PARKED","INCOMPLETE"]),
 reasons:z.array(z.string()),risks:z.array(z.string()),
 qa:z.object({status:z.string(),required:z.boolean()}),
 tasks:z.object({completed:z.number(),failed:z.number(),paused:z.number(),waiting:z.number(),approvalRequired:z.number()}),
 at:z.string()
});
export type FinalStatusValue=z.infer<typeof FinalStatus>;

const RunState=z.object({
 version:z.literal(1),projectId:SafeId,planHash:z.string(),briefHash:z.string().optional(),
 completedPhases:z.array(z.enum(PHASES)).default([]),phase:z.enum(PHASES),startedAt:z.string(),updatedAt:z.string(),
 estimate:z.any().optional(),notes:z.array(z.string()).default([]),final:FinalStatus.optional(),stopped:z.string().optional()
});
export type RunStateValue=z.infer<typeof RunState>;

export const hashOf=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0,16);

/** Persisted run state and the exact plan a project is being executed with (so a resume never recompiles something different). */
export class RunStore{
 constructor(private root=".companyswai/runs"){}
 private statePath(projectId:string){return join(this.root,SafeId.parse(projectId)+".json");}
 private planPath(projectId:string){return join(this.root,SafeId.parse(projectId)+".plan.json");}
 async load(projectId:string):Promise<RunStateValue|undefined>{
  try{return RunState.parse(JSON.parse(await readFile(this.statePath(projectId),"utf8")));}
  catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return undefined;throw error;}
 }
 async save(value:RunStateValue){const parsed=RunState.parse({...value,updatedAt:new Date().toISOString()});await writeFileAtomic(this.statePath(value.projectId),JSON.stringify(parsed,null,2));return parsed;}
 async loadPlan(projectId:string):Promise<ProjectPlanValue|undefined>{
  try{return ProjectPlan.parse(JSON.parse(await readFile(this.planPath(projectId),"utf8")));}
  catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return undefined;throw error;}
 }
 async savePlan(plan:ProjectPlanValue){await writeFileAtomic(this.planPath(plan.projectId),JSON.stringify(plan,null,2));}
}

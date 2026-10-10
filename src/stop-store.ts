import {readFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {z} from "zod";
import {SafeId} from "./ids.js";
import {writeFileAtomic} from "./fs-atomic.js";

/**
 * A cooperative stop request for ONE engine run. The engine looks at it between task steps (never in the middle of a model
 * call or a repository transaction), parks unfinished tasks and exits; every step is already persisted in the execution log,
 * so the stop leaves no torn state and a later resume continues from that log. The request is bound to the run it was made
 * for (`runId`), so a stale request can never stop a later run.
 */
export const StopRequest=z.object({projectId:SafeId,runId:z.string().min(1),requestedAt:z.string(),requestedBy:z.string().default("operator"),reason:z.string().default("")});
export type StopRequestValue=z.infer<typeof StopRequest>;

export class StopStore{
 constructor(private root=".companyswai/stops"){}
 private path(projectId:string){return join(this.root,SafeId.parse(projectId)+".json");}
 async request(value:{projectId:string;runId:string;requestedBy?:string;reason?:string}){
  const parsed=StopRequest.parse({...value,requestedAt:new Date().toISOString()});
  await writeFileAtomic(this.path(parsed.projectId),JSON.stringify(parsed,null,2));return parsed;
 }
 async load(projectId:string):Promise<StopRequestValue|undefined>{
  try{return StopRequest.parse(JSON.parse(await readFile(this.path(projectId),"utf8")));}
  catch{return undefined;/* absent or unreadable: an unreadable request is never trusted */}
 }
 async clear(projectId:string){await rm(this.path(projectId),{force:true});}
}

import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {z} from "zod";
import {SafeId} from "./ids.js";
import {writeFileAtomic} from "./fs-atomic.js";

/**
 * QA-driven rework requests. A request says "task T must produce a new version because of these findings"; it is pending
 * until T has a maker success newer than `afterVersion`. State is derived from the request plus the execution log, so a
 * crash during rework resumes exactly where it stopped.
 */
const Request=z.object({
 id:z.string(),round:z.number().int().positive(),taskId:SafeId,
 /** `fix`: the owner fixes what QA found. `reverify`: QA re-checks after owners changed their work. */
 kind:z.enum(["fix","reverify"]),
 /** Number of maker successes the task had when the request was made. */
 afterVersion:z.number().int().nonnegative(),
 findings:z.array(z.string()),failedTests:z.array(z.string()).default([]),createdAt:z.string()
});
const File=z.object({version:z.literal(1),requests:z.array(Request)});
export type ReworkRequest=z.infer<typeof Request>;

export class ReworkStore{
 private queue=new Map<string,Promise<unknown>>();
 constructor(private root=".companyswai/rework"){}
 private path(projectId:string){return join(this.root,SafeId.parse(projectId)+".json");}
 async list(projectId:string):Promise<ReworkRequest[]>{
  try{return File.parse(JSON.parse(await readFile(this.path(projectId),"utf8"))).requests;}
  catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return [];throw error;}
 }
 /** All requests of one round are written together, so a crash never leaves half a round. */
 addRound(projectId:string,requests:Array<Omit<ReworkRequest,"id"|"createdAt"|"round">>){
  const previous=this.queue.get(projectId)??Promise.resolve();
  const next=previous.catch(()=>undefined).then(async()=>{
   const existing=await this.list(projectId),round=Math.max(0,...existing.map(r=>r.round))+1,now=new Date().toISOString();
   const added=requests.map(r=>({...r,id:"rework-"+round+"-"+r.taskId,round,createdAt:now}));
   await writeFileAtomic(this.path(projectId),JSON.stringify({version:1,requests:[...existing,...added]},null,2));
   return {round,added};
  });
  this.queue.set(projectId,next);return next;
 }
 async rounds(projectId:string){return Math.max(0,...(await this.list(projectId)).map(r=>r.round));}
}

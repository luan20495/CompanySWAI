import {readFile,readdir,realpath} from "node:fs/promises";
import {join,resolve,sep} from "node:path";
import {z} from "zod";
import {writeFileAtomic} from "./fs-atomic.js";
import {SafeId} from "./ids.js";

/** Lifecycle of a takeover. Nothing may write to the target before APPROVED_FOR_EXECUTION. */
export const TakeoverStatus=z.enum(["AUDITING","AUDIT_COMPLETE_WAITING_APPROVAL","APPROVED_FOR_EXECUTION","AUDIT_INVALID","TARGET_CHANGED"]);
export type TakeoverStatusValue=z.infer<typeof TakeoverStatus>;

export const TakeoverRecord=z.object({
 version:z.literal(1),projectId:SafeId,workspace:z.string().min(1),status:TakeoverStatus,auditedHead:z.string().min(1),branch:z.string(),
 focus:z.array(z.string()).default([]),startedAt:z.string(),updatedAt:z.string(),reason:z.string().optional(),
 reportHash:z.string().optional(),counts:z.record(z.string(),z.number()).optional(),changedParts:z.array(z.string()).default([]),
 approvedBy:z.string().optional(),approvedAt:z.string().optional(),execHash:z.string().optional(),execCount:z.number().optional()
});
export type TakeoverRecordValue=z.infer<typeof TakeoverRecord>;

/** One directory per takeover under the state root: record, snapshot, fingerprints, plan, classification and report. */
export class TakeoverStore{
 constructor(private root=".companyswai/takeover"){}
 dir(projectId:string){return join(this.root,SafeId.parse(projectId));}
 private async readJson<T>(projectId:string,name:string,schema?:z.ZodType<T>){
  try{const value=JSON.parse(await readFile(join(this.dir(projectId),name),"utf8"));return schema?schema.parse(value):value as T;}
  catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return undefined;throw error;}
 }
 load(projectId:string){return this.readJson(projectId,"record.json",TakeoverRecord);}
 async save(record:unknown){const value=TakeoverRecord.parse(record);await writeFileAtomic(join(this.dir(value.projectId),"record.json"),JSON.stringify(value,null,2));return value;}
 async writeJson(projectId:string,name:string,value:unknown){await writeFileAtomic(join(this.dir(projectId),name),JSON.stringify(value,null,2));}
 async writeText(projectId:string,name:string,text:string){await writeFileAtomic(join(this.dir(projectId),name),text);}
 readData<T>(projectId:string,name:string){return this.readJson<T>(projectId,name);}
 async readText(projectId:string,name:string){return readFile(join(this.dir(projectId),name),"utf8").catch(()=>undefined);}
 /** Every readable record, oldest first. Foreign or torn files are skipped, never repaired. */
 async list():Promise<TakeoverRecordValue[]>{
  const names=await readdir(this.root).catch(()=>[] as string[]),out:TakeoverRecordValue[]=[];
  for(const name of names.sort()){const record=await this.load(name).catch(()=>undefined);if(record)out.push(record);}
  return out.sort((a,b)=>a.startedAt.localeCompare(b.startedAt));
 }
 /**
  * The newest takeover that covers a workspace, so a plan for that workspace is gated whatever its project id is. Paths are compared
  * after symlink resolution, and a plan on a subdirectory or a parent of an audited root counts as the same workspace.
  */
 async forWorkspace(workspace:string){
  const real=async(p:string)=>realpath(resolve(p)).catch(()=>resolve(p)),target=await real(workspace),related=(a:string,b:string)=>a===b||a.startsWith(b+sep)||b.startsWith(a+sep);
  const matches:TakeoverRecordValue[]=[];
  for(const record of await this.list())if(related(await real(record.workspace),target))matches.push(record);
  return matches.pop();
 }
}

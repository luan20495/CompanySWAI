import {readFile,rename} from "node:fs/promises";
import {join} from "node:path";
import {writeFileAtomic} from "./fs-atomic.js";
import {z} from "zod";
import {SafeId} from "./ids.js";

export const TaskStatus=z.enum(["READY","DOING","REVIEW","BLOCKED","PAUSED_CAPACITY","DONE"]);
export const Checkpoint=z.object({
 taskId:SafeId,at:z.string(),status:TaskStatus,completed:z.array(z.string()),remaining:z.array(z.string()),
 artifactRefs:z.array(z.string()),decisionRefs:z.array(z.string()),compactContext:z.string(),
 provider:z.string().optional(),model:z.string().optional(),
 inputTokens:z.number().int().nonnegative().default(0),outputTokens:z.number().int().nonnegative().default(0)
});
export type CheckpointValue=z.infer<typeof Checkpoint>;

export class FileCheckpointStore{
 constructor(private root=".companyswai/checkpoints"){}
 private path(projectId:string,taskId:string){return join(this.root,SafeId.parse(projectId),SafeId.parse(taskId)+".json");}
 async save(projectId:string,value:unknown){
  const checkpoint=Checkpoint.parse(value);
  const path=this.path(projectId,checkpoint.taskId);
  await writeFileAtomic(path,JSON.stringify(checkpoint,null,2));
  return checkpoint;
 }
 /** Checkpoints are an optimisation over the execution log, so a corrupt or truncated one is quarantined and treated as absent. */
 async load(projectId:string,taskId:string){
  const path=this.path(projectId,taskId);
  let text:string;
  try{text=await readFile(path,"utf8");}
  catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return undefined;throw error;}
  try{return Checkpoint.parse(JSON.parse(text));}
  catch{await rename(path,path+".corrupt").catch(()=>undefined);return undefined;}
 }
}

import {mkdir,readFile,writeFile} from "node:fs/promises";
import {dirname,join} from "node:path";
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
  await mkdir(dirname(path),{recursive:true});
  await writeFile(path,JSON.stringify(checkpoint,null,2),"utf8");
  return checkpoint;
 }
 async load(projectId:string,taskId:string){
  try{return Checkpoint.parse(JSON.parse(await readFile(this.path(projectId,taskId),"utf8")));}
  catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return undefined;throw error;}
 }
}

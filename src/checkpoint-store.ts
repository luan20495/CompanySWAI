import {mkdir,readFile,writeFile} from "node:fs/promises";
import {dirname,join} from "node:path";
import {Checkpoint} from "./contracts.js";

export class FileCheckpointStore{
 constructor(private root=".companyswai/checkpoints"){}
 private path(projectId:string,taskId:string){return join(this.root,projectId,taskId+".json");}
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

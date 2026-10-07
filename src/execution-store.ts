import {appendFile,mkdir,readFile} from "node:fs/promises";
import {dirname,join} from "node:path";
import {ExecutionRecord,type ExecutionRecordValue} from "./execution-record.js";

export class FileExecutionStore{
 constructor(private root=".companyswai/executions"){}
 private path(projectId:string){return join(this.root,projectId,"records.jsonl");}
 async append(value:unknown){
  const record=ExecutionRecord.parse(value);
  const path=this.path(record.projectId);
  await mkdir(dirname(path),{recursive:true});
  await appendFile(path,JSON.stringify(record)+"\n","utf8");
  return record;
 }
 async list(projectId:string):Promise<ExecutionRecordValue[]>{
  try{
   const text=await readFile(this.path(projectId),"utf8");
   return text.split("\n").filter(Boolean).map(line=>ExecutionRecord.parse(JSON.parse(line)));
  }catch(error){
   if((error as NodeJS.ErrnoException).code==="ENOENT")return [];
   throw error;
  }
 }
}

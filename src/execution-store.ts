import {appendFile,mkdir,readFile} from "node:fs/promises";
import {dirname,join} from "node:path";
import {ExecutionRecord,type ExecutionRecordValue} from "./execution-record.js";

/**
 * Append-only execution log, one JSON record per line. The log is the resume source of truth, so reading it
 * must survive the failure it exists for: a crash in the middle of an append leaves a truncated last line.
 * Unreadable lines are skipped (and preserved next to the log) instead of making the whole project unreadable.
 */
export class FileExecutionStore{
 constructor(private root=".companyswai/executions"){}
 private path(projectId:string){return join(this.root,projectId,"records.jsonl");}
 async append(value:unknown){
  const record=ExecutionRecord.parse(value);
  const path=this.path(record.projectId);
  await mkdir(dirname(path),{recursive:true});
  // A previous crash may have left a partial line without a newline; start on a fresh line so this record stays intact.
  const existing=await readFile(path,"utf8").catch(()=>"");
  const prefix=existing&&!existing.endsWith("\n")?"\n":"";
  await appendFile(path,prefix+JSON.stringify(record)+"\n","utf8");
  return record;
 }
 async list(projectId:string):Promise<ExecutionRecordValue[]>{
  let text:string;
  try{text=await readFile(this.path(projectId),"utf8");}
  catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return [];throw error;}
  const records:ExecutionRecordValue[]=[],corrupt:string[]=[];
  for(const line of text.split("\n")){
   if(!line.trim())continue;
   try{records.push(ExecutionRecord.parse(JSON.parse(line)));}catch{corrupt.push(line);}
  }
  if(corrupt.length)await this.quarantine(projectId,corrupt);
  return records;
 }
 private async quarantine(projectId:string,lines:string[]){
  const path=join(this.root,projectId,"records.corrupt.jsonl");
  const seen=await readFile(path,"utf8").catch(()=>"");
  const fresh=lines.filter(line=>!seen.includes(line));
  if(fresh.length)await appendFile(path,fresh.join("\n")+"\n","utf8").catch(()=>undefined);
 }
 /** Number of unreadable lines that were skipped, for doctor/status output. */
 async corruptLines(projectId:string){
  const text=await readFile(join(this.root,projectId,"records.corrupt.jsonl"),"utf8").catch(()=>"");
  return text.split("\n").filter(Boolean).length;
 }
}

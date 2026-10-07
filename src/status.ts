import type {ExecutionRecordValue} from "./execution-record.js";

export type TaskSnapshot={
 taskId:string;
 agentRole:string;
 provider:string;
 model:string;
 status:ExecutionRecordValue["status"];
 attempts:number;
 startedAt:string;
 finishedAt?:string;
 inputTokens:number;
 outputTokens:number;
 latestOutput:string;
 latestError?:string;
};

export function buildTaskSnapshots(records:ExecutionRecordValue[]):TaskSnapshot[]{
 const byTask=new Map<string,ExecutionRecordValue[]>();
 for(const record of records){
  const list=byTask.get(record.taskId)??[];
  list.push(record);
  byTask.set(record.taskId,list);
 }
 const snapshots:TaskSnapshot[]=[];
 for(const [taskId,list] of byTask){
  const latest=list[list.length-1];
  const terminal=list.filter(item=>item.status!=="STARTED");
  snapshots.push({
   taskId,
   agentRole:latest.agentRole,
   provider:latest.provider,
   model:latest.model,
   status:latest.status,
   attempts:list.filter(item=>item.status==="STARTED").length,
   startedAt:list[0].startedAt,
   finishedAt:latest.finishedAt,
   inputTokens:terminal.reduce((sum,item)=>sum+item.inputTokens,0),
   outputTokens:terminal.reduce((sum,item)=>sum+item.outputTokens,0),
   latestOutput:[...list].reverse().find(item=>item.output)?.output??"",
   latestError:[...list].reverse().find(item=>item.error)?.error
  });
 }
 return snapshots.sort((a,b)=>a.startedAt.localeCompare(b.startedAt)||a.taskId.localeCompare(b.taskId));
}

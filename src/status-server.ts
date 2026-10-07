import {createServer,type IncomingMessage,type ServerResponse} from "node:http";
import {FileExecutionStore} from "./execution-store.js";
import {SafeId} from "./ids.js";
import {buildTaskSnapshots} from "./status.js";

function json(response:ServerResponse,status:number,body:unknown){
 const text=JSON.stringify(body,null,2);
 response.writeHead(status,{"content-type":"application/json; charset=utf-8","content-length":Buffer.byteLength(text),"cache-control":"no-store"});
 response.end(text);
}

function projectFromPath(pathname:string,suffix:string){
 const match=pathname.match(new RegExp("^/api/projects/([^/]+)/"+suffix+"$"));
 if(!match)return undefined;
 const decoded=decodeURIComponent(match[1]);
 const parsed=SafeId.safeParse(decoded);
 return parsed.success?parsed.data:null;
}

export function createStatusServer(executionRoot=".companyswai/executions"){
 const store=new FileExecutionStore(executionRoot);
 return createServer(async(request:IncomingMessage,response:ServerResponse)=>{
  try{
   if(request.method!=="GET"){json(response,405,{error:"METHOD_NOT_ALLOWED"});return;}
   const url=new URL(request.url??"/","http://127.0.0.1");
   if(url.pathname==="/health"){json(response,200,{status:"ok"});return;}

   const executionsProject=projectFromPath(url.pathname,"executions");
   if(executionsProject===null){json(response,400,{error:"INVALID_PROJECT_ID"});return;}
   if(executionsProject){
    json(response,200,{projectId:executionsProject,records:await store.list(executionsProject)});
    return;
   }

   const tasksProject=projectFromPath(url.pathname,"tasks");
   if(tasksProject===null){json(response,400,{error:"INVALID_PROJECT_ID"});return;}
   if(tasksProject){
    const records=await store.list(tasksProject);
    json(response,200,{projectId:tasksProject,tasks:buildTaskSnapshots(records)});
    return;
   }

   json(response,404,{error:"NOT_FOUND"});
  }catch(error){
   json(response,500,{error:"INTERNAL_ERROR",message:error instanceof Error?error.message:String(error)});
  }
 });
}

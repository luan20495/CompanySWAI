import {join} from "node:path";
import {CompanyState} from "./state.js";
import {projectStatusView} from "./status-view.js";
import {createStatusServer} from "./status-server.js";

const raw=process.argv.slice(2),flag=(name:string)=>{const i=raw.indexOf(name);return i>=0?raw[i+1]:undefined;};
const stateDir=flag("--state-dir")??".companyswai",once=raw.includes("--json");
const [projectId,portArg="7337"]=raw.filter((arg,i)=>!arg.startsWith("--")&&raw[i-1]!=="--state-dir");
if(!projectId)throw new Error("Usage: npm run status -- <projectId> [port] [--json] [--state-dir dir]   (--json prints the status once and exits)");
const state=new CompanyState(stateDir);
if(once){
 console.log(JSON.stringify(await projectStatusView(state,projectId),null,2));
}else{
 const port=Number(portArg);
 if(!Number.isInteger(port)||port<1||port>65535)throw new Error("Invalid port");
 const server=createStatusServer(join(stateDir,"executions"),state);
 server.listen(port,"127.0.0.1",()=>{
  const base="http://127.0.0.1:"+port+"/api/projects/"+encodeURIComponent(projectId);
  console.log("CompanySWAI status API: "+base+"/status  "+base+"/tasks  "+base+"/telemetry  "+base+"/executions");
 });
}

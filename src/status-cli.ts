import {join} from "node:path";
import {createStatusServer} from "./status-server.js";

const projectId=process.argv[2];
const portArg=process.argv[3]??"7337",stateDir=process.argv[4]??".companyswai";
const port=Number(portArg);
if(!projectId)throw new Error("Usage: npm run status -- <projectId> [port] [stateDir]");
if(!Number.isInteger(port)||port<1||port>65535)throw new Error("Invalid port");

const server=createStatusServer(join(stateDir,"executions"));
server.listen(port,"127.0.0.1",()=>{
 console.log("CompanySWAI status API: http://127.0.0.1:"+port+"/api/projects/"+encodeURIComponent(projectId)+"/tasks");
});

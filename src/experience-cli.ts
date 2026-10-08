import {CompanyState} from "./state.js";

const raw=process.argv.slice(2),stateFlag=raw.indexOf("--state-dir"),stateDir=stateFlag>=0?raw[stateFlag+1]:".companyswai";
const [command="list",indexArg,by="owner"]=raw.filter((arg,i)=>arg!=="--state-dir"&&raw[i-1]!=="--state-dir");
const store=new CompanyState(stateDir).experience;
if(command==="list"){
 const items=await store.list();
 console.log(JSON.stringify(items.map((item,index)=>({index,status:item.status,scope:item.scope,confidence:item.confidence,projects:item.projects.length,pattern:item.pattern,reason:item.reason})),null,2));
}else if(command==="approve"||command==="reject"){
 const index=Number(indexArg);
 if(!Number.isInteger(index))throw new Error("Usage: npm run experience -- approve|reject <index> [by] [--state-dir dir]");
 console.log(JSON.stringify(await store.decide(index,command,by),null,2));
}else throw new Error("Usage: npm run experience -- list | approve <index> [by] | reject <index> [by] [--state-dir dir]");

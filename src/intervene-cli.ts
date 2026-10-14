import {CompanyState} from "./state.js";
import {MANUAL_KINDS,interventionActor,type InterventionKindValue} from "./intervention-log.js";
import {SafeId} from "./ids.js";

// Records something a person did outside the engine, so it is counted as an intervention. Writes only .companyswai/interventions.jsonl.
const USAGE=[
 "Usage: npm run intervene -- <kind> [--project id] [--task id] [--actor name] [--detail text] [--state-dir dir]",
 "       npm run intervene -- list [--project id] [--state-dir dir]",
 "  kinds: "+MANUAL_KINDS.join(", "),
 "  e.g.  npm run intervene -- redispatch --project shop-api --detail \"re-ran failed project as shop-api-b\" --actor owner",
 "  (dispatch, resume, stop, priority and approvals are recorded automatically by their own commands)"
].join("\n");

const args=process.argv.slice(2),valued=["--project","--task","--actor","--detail","--state-dir"];
const one=(name:string)=>{const i=args.indexOf(name);return i>=0?args[i+1]:undefined;};
args.forEach((a,i)=>{if(a.startsWith("--")&&!valued.includes(a)&&!valued.includes(args[i-1]??""))throw new Error("Unknown option "+a+"\n"+USAGE);});
for(const name of valued)if(args.includes(name)&&(one(name)===undefined||one(name)!.startsWith("--")))throw new Error(name+" needs a value\n"+USAGE);
const [command]=args.filter((a,i)=>!a.startsWith("--")&&!valued.includes(args[i-1]??""));
const state=new CompanyState(one("--state-dir")??".companyswai"),project=one("--project");
if(project!==undefined&&!SafeId.safeParse(project).success)throw new Error("Invalid project id");

if(command==="list"){
 const {entries,unreadable,exists}=await state.interventions.read();
 const shown=project?entries.filter(e=>e.projectId===project):entries;
 if(!exists)console.log("No intervention log yet ("+state.interventions.path+"). Nothing recorded before it existed is known.");
 else console.log(shown.map(e=>e.ts+"  "+e.kind.padEnd(19)+" "+(e.projectId??"-").padEnd(24)+" "+e.actor+" (unverified) via "+e.via+(e.detail?" — "+e.detail:"")).join("\n")||"No interventions recorded"+(project?" for '"+project+"'":"")+".");
 if(unreadable)console.log(unreadable+" unreadable line(s) skipped.");
}else if(command&&(MANUAL_KINDS as string[]).includes(command)){
 const entry=await state.interventions.append({kind:command as InterventionKindValue,projectId:project,taskId:one("--task"),actor:interventionActor(one("--actor")),via:"npm run intervene",detail:one("--detail")});
 console.log(JSON.stringify(entry,null,2));
}else throw new Error(USAGE);

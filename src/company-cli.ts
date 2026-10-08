import "dotenv/config";
import {readFile} from "node:fs/promises";
import {runAutonomous,PlanChangedError} from "./autonomous.js";
import {loadRuntime} from "./runtime.js";
import {MarkdownAgentRegistry} from "./md-agent-loader.js";
import {SkillCatalog} from "./skill-selector.js";
import {dryRunSelector} from "./providers/dry-run.js";
import {CompanyState} from "./state.js";
import {ProjectPlan} from "./project.js";

const USAGE="Usage: npm run company -- <project-brief.json|project-plan.json> [--dry-run] [--runtime config/providers.json] [--state-dir .companyswai] [--wait-approval[=seconds]] [--replan] [--max-parallel N]";
const args=process.argv.slice(2);
const valueFlags=["--runtime","--state-dir","--max-parallel"];
const flagValue=(name:string)=>{const i=args.indexOf(name);return i>=0?args[i+1]:undefined;};
const inputPath=args.find((a,i)=>!a.startsWith("--")&&!valueFlags.includes(args[i-1]??""));
if(!inputPath)throw new Error(USAGE);
const dryRun=args.includes("--dry-run"),runtimePath=flagValue("--runtime")??"config/providers.json";
const waitArg=args.find(a=>a==="--wait-approval"||a.startsWith("--wait-approval="));
const waitSeconds=waitArg?.includes("=")?Number(waitArg.split("=")[1]):3600;
if(waitArg&&!(waitSeconds>0))throw new Error("--wait-approval needs a positive number of seconds");
const maxParallel=flagValue("--max-parallel")?Number(flagValue("--max-parallel")):undefined;
if(maxParallel!=null&&!(Number.isInteger(maxParallel)&&maxParallel>0))throw new Error("--max-parallel needs a positive integer");

const state=new CompanyState(flagValue("--state-dir")??".companyswai");
const raw=JSON.parse(await readFile(inputPath,"utf8"));
const isPlan=raw&&typeof raw==="object"&&"tasks" in raw;
const selector=dryRun?dryRunSelector():(await loadRuntime(runtimePath)).selector;
const knownRoles=(await new MarkdownAgentRegistry().loadAll()).map(agent=>agent.id),knownSkills=(await new SkillCatalog().load()).map(skill=>skill.name);

try{
 // brief -> plan -> estimate -> approval -> execute (research..QA, review, gates, integration) -> final status -> retrospective; resumes from any crash.
 const result=await runAutonomous(isPlan?{plan:ProjectPlan.parse(raw)}:{brief:raw},{
  state,selector,dryRun,replan:args.includes("--replan"),knownRoles,knownSkills,
  approvalWait:waitArg?{pollMs:2000,timeoutMs:waitSeconds*1000}:undefined,orchestrator:maxParallel?{maxParallelTasks:maxParallel}:undefined
 });
 const {plan:_plan,...printable}=result;
 console.log(JSON.stringify({...printable,tasks:result.plan.tasks.length,mode:result.plan.mode,retrospective:await state.retrospectives.load(result.projectId)},null,2));
 // Exit codes: 0 accepted, 1 failed (task, QA or run), 2 parked (capacity, approval, blocked work) and resumable.
 const status=result.final?.status;
 if(result.stopped)process.exitCode=2;
 else if(status==="FAILED"||status==="FAILED_QA"||status==="BLOCKED"||status==="INCOMPLETE")process.exitCode=1;
 else if(status==="PARKED")process.exitCode=2;
}catch(error){
 if(error instanceof PlanChangedError){console.error(error.message);process.exitCode=3;}
 else throw error;
}

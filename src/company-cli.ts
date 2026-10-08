import "dotenv/config";
import {readFile} from "node:fs/promises";
import {ProjectBrief} from "./work-planner.js";
import {compileBriefToProjectPlan} from "./plan-compiler.js";
import {ProjectPlan} from "./project.js";
import {ProjectOrchestrator} from "./orchestrator.js";
import {loadRuntime} from "./runtime.js";
import {closeProject} from "./closeout.js";
import {MarkdownAgentRegistry} from "./md-agent-loader.js";
import {dryRunSelector} from "./providers/dry-run.js";
import {CompanyState} from "./state.js";

const USAGE="Usage: npm run company -- <project-brief.json|project-plan.json> [--dry-run] [--runtime config/providers.json] [--state-dir .companyswai] [--wait-approval[=seconds]]";
const args=process.argv.slice(2);
const flagValue=(name:string)=>{const i=args.indexOf(name);return i>=0?args[i+1]:undefined;};
const inputPath=args.find((a,i)=>!a.startsWith("--")&&!["--runtime","--state-dir"].includes(args[i-1]??""));
if(!inputPath)throw new Error(USAGE);
const dryRun=args.includes("--dry-run"),runtimePath=flagValue("--runtime")??"config/providers.json";
const waitArg=args.find(a=>a==="--wait-approval"||a.startsWith("--wait-approval="));
const waitSeconds=waitArg?.includes("=")?Number(waitArg.split("=")[1]):3600;
if(waitArg&&!(waitSeconds>0))throw new Error("--wait-approval needs a positive number of seconds");

const state=new CompanyState(flagValue("--state-dir")??".companyswai");
const raw=JSON.parse(await readFile(inputPath,"utf8"));
// A plan resumes exactly as written; a brief is recompiled (deterministically) and resumes from the persisted execution log.
const plan=raw&&typeof raw==="object"&&"tasks" in raw?ProjectPlan.parse(raw):await (async()=>{
 const brief=ProjectBrief.parse(raw),prior=await state.retrospectives.load(brief.projectId);
 return compileBriefToProjectPlan(brief,{projectLessons:prior?.lessons,experience:await state.experience.validatedLessons()});
})();

const selector=dryRun?dryRunSelector():(await loadRuntime(runtimePath)).selector;
const orchestrator=new ProjectOrchestrator(selector,state,waitArg?{approvalWait:{pollMs:2000,timeoutMs:waitSeconds*1000}}:{});
const summary=await orchestrator.run(plan);
const knownRoles=(await new MarkdownAgentRegistry().loadAll()).map(agent=>agent.id);
const {retrospective,experience}=await closeProject(state,summary,{dryRun,knownRoles});

console.log(JSON.stringify({summary,retrospective,validatedExperience:experience.filter(x=>x.status==="VALIDATED")},null,2));
// Exit codes: 1 = a task failed, 2 = run is parked (capacity/approval/blocked dependents) and can be resumed, 0 = everything done.
if(summary.failed.length)process.exitCode=1;
else if(summary.paused.length||summary.approvalRequired.length||summary.waiting.length)process.exitCode=2;

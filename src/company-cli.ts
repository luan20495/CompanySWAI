import "dotenv/config";
import {readFile} from "node:fs/promises";
import {ProjectBrief} from "./work-planner.js";
import {compileBriefToProjectPlan} from "./plan-compiler.js";
import {ProjectOrchestrator} from "./orchestrator.js";
import {loadRuntime} from "./runtime.js";
import {FileExecutionStore} from "./execution-store.js";
import {buildRetrospective,FileRetrospectiveStore} from "./retrospective.js";
import {DryRunProvider} from "./providers/dry-run.js";
import {CompanyExperienceStore} from "./company-experience.js";
import type {ProviderSelector} from "./provider-selector.js";

const args=process.argv.slice(2);
const briefPath=args.find(a=>!a.startsWith("--"));
const runtimeFlag=args.indexOf("--runtime");
const runtimePath=runtimeFlag>=0?args[runtimeFlag+1]:"config/providers.json";
const dryRun=args.includes("--dry-run");

if(!briefPath)throw new Error("Usage: npm run company -- <project-brief.json> [--dry-run] [--runtime config/providers.json]");

const brief=ProjectBrief.parse(JSON.parse(await readFile(briefPath,"utf8")));
const retrospectiveStore=new FileRetrospectiveStore();
const experienceStore=new CompanyExperienceStore();
const prior=await retrospectiveStore.load(brief.projectId);
const companyLessons=await experienceStore.validatedLessons();
const plan=await compileBriefToProjectPlan(brief,[...(prior?.lessons??[]),...companyLessons]);

const drySelector:ProviderSelector=request=>{
 const provider=new DryRunProvider();
 return {provider,profile:{provider:provider.name,model:provider.model,state:"AVAILABLE",capabilities:request.demand.capabilities,contextWindow:1000000,maxConcurrency:4},estimatedCost:0};
};

const selector=dryRun?drySelector:(await loadRuntime(runtimePath)).selector;
const summary=await new ProjectOrchestrator(selector).run(plan);
const records=await new FileExecutionStore().list(plan.projectId);
const retrospective=await retrospectiveStore.save(buildRetrospective(plan.projectId,records));
const experience=await experienceStore.observe(retrospective);

console.log(JSON.stringify({summary,retrospective,validatedExperience:experience.filter(x=>x.status==="VALIDATED")},null,2));

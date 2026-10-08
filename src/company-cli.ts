import "dotenv/config";
import {readFile} from "node:fs/promises";
import {ProjectBrief} from "./work-planner.js";
import {compileBriefToProjectPlan} from "./plan-compiler.js";
import {ProjectOrchestrator} from "./orchestrator.js";
import {loadRuntime} from "./runtime.js";
import {FileExecutionStore} from "./execution-store.js";
import {buildRetrospective,FileRetrospectiveStore} from "./retrospective.js";
import {DryRunProvider} from "./providers/dry-run.js";
import type {ProviderSelector} from "./provider-selector.js";

const args=process.argv.slice(2),briefPath=args.find(a=>!a.startsWith("--")),runtimeFlag=args.indexOf("--runtime"),runtimePath=runtimeFlag>=0?args[runtimeFlag+1]:"config/providers.json",dryRun=args.includes("--dry-run");
if(!briefPath)throw new Error("Usage: npm run company -- <project-brief.json> [--dry-run] [--runtime config/providers.json]");
const brief=ProjectBrief.parse(JSON.parse(await readFile(briefPath,"utf8"))),retrospectiveStore=new FileRetrospectiveStore(),prior=await retrospectiveStore.load(brief.projectId),plan=await compileBriefToProjectPlan(brief,prior?.lessons??[]);
const drySelector:ProviderSelector=request=>{const provider=new DryRunProvider();return {provider,profile:{provider:provider.name,model:provider.model,state:"AVAILABLE",capabilities:request.demand.capabilities,contextWindow:1000000,maxConcurrency:4},estimatedCost:0};};
const selector=dryRun?drySelector:(await loadRuntime(runtimePath)).selector,summary=await new ProjectOrchestrator(selector).run(plan),records=await new FileExecutionStore().list(plan.projectId),retrospective=await retrospectiveStore.save(buildRetrospective(plan.projectId,records));
console.log(JSON.stringify({summary,retrospective},null,2));

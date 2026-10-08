import "dotenv/config";
import {readFile} from "node:fs/promises";import {ProjectBrief} from "./work-planner.js";import {compileBriefToProjectPlan} from "./plan-compiler.js";import {ProjectOrchestrator} from "./orchestrator.js";import {loadRuntime} from "./runtime.js";import {FileExecutionStore} from "./execution-store.js";import {buildRetrospective,FileRetrospectiveStore} from "./retrospective.js";

const args=process.argv.slice(2),briefPath=args.find(a=>!a.startsWith("--")),runtimeFlag=args.indexOf("--runtime"),runtimePath=runtimeFlag>=0?args[runtimeFlag+1]:"config/providers.json";
if(!briefPath)throw new Error("Usage: npm run company -- <project-brief.json> [--runtime config/providers.json]");
const brief=ProjectBrief.parse(JSON.parse(await readFile(briefPath,"utf8"))),retrospectiveStore=new FileRetrospectiveStore(),prior=await retrospectiveStore.load(brief.projectId);
const plan=await compileBriefToProjectPlan(brief,prior?.lessons??[]),runtime=await loadRuntime(runtimePath),summary=await new ProjectOrchestrator(runtime.selector).run(plan),records=await new FileExecutionStore().list(plan.projectId),retrospective=await retrospectiveStore.save(buildRetrospective(plan.projectId,records));
console.log(JSON.stringify({summary,retrospective},null,2));

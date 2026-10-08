import {readFile} from "node:fs/promises";
import {ProjectBrief} from "./work-planner.js";
import {compileBriefToProjectPlan} from "./plan-compiler.js";
import {loadRuntimeConfig,toCapacityProfile} from "./runtime.js";
import {estimateProject} from "./estimate.js";

const args=process.argv.slice(2),briefPath=args.find(a=>!a.startsWith("--")),flag=args.indexOf("--runtime"),runtimePath=flag>=0?args[flag+1]:"config/providers.example.json";
if(!briefPath)throw new Error("Usage: npm run estimate -- <project-brief.json> [--runtime config/providers.json]");
const brief=ProjectBrief.parse(JSON.parse(await readFile(briefPath,"utf8"))),plan=await compileBriefToProjectPlan(brief),profiles=(await loadRuntimeConfig(runtimePath)).map(toCapacityProfile);
console.log(JSON.stringify(estimateProject(plan,profiles),null,2));

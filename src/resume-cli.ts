import "dotenv/config";
import {loadProjectPlan} from "./project.js";
import {ProjectOrchestrator} from "./orchestrator.js";
import {loadRuntime} from "./runtime.js";

const [planPath,...args]=process.argv.slice(2);
const runtimeFlag=args.indexOf("--runtime"),runtimePath=runtimeFlag>=0?args[runtimeFlag+1]:"config/providers.json";
if(!planPath)throw new Error("Usage: npm run resume -- <project-plan.json> [--runtime config/providers.json]");
const plan=await loadProjectPlan(planPath);
const runtime=await loadRuntime(runtimePath);
const summary=await new ProjectOrchestrator(runtime.selector).run(plan);
console.log(JSON.stringify(summary,null,2));

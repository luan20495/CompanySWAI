import "dotenv/config";
import {loadProjectPlan} from "./project.js";
import {ProjectOrchestrator} from "./orchestrator.js";
import {EchoProvider} from "./providers/echo.js";

const planPath=process.argv[2];
const dryRun=process.argv.includes("--dry-run");

if(!planPath)throw new Error("Usage: npm run dev -- <project-plan.json> --dry-run");
if(!dryRun)throw new Error("No live provider bootstrap is configured yet. Use --dry-run.");

const plan=await loadProjectPlan(planPath);
const orchestrator=new ProjectOrchestrator(()=>new EchoProvider());
const summary=await orchestrator.run(plan);
console.log(JSON.stringify(summary,null,2));

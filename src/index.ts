import "dotenv/config";
import {loadProjectPlan} from "./project.js";
import {ProjectOrchestrator} from "./orchestrator.js";
import {EchoProvider} from "./providers/echo.js";
import {loadRuntime} from "./runtime.js";
import type {ProviderSelector} from "./provider-selector.js";

const args=process.argv.slice(2);
const planPath=args.find(arg=>!arg.startsWith("--"));
const dryRun=args.includes("--dry-run");
const runtimeFlag=args.indexOf("--runtime");
const runtimePath=runtimeFlag>=0?args[runtimeFlag+1]:"config/providers.json";

if(!planPath)throw new Error("Usage: npm run dev -- <project-plan.json> [--dry-run] [--runtime config/providers.json]");

const plan=await loadProjectPlan(planPath);
const drySelector:ProviderSelector=request=>{
 const provider=new EchoProvider();
 return {
  provider,
  profile:{provider:provider.name,model:provider.model,state:"AVAILABLE",capabilities:request.demand.capabilities,contextWindow:Number.MAX_SAFE_INTEGER,maxConcurrency:1},
  estimatedCost:0
 };
};
const selector:ProviderSelector=dryRun?drySelector:(await loadRuntime(runtimePath)).selector;
const orchestrator=new ProjectOrchestrator(selector);
const summary=await orchestrator.run(plan);
console.log(JSON.stringify(summary,null,2));

import type {ModelProvider,ModelRequest,ModelResponse} from "../provider.js";
import type {ProviderSelector} from "../provider-selector.js";
import {REVIEW_REQUEST_PREFIX} from "../output-parser.js";

export class DryRunProvider implements ModelProvider{
 readonly name="dry-run";
 constructor(readonly model="deterministic"){}
 async generate(request:ModelRequest):Promise<ModelResponse>{
  const isReviewer=request.prompt.startsWith(REVIEW_REQUEST_PREFIX);
  const text=isReviewer
   ?"PASS\n\n## Evidence\nDry-run reviewer accepted deterministic fixture output.\n\n## Blockers\nNone."
   :"## Deliverables\nDry-run output for: "+request.prompt.slice(0,120)+"\n\n## Decisions\nNo production decision; dry-run only.\n\n## Evidence\nDeterministic provider fixture.\n\n## Blockers\nNone.\n\n## Handoff\nContinue to the next dependency.";
  return {text,inputTokens:Math.max(1,Math.ceil((request.system.length+request.prompt.length)/4)),outputTokens:Math.max(1,Math.ceil(text.length/4))};
 }
}

/** Selector that serves every task from the deterministic provider at zero cost. */
export function dryRunSelector():ProviderSelector{
 const selector=((request=>{
  const provider=new DryRunProvider();
  return {provider,profile:{id:"dry-run",provider:provider.name,model:provider.model,state:"AVAILABLE" as const,capabilities:request.demand.capabilities,contextWindow:Number.MAX_SAFE_INTEGER,maxConcurrency:4},estimatedCost:0};
 }) as ProviderSelector);
 return selector;
}

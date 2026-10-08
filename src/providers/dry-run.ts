import type {ModelProvider,ModelRequest,ModelResponse} from "../provider.js";

export class DryRunProvider implements ModelProvider{
 readonly name="dry-run";
 constructor(readonly model="deterministic"){}
 async generate(request:ModelRequest):Promise<ModelResponse>{
  const isReviewer=/independent reviewer|first non-empty line must be pass/i.test(request.system);
  const text=isReviewer
   ?"PASS\n\n## Evidence\nDry-run reviewer accepted deterministic fixture output."
   :"## Deliverables\nDry-run output for: "+request.prompt.slice(0,120)+"\n\n## Decisions\nNo production decision; dry-run only.\n\n## Risks\nDry-run does not call a live model.\n\n## Evidence\nDeterministic provider fixture.\n\n## Handoff\nContinue to the next dependency.";
  return {text,inputTokens:Math.max(1,Math.ceil((request.system.length+request.prompt.length)/4)),outputTokens:Math.max(1,Math.ceil(text.length/4))};
 }
}

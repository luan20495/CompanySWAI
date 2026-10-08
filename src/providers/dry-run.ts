import type {ModelProvider,ModelRequest,ModelResponse} from "../provider.js";
import type {ProviderSelector} from "../provider-selector.js";
import {REVIEW_REQUEST_PREFIX} from "../output-parser.js";

/**
 * Deterministic provider for dry runs, CI and benchmarks. It never calls a model: it fabricates output that satisfies the
 * output contract and every validator, keyed only on the request metadata (section titles, validators, parameters),
 * never on agent roles.
 */
export type DryRunOptions={
 /** Task IDs whose first review answers CHANGES_REQUIRED, so the revision loop is exercised. */
 requestChangesFor?:Iterable<string>;
 /** Added to every response so tests can tell outputs apart. */
 latencyMs?:number;
};
const today=()=>new Date().toISOString().slice(0,10);
const reviewedTask=(taskId:string)=>taskId.replace(/--review-\d+(?:-\d+)?$/,"");
const reviewVersion=(taskId:string)=>Number(taskId.match(/--review-(\d+)/)?.[1]??1);

function sectionBody(title:string,request:ModelRequest):string{
 const meta=request.meta,params=meta?.params??{},external=params.externalResearch===true;
 const subject=request.prompt.split("\n").find(l=>l.trim()&&!l.startsWith("---"))?.slice(0,100)??"the task";
 switch(title){
  case "Deliverables":return "Dry-run deliverable for: "+subject+(params.workspaceConfigured===true&&meta?.kind==="maker"?"\n\n```file dry-run/"+(meta?.taskId??"task")+".md\nDry-run output for "+(meta?.taskId??"task")+"\n```":"");
  case "Decisions":return meta?.kind==="review"&&meta.validators.includes("architecture-review")?"- Accept the proposed architecture as the baseline.":"No production decision; dry-run only.";
  case "Evidence":return "Deterministic provider fixture; no model was called.";
  case "Blockers":return "None.";
  case "Handoff":return "Continue to the next dependency.";
  case "Sources":return external?"- [S1] Dry-run reference | https://example.com/dry-run | retrieved: "+today()+" | authority: MEDIUM | published: "+today():"- [S1] Project brief | brief:objective | retrieved: "+today()+" | authority: HIGH";
  case "Claims":return "- [C1] FACT [topic: scope]: The brief asks for the described product. | cites: S1\n- [C2] ASSUMPTION: Standard industry practices apply.\n- [C3] INFERENCE: The scope is feasible with a standard stack. | from: C1,C2\n- [C4] RECOMMENDATION: Start with the thinnest end-to-end slice. | based-on: C1,C3";
  case "Conflicts":return "None.";
  case "Requirements":return "- [REQ-001] FACT: The product delivers the described core capability. (basis: brief)\n  - [AC-001.1] Given the core flow, when a user completes it, then the expected result is produced.\n- [REQ-002] ASSUMPTION: Reasonable defaults apply to unspecified behaviour.\n  - [AC-002.1] Given an unspecified case, when it occurs, then the documented default applies.\n- [REQ-003] RECOMMENDATION: Failures are visible to operators.\n  - [AC-003.1] Given a failure, when it occurs, then it is logged with context.";
  case "QA Status":return "PASS — every requirement has a passing dry-run check.";
  case "Traceability":{
   const ids=meta?.requirementIds?.length?meta.requirementIds:["REQ-001","REQ-002","REQ-003"];
   return ids.map((id,i)=>"- ["+id+"] -> [T-"+String(i+1).padStart(3,"0")+"] PASS: dry-run check for "+id+" | evidence: deterministic fixture").join("\n");
  }
  case "Architecture Review":return ((params.architectureCategories as string[]|undefined)??[]).map(c=>"- "+c+": PASS — adequate for the dry-run project").join("\n")||"- modularity: PASS — adequate";
  case "Unresolved Risks":return "None.";
  default:return "Dry-run content for section "+title+".";
 }
}

export class DryRunProvider implements ModelProvider{
 readonly name="dry-run";
 private changed=new Set<string>();
 constructor(readonly model="deterministic",private options:DryRunOptions={}){this.changed=new Set(options.requestChangesFor??[]);}
 async generate(request:ModelRequest):Promise<ModelResponse>{
  const meta=request.meta,isReviewer=meta?meta.kind==="review":request.prompt.startsWith(REVIEW_REQUEST_PREFIX);
  const sections=meta?.sections?.length?meta.sections:["Deliverables","Decisions","Evidence","Blockers","Handoff"];
  let verdict="PASS";
  if(isReviewer&&meta&&this.changed.has(reviewedTask(meta.taskId))&&reviewVersion(meta.taskId)===1)verdict="CHANGES_REQUIRED";
  const body=sections.map(title=>"## "+title+"\n"+(verdict==="CHANGES_REQUIRED"&&title==="Blockers"?"- Dry-run reviewer requests one revision to prove the revision loop.":sectionBody(title,request))).join("\n\n");
  const text=isReviewer?verdict+"\n\n"+(verdict==="CHANGES_REQUIRED"?"Dry-run reviewer requests changes on the first round.\n\n":"")+body:body;
  if(this.options.latencyMs)await new Promise(resolve=>setTimeout(resolve,this.options.latencyMs));
  return {text,inputTokens:Math.max(1,Math.ceil((request.system.length+request.prompt.length)/4)),outputTokens:Math.max(1,Math.ceil(text.length/4))};
 }
}

/** Selector that serves every task from the deterministic provider at zero cost. */
export function dryRunSelector(options:DryRunOptions={}):ProviderSelector{
 const provider=new DryRunProvider("deterministic",options);
 return (request=>({provider,profile:{id:"dry-run",provider:provider.name,model:provider.model,state:"AVAILABLE" as const,capabilities:request.demand.capabilities,contextWindow:Number.MAX_SAFE_INTEGER,maxConcurrency:4},estimatedCost:0})) as ProviderSelector;
}

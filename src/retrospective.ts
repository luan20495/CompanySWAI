import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {writeFileAtomic} from "./fs-atomic.js";
import {z} from "zod";
import {SafeId} from "./ids.js";
import {baseTaskId,settledRecords,type BudgetReport} from "./budget.js";
import type {ExecutionRecordValue} from "./execution-record.js";
import type {ProjectRunSummary} from "./orchestrator.js";
import {redact} from "./secrets.js";

/** A generalised, project-free lesson proposed for company experience. `scope` is "company" or "role:<agent id>". */
export const Candidate=z.object({pattern:z.string().min(1),scope:z.string().regex(/^(company|role:[A-Za-z0-9._-]+)$/),evidence:z.array(z.string()).min(1)});
export type CandidateValue=z.infer<typeof Candidate>;

export const Retrospective=z.object({
 projectId:SafeId,createdAt:z.string().datetime(),dryRun:z.boolean().default(false),
 totalRuns:z.number().int().nonnegative(),failures:z.number().int().nonnegative(),paused:z.number().int().nonnegative(),
 revisions:z.number().int().nonnegative().default(0),reviewRounds:z.number().int().nonnegative().default(0),
 inputTokens:z.number().int().nonnegative(),outputTokens:z.number().int().nonnegative(),
 estimatedCost:z.number().nonnegative().default(0),actualCost:z.number().nonnegative(),
 /** Project-local lessons: may be specific, are only ever fed back to this same project. */
 lessons:z.array(z.string()),
 /** Generalised lessons proposed for the company; they still have to pass validation before reuse. */
 candidates:z.array(Candidate).default([])
});
export type RetrospectiveValue=z.infer<typeof Retrospective>;

// Generic wording on purpose: these are the only strings that can ever become company experience from a retrospective.
export const PATTERNS={
 failures:"Provider or task failures occurred; inspect failed execution records before reusing the same routing strategy.",
 capacity:"Capacity pauses occurred; provision fallback capacity or reduce concurrency before the next comparable run.",
 estimates:"Actual model cost exceeded estimates by more than 25%; increase future token/cost estimates for similar tasks.",
 revisions:(role:string)=>"Work by "+role+" repeatedly needed review revisions; tighten its Done-only-when criteria and input context before assigning comparable work.",
 contract:"Agents repeatedly violated the output contract; keep contract sections short and explicit in the task prompt.",
 clean:"Execution completed without a detected capacity, failure or material cost-estimation issue."
};
const REVISION_THRESHOLD=2;

export function buildRetrospective(projectId:string,records:ExecutionRecordValue[],options:{dryRun?:boolean}={}):RetrospectiveValue{
 const terminal=records.filter(r=>r.status!=="STARTED"&&r.status!=="CHECKPOINTED");
 const failedRecords=terminal.filter(r=>r.status==="FAILED"),failures=failedRecords.length,paused=terminal.filter(r=>r.status==="PAUSED_CAPACITY").length;
 const settled=settledRecords(records),actualCost=settled.reduce((s,r)=>s+(r.actualCost??0),0),estimatedCost=settled.reduce((s,r)=>s+(r.estimatedCost??0),0);
 const succeeded=records.filter(r=>r.status==="SUCCEEDED");
 const reviewRounds=succeeded.filter(r=>/--review-\d+$/.test(r.taskId)).length;
 const revisionsByRole=new Map<string,number>();
 for(const review of succeeded.filter(r=>/--review-\d+$/.test(r.taskId)&&/^\s*CHANGES_REQUIRED/i.test(r.output.trimStart()))){
  const makerId=baseTaskId(review.taskId),maker=succeeded.find(r=>r.taskId===makerId);
  if(maker)revisionsByRole.set(maker.agentRole,(revisionsByRole.get(maker.agentRole)??0)+1);
 }
 const revisions=[...revisionsByRole.values()].reduce((a,b)=>a+b,0);
 const lessons:string[]=[],candidates:CandidateValue[]=[];
 const add=(lesson:string,candidate:CandidateValue)=>{lessons.push(lesson);candidates.push(candidate);};
 if(failures)add(PATTERNS.failures,{pattern:PATTERNS.failures,scope:"company",evidence:[failures+" failed execution(s) in "+terminal.length+" terminal run(s)"]});
 if(failedRecords.some(r=>/Output contract violated/.test(r.error??"")))add(PATTERNS.contract,{pattern:PATTERNS.contract,scope:"company",evidence:["contract violation recorded on a failed execution"]});
 if(paused)add(PATTERNS.capacity,{pattern:PATTERNS.capacity,scope:"company",evidence:[paused+" capacity pause(s)"]});
 if(estimatedCost>0&&actualCost>estimatedCost*1.25)add(PATTERNS.estimates,{pattern:PATTERNS.estimates,scope:"company",evidence:["actual/estimated cost ratio "+(actualCost/estimatedCost).toFixed(2)]});
 for(const [role,count] of revisionsByRole)if(count>=REVISION_THRESHOLD)add(PATTERNS.revisions(role),{pattern:PATTERNS.revisions(role),scope:"role:"+role,evidence:[count+" CHANGES_REQUIRED verdicts for this role"]});
 if(!lessons.length)lessons.push(PATTERNS.clean);
 return Retrospective.parse({
  projectId,createdAt:new Date().toISOString(),dryRun:options.dryRun??false,totalRuns:terminal.length,failures,paused,revisions,reviewRounds,
  inputTokens:terminal.reduce((s,r)=>s+r.inputTokens,0),outputTokens:terminal.reduce((s,r)=>s+r.outputTokens,0),estimatedCost,actualCost,lessons,candidates
 });
}

const money=(n:number)=>"$"+n.toFixed(4);
const line=(name:string,l:BudgetReport["project"])=>{
 const subscription=l.runs>0&&l.subscriptionRuns===l.runs;
 return "| "+name+" | "+(l.limit!=null?money(l.limit):"—")+" | "+(subscription?"subscription (no API price)":money(l.estimated))+" | "+(subscription?"subscription (no API price)":money(l.actual))+" | "+l.runs+(l.subscriptionRuns&&!subscription?" ("+l.subscriptionRuns+" subscription)":"")+" |";
};
/** RETROSPECTIVE.md: what happened, what it cost versus the estimate, and which lessons were proposed. */
export function renderRetrospective(retro:RetrospectiveValue,summary:Pick<ProjectRunSummary,"completed"|"failed"|"paused"|"approvalRequired"|"waiting"|"skipped">,budget:BudgetReport){
 const table=(title:string,rows:Record<string,BudgetReport["project"]>)=>Object.keys(rows).length?["",title,"","| Name | Limit | Estimated | Actual | Runs |","|---|---|---|---|---|",...Object.entries(rows).map(([name,l])=>line(name,l))]:[];
 return [
  "# RETROSPECTIVE","","Project: `"+retro.projectId+"`"+(retro.dryRun?" (dry run — not used for company learning)":"")+" — "+retro.createdAt,"",
  "## Outcome","",
  "- completed: "+(summary.completed.join(", ")||"none"),
  "- failed: "+(summary.failed.join(", ")||"none"),
  "- paused (capacity): "+(summary.paused.join(", ")||"none"),
  "- awaiting approval: "+(summary.approvalRequired.join(", ")||"none"),
  "- waiting on dependencies: "+(summary.waiting.join(", ")||"none"),
  "- runs: "+retro.totalRuns+", failures: "+retro.failures+", review rounds: "+retro.reviewRounds+", revisions: "+retro.revisions,
  "- tokens: "+retro.inputTokens+" in / "+retro.outputTokens+" out","",
  "## Cost: estimate vs actual","","| Name | Limit | Estimated | Actual | Runs |","|---|---|---|---|---|",line("project",budget.project),
  ...table("### By department",budget.departments),...table("### By agent",budget.agents),...table("### By task",budget.tasks),"",
  "## Lessons (this project only)","",...retro.lessons.map(x=>"- "+redact(x)),"",
  "## Proposed company experience","",...(retro.candidates.length?retro.candidates.map(c=>"- ["+c.scope+"] "+redact(c.pattern)):["- none"]),""
 ].join("\n");
}

export class FileRetrospectiveStore{
 constructor(private root=".companyswai/retrospectives"){}
 private path(projectId:string){return join(this.root,SafeId.parse(projectId),"latest.json");}
 async save(value:RetrospectiveValue){const v=Retrospective.parse(value);await writeFileAtomic(this.path(v.projectId),JSON.stringify(v,null,2));return v;}
 async load(projectId:string){try{return Retrospective.parse(JSON.parse(await readFile(this.path(projectId),"utf8")));}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return undefined;throw e;}}
}

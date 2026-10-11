import {createHash} from "node:crypto";
import {realpath} from "node:fs/promises";
import {basename,resolve} from "node:path";
import {ProjectPlan,type ProjectPlanValue} from "./project.js";
import {SafeId} from "./ids.js";
import {ProjectOrchestrator,type OrchestratorOptions,type ProjectRunSummary} from "./orchestrator.js";
import type {ProviderSelector} from "./provider-selector.js";
import type {CompanyState} from "./state.js";
import {TakeoverError,changedParts,fingerprint,git,takeSnapshot,type Fingerprint,type Snapshot} from "./takeover-probe.js";
import {assessClassification,extractClassification,type AssessedItem,type TakeoverClassification} from "./takeover-evidence.js";
import {TAKEOVER_TASKS,buildTakeoverPlan,type TakeoverPlanOptions} from "./takeover-plan.js";
import {loadLedger,noExec,usableFor,type ExecEvidence} from "./takeover-exec.js";
import type {TakeoverRecordValue} from "./takeover-store.js";

/**
 * Brownfield takeover: understand an existing repository before anyone writes to it.
 *   snapshot (read-only git) -> analysis by the company's own roles through the normal runtime -> evidence rules enforced by the
 *   engine -> proof that the target did not change -> AUDIT_COMPLETE_WAITING_APPROVAL. Only `approveTakeover` unlocks writing.
 * The analysis agents get text only (no tools, no workspace), and the audit itself runs a fixed list of read-only git commands.
 */
export type TakeoverRunOptions={
 state:CompanyState;selector:ProviderSelector;projectId:string;workspace:string;focus?:string[];
 orchestrator?:OrchestratorOptions;now?:()=>Date;plan?:TakeoverPlanOptions;
};
export type TakeoverRunResult={record:TakeoverRecordValue;summary?:ProjectRunSummary;classification?:TakeoverClassification;report?:string};

const sha=(text:string)=>createHash("sha256").update(text).digest("hex");
const TERMINAL=new Set(["AUDIT_COMPLETE_WAITING_APPROVAL","APPROVED_FOR_EXECUTION"]);

export async function runTakeover(options:TakeoverRunOptions):Promise<TakeoverRunResult>{
 const {state,selector}=options,store=state.takeover,focus=(options.focus??[]).map(f=>f.trim()).filter(Boolean),projectId=SafeId.parse(options.projectId),root=await realpath(resolve(options.workspace)).catch(()=>resolve(options.workspace)),now=options.now??(()=>new Date());
 let record=await store.load(projectId);
 if(record&&resolve(record.workspace)!==root)throw new TakeoverError("Project '"+projectId+"' already audits "+record.workspace+"; use another project id for "+root,"BAD_STATE");
 if(record&&TERMINAL.has(record.status))return {record,classification:await store.readData<TakeoverClassification>(projectId,"classification.json"),report:await store.readText(projectId,"TAKEOVER-REPORT.md")};
 if(record&&record.status!=="AUDITING")throw new TakeoverError("Takeover '"+projectId+"' ended as "+record.status+(record.reason?" ("+record.reason+")":"")+"; audit again under a new project id","BAD_STATE");

 let snapshot:Snapshot,before:Fingerprint,plan:ProjectPlanValue,exec:ExecEvidence;
 if(!record){
  before=await fingerprint(root);snapshot=await takeSnapshot(root,now(),focus);
  if(snapshot.head!==before.head)throw new TakeoverError("The repository moved while the snapshot was taken; retry","TARGET_CHANGED");
  // Executed evidence recorded for THIS commit is frozen with the snapshot, so the plan, the assessment and the report all rest on the same set.
  exec=usableFor(await loadLedger(store,projectId),snapshot.head);
  plan=await buildTakeoverPlan(projectId,snapshot,{...options.plan,focus,exec});
  await store.writeJson(projectId,"executed-evidence.json",exec);await store.writeJson(projectId,"snapshot.json",snapshot);await store.writeJson(projectId,"fingerprint-before.json",before);await store.writeJson(projectId,"plan.json",plan);
  record=await store.save({version:1,projectId,workspace:root,status:"AUDITING",auditedHead:snapshot.head,branch:snapshot.branch,focus,startedAt:now().toISOString(),updatedAt:now().toISOString(),changedParts:[]});
  await state.memory.recordStatus(projectId,"takeover","AUDITING","read-only audit of "+basename(root)+" at "+snapshot.head.slice(0,10));
 }else{
  // Resuming: the stored snapshot and plan are the audit; if the target moved since, they no longer describe it.
  snapshot=(await store.readData<Snapshot>(projectId,"snapshot.json"))!;before=(await store.readData<Fingerprint>(projectId,"fingerprint-before.json"))!;plan=ProjectPlan.parse(await store.readData(projectId,"plan.json"));exec=(await store.readData<ExecEvidence>(projectId,"executed-evidence.json"))??noExec;
  const moved=changedParts(before,await fingerprint(root));
  if(moved.length)return {record:await store.save({...record,status:"TARGET_CHANGED",changedParts:moved,reason:"the target changed while the audit was parked ("+moved.join(", ")+"); a snapshot of an older state cannot be approved",updatedAt:now().toISOString()})};
 }

 const summary=await new ProjectOrchestrator(selector,state,{maxUpstreamChars:60_000,maxReviewArtifactChars:120_000,...options.orchestrator}).run(plan);
 if(!plan.tasks.every(t=>summary.completed.includes(t.id))){
  const why=summary.stopped?"stopped by operator: "+summary.stopped:summary.failed.length?"failed: "+summary.failed.join(", "):summary.paused.length?"waiting for provider capacity: "+summary.paused.join(", "):summary.approvalRequired.length?"approval required: "+summary.approvalRequired.join(", "):"unfinished: "+summary.waiting.join(", ");
  return {record:await store.save({...record,reason:why,updatedAt:now().toISOString()}),summary};
 }

 const records=await state.executions.list(projectId),finals=records.filter(r=>r.status==="SUCCEEDED"&&r.taskId===TAKEOVER_TASKS.classification),final=finals[finals.length-1];
 const parsed=final?extractClassification(final.output):{ok:false as const,reason:"no successful classification record"};
 if(!parsed.ok)return {record:await store.save({...record,status:"AUDIT_INVALID",reason:parsed.reason,updatedAt:now().toISOString()}),summary};
 const classification=assessClassification(parsed.value,snapshot,record.focus,exec),after=await fingerprint(root),changed=changedParts(before,after);
 const used=plan.tasks.map(t=>{const r=[...records].reverse().find(x=>x.status==="SUCCEEDED"&&x.taskId===t.id);return {task:t.id,role:t.agentRole,record:r?.id,skills:(r?.skillTrace?.used??[]).map(u=>u.name+"@"+u.version),reviewSkills:(t.review?.skillTrace?.used??[]).map(u=>u.name)};});
 const report=renderTakeoverReport({record,snapshot,classification,before,after,changed,used,exec});
 await store.writeJson(projectId,"classification.json",classification);await store.writeJson(projectId,"fingerprint-after.json",after);await store.writeText(projectId,"TAKEOVER-REPORT.md",report);
 const status=changed.length?"TARGET_CHANGED" as const:"AUDIT_COMPLETE_WAITING_APPROVAL" as const;
 record=await store.save({...record,status,changedParts:changed,reportHash:sha(report),counts:classification.counts,reason:changed.length?"the target changed during the audit ("+changed.join(", ")+"); the cause may be external, so this audit cannot be approved":undefined,updatedAt:now().toISOString()});
 await state.memory.recordStatus(projectId,"takeover",status,Object.entries(classification.counts).map(([k,v])=>k+" "+v).join(", "));
 return {record,summary,classification,report};
}

/** The user's explicit go-ahead. It also re-checks that the target is still at the audited commit. */
export async function approveTakeover(state:CompanyState,projectId:string,by:string,now=()=>new Date()):Promise<TakeoverRecordValue>{
 const record=await state.takeover.load(SafeId.parse(projectId));
 if(!record)throw new TakeoverError("No takeover exists for '"+projectId+"'","BAD_STATE");
 if(record.status!=="AUDIT_COMPLETE_WAITING_APPROVAL")throw new TakeoverError("Takeover '"+projectId+"' is "+record.status+"; only AUDIT_COMPLETE_WAITING_APPROVAL can be approved","BAD_STATE");
 const head=(await fingerprint(record.workspace)).head;
 if(head!==record.auditedHead)throw new TakeoverError("The target is now at "+head+" but the audit covers "+record.auditedHead+"; audit again under a new project id","TARGET_CHANGED");
 const approved=await state.takeover.save({...record,status:"APPROVED_FOR_EXECUTION",approvedBy:by,approvedAt:now().toISOString(),updatedAt:now().toISOString()});
 await state.memory.recordStatus(projectId,"takeover","APPROVED_FOR_EXECUTION","approved by "+by);
 return approved;
}

/**
 * Write gate for the autonomous pipeline. A plan whose workspace has a takeover must wait until that takeover is approved;
 * a plan tagged `brownfield` with no takeover at all is refused. Anything else is not affected.
 */
export const takeoverGate=(state:CompanyState)=>async(plan:ProjectPlanValue):Promise<string|undefined>=>{
 const record=plan.workspace?await state.takeover.forWorkspace(plan.workspace.path):undefined;
 if(record&&record.status==="APPROVED_FOR_EXECUTION"){
  // The approval covers the audited commit and what is built on it: a rewritten or unrelated history needs a new audit.
  const descends=await git(record.workspace,["merge-base","--is-ancestor",record.auditedHead,"HEAD"]).then(()=>true,()=>false);
  return descends?undefined:"takeover '"+record.projectId+"' was approved for "+record.auditedHead+" but "+record.workspace+" no longer descends from it: audit again under a new project id";
 }
 if(record)return "takeover '"+record.projectId+"' is "+record.status+": nothing may be written to "+record.workspace+" until the audit is complete and approved (npm run takeover -- approve "+record.projectId+")";
 if(plan.signals.some(s=>s.toLowerCase()==="brownfield"))return "brownfield project: run a read-only takeover of its workspace first (npm run takeover -- run <workspace> --project <id>)";
 return undefined;
};

const PARTS:Array<keyof Fingerprint>=["head","branch","refs","index","staged","worktree","untracked","ignored","gitDir","worktrees"];
const priorityRank=(p?:string)=>p?Number(p.slice(1)):9;
const execLines=(exec:ExecEvidence,head:string)=>{
 const gates=exec.records.filter(r=>r.kind==="gate"),junit=exec.records.filter(r=>r.kind==="junit"),n=(k:"tests"|"failures"|"errors"|"skipped")=>junit.reduce((t,r)=>t+(r.counts?.[k]??0),0);
 return ["Bound to commit "+head+(exec.otherCommits?" ("+exec.otherCommits+" record(s) for other commits were ignored)":"")+".","","| id | outcome | what | log sha256 |","|---|---|---|---|",
  ...gates.map(g=>"| "+g.id+" | "+g.outcome+" | "+(g.command?g.command+" — ":"")+g.summary+" | "+(g.logSha256?.slice(0,12)??"none")+" |"),
  ...(junit.length?["| junit (×"+junit.length+" classes) | "+(junit.some(r=>r.outcome==="FAIL")?"FAIL":"PASS")+" | "+n("tests")+" tests, "+n("failures")+" failures, "+n("errors")+" errors, "+n("skipped")+" skipped | per class in verification.json |"]:[])];
};
const line=(i:AssessedItem)=>"- **"+i.id+"** "+i.area+" — "+i.claim+" ["+i.status+(i.status!==i.proposedStatus?", proposed "+i.proposedStatus:"")+" · "+i.verification+"]"+(i.evidence.length?"\n  evidence: "+i.evidence.map(e=>e.ref+" ("+e.classes.join("/")+(e.executed?" · ran "+e.executed:"")+")").join(", "):"")+(i.note?"\n  note: "+i.note:"")+(i.adjustments.length?"\n  engine: "+i.adjustments.join("; "):"");

export function renderTakeoverReport(input:{record:TakeoverRecordValue;snapshot:Snapshot;classification:TakeoverClassification;before:Fingerprint;after:Fingerprint;changed:string[];used:Array<{task:string;role:string;record?:string;skills:string[];reviewSkills:string[]}>;exec?:ExecEvidence}){
 const {record,snapshot:s,classification:c,before,after,changed,used}=input,exec=input.exec??noExec,open=c.items.filter(i=>i.status!=="DONE");
 const by=(p:string)=>open.filter(i=>(i.priority??"none")===p);
 return [
  "# Takeover report: "+record.projectId,"",
  "Status: "+(changed.length?"TARGET_CHANGED":"AUDIT_COMPLETE_WAITING_APPROVAL"),
  "Workspace: "+record.workspace,"Audited commit: "+s.head+" (branch "+s.branch+", "+s.commitCount+" commits, "+s.files.total+" tracked files)","Snapshot taken: "+s.takenAt,
  s.dirty.total?"Uncommitted changes at snapshot time (NOT audited): "+s.dirty.total:"Working tree was clean at snapshot time.","",
  "## Read-only proof","",changed.length?"**The target changed while the audit ran** ("+changed.join(", ")+"). The audit only runs read-only git commands and gives the agents no access, so the cause may be external, but this audit cannot be approved.":"No change to the target was observed between the start and the end of the audit.","",
  "| part | before | after | same |","|---|---|---|---|",...PARTS.map(k=>"| "+k+" | "+String(before[k]).slice(0,12)+" | "+String(after[k]).slice(0,12)+" | "+(before[k]===after[k]?"yes":"**NO**")+" |"),"",
  "## Evidence limits","",
  ...(exec.records.length?[
   "- The audit itself executed nothing. EXECUTED means a run of THIS commit that the operator recorded before the audit (listed below); the engine did not re-run it and cannot vouch that the log is genuine beyond its recorded hash. STATIC means implementation (and test) source exists in the committed tree.",
   "- In this verified audit a DONE needs an executed PASS; anything the executed results do not cover stays PARTIAL, NOT_DONE, BLOCKED or UNKNOWN."
  ]:[
   "- Nothing was executed: no test, build, migration, install or script of the target ran. A STATIC item means implementation (and test) source exists in the committed tree; no item here is EXECUTED.",
   "- A DONE here is therefore a static finding. Re-verify against the exact commit (tests, runtime flows) before calling it passed."]),
  "- Documents alone never carried a DONE: the engine downgraded such items and discarded citations it could not find in the snapshot.","",
  ...(exec.records.length||exec.otherCommits?["## Executed evidence","",...execLines(exec,s.head),""]:[]),
  "## Summary","",Object.entries(c.counts).map(([k,v])=>k+" "+v).join(" · "),"",
  "## Remaining work (not DONE)","",...(["P0","P1","P2","P3","none"] as const).flatMap(p=>by(p).length?["### "+(p==="none"?"Unprioritised":p),"",...by(p).sort((a,b)=>priorityRank(a.priority)-priorityRank(b.priority)).map(line),""]:[]),
  "## Done (static evidence)","",...(c.items.filter(i=>i.status==="DONE").map(line)),"",
  "## Critical path","",...(c.criticalPath.length?c.criticalPath.map((x,n)=>(n+1)+". "+x):["(none given)"]),"",
  ...(c.focusGaps.length?["## Focus areas the analysis did not cover","",...c.focusGaps.map(f=>"- "+f),""]:[]),
  "## How the audit ran","",...used.map(u=>"- "+u.task+" — "+u.role+(u.skills.length?" — skills: "+u.skills.join(", "):"")+(u.reviewSkills.length?" — review skills: "+u.reviewSkills.join(", "):"")+(u.record?" — execution "+u.record:"")),"",
  "## Next step","","Nothing has been changed and nothing will be until you approve: `npm run takeover -- approve "+record.projectId+"`. Writing then goes through the normal planner, reviewer, QA and gates.",""
 ].join("\n");
}

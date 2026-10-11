import type {CompanyState} from "./state.js";
import type {TakeoverClassification} from "./takeover-evidence.js";
import type {TakeoverRecordValue} from "./takeover-store.js";

/** Read-only text view of takeovers, shared by `npm run takeover -- status` and the operator `takeover` command. */
const NEXT:Record<string,string>={
 AUDITING:"run the same takeover command again to resume (unfinished analysis tasks are not re-run)",
 AUDIT_COMPLETE_WAITING_APPROVAL:"review the report; writing stays blocked until: npm run takeover -- approve <project>",
 APPROVED_FOR_EXECUTION:"approved: plan the remaining work through the normal pipeline (company)",
 AUDIT_INVALID:"the analysis output was unusable; audit again under a new project id",
 TARGET_CHANGED:"the target changed during or after the audit; audit again under a new project id"
};

function describe(record:TakeoverRecordValue,classification?:TakeoverClassification){
 const lines=["TAKEOVER "+record.projectId+": "+record.status,"  workspace: "+record.workspace,"  audited commit: "+record.auditedHead+" ("+record.branch+")"];
 if(record.counts)lines.push("  classification: "+Object.entries(record.counts).map(([k,v])=>k+" "+v).join(" · "));
 if(classification){
  const open=classification.items.filter(i=>i.status!=="DONE"&&(i.priority==="P0"||i.priority==="P1"));
  if(open.length)lines.push("  open P0/P1:",...open.slice(0,12).map(i=>"    "+i.priority+" "+i.id+" "+i.area+" ["+i.status+"]"));
 }
 if(record.changedParts.length)lines.push("  target changed: "+record.changedParts.join(", "));
 if(record.reason)lines.push("  reason: "+record.reason);
 if(record.approvedBy)lines.push("  approved by "+record.approvedBy+" at "+record.approvedAt);
 lines.push("  next: "+(NEXT[record.status]??""));
 return lines.join("\n");
}

export async function renderTakeoverStatus(state:CompanyState,projectId?:string){
 const records=projectId?[await state.takeover.load(projectId)].filter((r):r is TakeoverRecordValue=>Boolean(r)):await state.takeover.list();
 if(!records.length)return projectId?"No takeover exists for '"+projectId+"'.":"No takeover has been started.";
 const blocks:string[]=[];
 for(const record of records)blocks.push(describe(record,await state.takeover.readData<TakeoverClassification>(record.projectId,"classification.json")));
 return blocks.join("\n\n");
}

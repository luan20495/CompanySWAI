import {z} from "zod";
import {resolveRef,type Snapshot} from "./takeover-probe.js";
import {executedFor,lookupOf,noExec,type ExecEvidence,type ExecOutcomeValue} from "./takeover-exec.js";

/**
 * What the analysis agents may say, and what the engine lets stand. Agents cannot read the repository: they classify from an
 * evidence pack and cite it. The engine then re-checks every citation against the snapshot, derives the evidence class from the
 * path itself, and downgrades anything the evidence does not carry (docs alone never prove DONE; the audit executes nothing, so EXECUTED only comes from recorded runs of this exact commit).
 */
export const TakeoverStatusValue=z.enum(["DONE","PARTIAL","NOT_DONE","BLOCKED","UNKNOWN"]);
export type TakeoverStatusName=z.infer<typeof TakeoverStatusValue>;
export const PriorityValue=z.enum(["P0","P1","P2","P3"]);

export const AgentItem=z.object({
 id:z.string().min(1).max(64),area:z.string().min(1).max(200),claim:z.string().min(1).max(600),status:TakeoverStatusValue,priority:PriorityValue.optional(),
 evidence:z.array(z.string().min(1).max(300)).max(20).default([]),note:z.string().max(600).optional()
});
export const AgentClassification=z.object({items:z.array(AgentItem).min(1).max(150),criticalPath:z.array(z.string().min(1).max(300)).max(15).default([])});
export type AgentClassificationValue=z.infer<typeof AgentClassification>;

/** STATIC: implementation (and tests) exist in the committed source. CLAIMED: only documents say so. EXECUTED: a recorded run for this exact commit backs it (the audit itself never runs anything). */
export type Verification="STATIC"|"CLAIMED"|"EXECUTED"|"NONE";
export type AssessedItem={
 id:string;area:string;claim:string;status:TakeoverStatusName;proposedStatus:TakeoverStatusName;priority?:z.infer<typeof PriorityValue>;
 verification:Verification;evidence:Array<{ref:string;classes:string[];executed?:ExecOutcomeValue;executedDetail?:string}>;rejectedEvidence:string[];adjustments:string[];note?:string;
};

const has=(classes:Set<string>,...names:string[])=>names.some(n=>classes.has(n));

export function assessItem(item:z.infer<typeof AgentItem>,snapshot:Snapshot,index:Set<string>,exec:ExecEvidence=noExec):AssessedItem{
 const evidence:AssessedItem["evidence"]=[],rejected:string[]=[],classes=new Set<string>(),lookup=lookupOf(exec),verified=exec.records.length>0;
 for(const ref of new Set(item.evidence)){
  const ran=verified?executedFor(lookup,ref.trim(),snapshot):undefined,isExec=ref.trim().startsWith("exec:");
  // `exec:<id>` names a recorded run; anything else is a path, directory or commit that must exist in the snapshot.
  const resolved=isExec?(ran?{ref:ref.trim(),classes:[ran.outcome==="NOT_RUN"?"NOT_RUN":"EXECUTED"]}:undefined):resolveRef(snapshot,ref,index);
  if(resolved){evidence.push({ref:resolved.ref,classes:resolved.classes,...(ran?{executed:ran.outcome,executedDetail:ran.detail}:{})});resolved.classes.forEach(c=>classes.add(c));}else rejected.push(ref);
 }
 const passed=evidence.some(e=>e.executed==="PASS"),failed=evidence.some(e=>e.executed==="FAIL");
 const adjustments:string[]=[];let status=item.status,verification:Verification="NONE";
 // Implementation and test must come from different citations, or one broad directory could vouch for both.
 const code=evidence.some(a=>a.classes.includes("SOURCE")&&evidence.some(b=>b!==a&&b.classes.includes("TEST"))),implemented=has(classes,"SOURCE","TEST","CONFIG","EXECUTED");
 if(rejected.length)adjustments.push(rejected.length+" citation(s) are not tracked paths, specific directories or commits in the snapshot and were discarded");
 const ran=passed||failed;
 if(status==="DONE"){
  if(failed){status="PARTIAL";verification="EXECUTED";adjustments.push("a cited executed result FAILED, so this cannot be DONE");}
  else if(code){
   if(!verified)verification="STATIC";
   else if(passed)verification="EXECUTED";
   else{status="PARTIAL";verification="STATIC";adjustments.push("DONE in a verified audit needs an executed PASS among the citations (a passing test class or exec:<gate>); only static evidence was found");}
  }
  else if(implemented){status="PARTIAL";verification=ran?"EXECUTED":"STATIC";adjustments.push("DONE needs implementation source and test source cited separately; found "+[...classes].join("/"));}
  else{status="UNKNOWN";adjustments.push(classes.size?"DONE cannot rest on "+[...classes].join("/")+" alone (documents and history do not prove completion)":"DONE without any valid evidence");}
 }else if(status==="PARTIAL"){
  if(implemented)verification=ran?"EXECUTED":"STATIC";
  else if(classes.size){verification="CLAIMED";status="UNKNOWN";adjustments.push("PARTIAL cannot rest on documents/history alone");}
  else{status="UNKNOWN";adjustments.push("PARTIAL without any valid evidence");}
 }else if(status==="NOT_DONE"||status==="BLOCKED"){
  if(!classes.size){status="UNKNOWN";adjustments.push(item.status+" without any valid evidence");}
  else verification=ran?"EXECUTED":implemented?"STATIC":has(classes,"NOT_RUN")&&classes.size===1?"NONE":"CLAIMED";
 }
 return {id:item.id,area:item.area,claim:item.claim,status,proposedStatus:item.status,priority:item.priority,verification,evidence,rejectedEvidence:rejected,adjustments,note:item.note};
}

export type TakeoverClassification={
 counts:Record<TakeoverStatusName,number>;items:AssessedItem[];criticalPath:string[];focusGaps:string[];
};

/** Enforces the evidence rules on the agents' classification and makes sure every requested focus area got an answer. */
export function assessClassification(raw:AgentClassificationValue,snapshot:Snapshot,focus:string[]=[],exec:ExecEvidence=noExec):TakeoverClassification{
 const index=new Set(snapshot.tracked),seen=new Set<string>(),items:AssessedItem[]=[];
 for(const item of raw.items){
  let id=item.id;for(let n=2;seen.has(id);n++)id=item.id+"-"+n;seen.add(id);
  items.push(assessItem({...item,id},snapshot,index,exec));
 }
 const focusGaps:string[]=[];
 focus.forEach((topic,n)=>{
  const needle=new RegExp("(^|[^a-z0-9])"+topic.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\/]/g,"\\$&")+"([^a-z0-9]|$)");
  if(!topic.trim()||items.some(i=>needle.test((i.area+" "+i.claim).toLowerCase())))return;
  focusGaps.push(topic);
  let id="focus-"+(n+1);for(let k=2;seen.has(id);k++)id="focus-"+(n+1)+"-"+k;seen.add(id);
  items.push({id,area:topic,claim:"No assessment was produced for this requested focus area",status:"UNKNOWN",proposedStatus:"UNKNOWN",verification:"NONE",evidence:[],rejectedEvidence:[],adjustments:["added by the engine: the analysis did not cover this focus area"]});
 });
 const counts:Record<TakeoverStatusName,number>={DONE:0,PARTIAL:0,NOT_DONE:0,BLOCKED:0,UNKNOWN:0};
 for(const item of items)counts[item.status]++;
 return {counts,items,criticalPath:raw.criticalPath,focusGaps};
}

/**
 * The last ```json block of an agent output that parses as a classification, or the reason it did not. A closing fence is any later
 * ``` that makes the block valid JSON, so a code fence inside a string ("note") does not cut the block short.
 */
export function extractClassification(output:string):{ok:true;value:AgentClassificationValue}|{ok:false;reason:string}{
 const starts=[...output.matchAll(/```json[^\S\n]*\n/gi)].map(m=>m.index!+m[0].length);
 if(!starts.length)return {ok:false,reason:"the classification output has no ```json block"};
 let last="";
 for(const start of starts.reverse()){
  for(let end=output.indexOf("```",start);end>=0;end=output.indexOf("```",end+3)){
   let json:unknown;
   try{json=JSON.parse(output.slice(start,end));}catch(error){last=(error as Error).message;continue;}
   const parsed=AgentClassification.safeParse(json);
   if(parsed.success)return {ok:true,value:parsed.data};
   last=parsed.error.issues.slice(0,3).map(i=>i.path.join(".")+": "+i.message).join("; ");
  }
 }
 return {ok:false,reason:"the ```json block is not a valid classification ("+last+")"};
}

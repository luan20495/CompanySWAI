import {REVIEW_REQUEST_PREFIX} from "./output-parser.js";
import type {ExecutionRecordValue} from "./execution-record.js";
import type {TaskPlanValue} from "./project.js";

/**
 * Builds the prompt of every model call from scratch. Nothing is carried over between executions: a maker gets its
 * task plus the declared upstream artifacts; a reviewer gets the requirements, the artifact under review, the upstream
 * context the maker was given and the test evidence — never the maker's reasoning, system prompt or conversation.
 */
export type ContextEntry={ref:string;sections:string[];chars:number};
export type BuiltContext={prompt:string;manifest:ContextEntry[]};

const TRUNCATED="\n…[truncated; the full artifact is persisted]";
const clip=(text:string,limit:number)=>text.length>limit?text.slice(0,limit)+TRUNCATED:text;

/** Every level-2 section of an output, in order. Text before the first heading (preamble, reasoning) is not part of the artifact. */
export function allSections(output:string):Array<{title:string;body:string}>{
 const out:Array<{title:string;body:string}>=[];let current:{title:string;lines:string[]}|undefined;
 for(const line of output.split(/\r?\n/)){
  const heading=line.match(/^##\s+(.+?)\s*$/);
  if(heading){if(current)out.push({title:current.title,body:current.lines.join("\n").trim()});current={title:heading[1],lines:[]};}
  else current?.lines.push(line);
 }
 if(current)out.push({title:current.title,body:current.lines.join("\n").trim()});
 return out;
}
/**
 * The artifact as other agents see it: every section the author wrote (including extra ones such as an open-items
 * register), minus the named ones; preamble text is dropped. Outputs without any section fall back to the whole text.
 */
export function sectionsExcept(output:string,excluded:string[]=[]){
 const skip=new Set(excluded.map(t=>t.toLowerCase())),parts=allSections(output).filter(p=>p.body&&!skip.has(p.title.toLowerCase()));
 return parts.length?parts:[{title:"",body:output.trim()}];
}
const render=(parts:Array<{title:string;body:string}>,limit:number)=>clip(parts.map(p=>p.title?"## "+p.title+"\n"+p.body:p.body).join("\n\n"),limit);
const titlesOf=(parts:Array<{title:string}>)=>parts.map(p=>p.title).filter(Boolean);

/** `evidence` is the runtime's own record of what was executed for that task (gate results and check output). */
export type Upstream={task:TaskPlanValue;output:string;evidence?:string};

/**
 * `verifierLimit` is the cap for an agent whose job is to verify upstream work (it consumes test evidence): like a
 * reviewer it must see the whole artifact, because a clipped README or test file would make it report BLOCKED for the wrong reason.
 */
export function makerContext(task:TaskPlanValue,upstream:Upstream[],limit:number,verifierLimit=limit):BuiltContext{
 if(!upstream.length)return {prompt:task.prompt,manifest:[]};
 const manifest:ContextEntry[]=[],blocks:string[]=[],bodyLimit=task.contract.params.includeUpstreamEvidence===true?Math.max(limit,verifierLimit):limit;
 for(const dep of upstream){
  const parts=sectionsExcept(dep.output,["Evidence"]),body=render(parts,bodyLimit);
  const extra=task.contract.params.includeUpstreamEvidence===true&&dep.evidence?"\n\n--- RUNTIME TEST EVIDENCE FOR "+dep.task.id+" (executed by the runtime, not by its author) ---\n"+clip(dep.evidence,limit):"";
  blocks.push("UPSTREAM "+dep.task.id+"\n"+body+extra);manifest.push({ref:"artifact:"+dep.task.id,sections:[...titlesOf(parts),...(extra?["runtime-evidence"]:[])],chars:body.length+extra.length});
 }
 return {prompt:task.prompt+"\n\n--- UPSTREAM ARTIFACTS ---\n"+blocks.join("\n\n"),manifest};
}

export type ReviewContextInput={
 task:TaskPlanValue;maker:ExecutionRecordValue;upstream:Upstream[];limit:number;
 /** Cap for the artifact under review itself; reviewers must see all of it, so this is much larger than the upstream cap. */
 artifactLimit?:number;
 slot:number;slots:number;previousFindings?:string;
};
export function reviewContext(input:ReviewContextInput):BuiltContext{
 const {task,maker,upstream,limit,slot,slots}=input,manifest:ContextEntry[]=[];
 // The reviewer sees the whole artifact — every section of the contract the maker had to satisfy (Evidence and Handoff
 // included, because reviewing them is part of review). Only text outside those sections (reasoning, scratch) is withheld.
 const artifactParts=sectionsExcept(maker.output),artifact=render(artifactParts,input.artifactLimit??limit);
 manifest.push({ref:"artifact:"+task.id,sections:titlesOf(artifactParts),chars:artifact.length});
 const parts:string[]=[REVIEW_REQUEST_PREFIX+" The first non-empty line MUST be PASS or CHANGES_REQUIRED."];
 if(slots>1)parts.push("You are independent reviewer "+(slot+1)+" of "+slots+". You cannot see the other reviewers or the author's reasoning.");
 parts.push("--- TASK REQUIREMENTS ---\n"+task.prompt);
 if(upstream.length){
  const blocks=upstream.map(dep=>{
   const parts=sectionsExcept(dep.output,["Evidence","Handoff","Blockers"]),body=render(parts,limit);
   manifest.push({ref:"upstream:"+dep.task.id,sections:titlesOf(parts),chars:body.length});return "UPSTREAM "+dep.task.id+"\n"+body;
  });
  parts.push("--- UPSTREAM CONTEXT THE AUTHOR WAS GIVEN ---\n"+blocks.join("\n\n"));
 }
 parts.push("--- ARTIFACT UNDER REVIEW ---\n"+artifact);
 if(maker.changedFiles.length)parts.push("--- CHANGED FILES ---\n"+maker.changedFiles.join("\n")+(maker.commitSha?"\ncommit "+maker.commitSha:""));
 // Deterministic evidence produced by the runtime (gates, checks). The author's own ## Evidence section is part of the artifact above.
 const evidence=[...maker.evidence,...maker.gates.map(g=>"gate "+g.name+": "+g.status+(g.detail?" — "+g.detail:""))].join("\n");
 parts.push("--- DETERMINISTIC TEST EVIDENCE (from the runtime) ---\n"+(evidence?clip(evidence,limit):"(none: no code gates ran for this step; the author's ## Evidence section is in the artifact)"));
 manifest.push({ref:"evidence:"+task.id,sections:["gates"],chars:evidence.length});
 if(input.previousFindings)parts.push("--- YOUR PREVIOUS FINDINGS (this is a re-review) ---\n"+clip(input.previousFindings,limit)+"\n\nVerify each finding above against the revised artifact first. Raise a new blocker only for a real defect the revision introduced or that you missed and that would cause failure; do not widen your demands round after round.");
 return {prompt:parts.join("\n\n"),manifest};
}

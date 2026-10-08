import {REVIEW_REQUEST_PREFIX,section} from "./output-parser.js";
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

/** The named sections of an output, in the order requested. Falls back to the whole text for outputs without any section. */
export function pickSections(output:string,titles:string[]){
 const picked=titles.map(title=>({title,body:section(output,title)})).filter((x):x is {title:string;body:string}=>Boolean(x.body));
 return picked.length?picked:[{title:"",body:output.trim()}];
}
const render=(parts:Array<{title:string;body:string}>,limit:number)=>clip(parts.map(p=>p.title?"## "+p.title+"\n"+p.body:p.body).join("\n\n"),limit);

/** Sections of an upstream artifact that downstream agents may see: its contract sections minus evidence and handoff chatter. */
function downstreamSections(task:TaskPlanValue,exclude:string[]){
 return task.contract.sections.filter(title=>!exclude.includes(title));
}

export type Upstream={task:TaskPlanValue;output:string};

export function makerContext(task:TaskPlanValue,upstream:Upstream[],limit:number):BuiltContext{
 if(!upstream.length)return {prompt:task.prompt,manifest:[]};
 const manifest:ContextEntry[]=[],blocks:string[]=[];
 for(const dep of upstream){
  const titles=downstreamSections(dep.task,["Evidence"]),body=render(pickSections(dep.output,titles),limit);
  blocks.push("UPSTREAM "+dep.task.id+"\n"+body);manifest.push({ref:"artifact:"+dep.task.id,sections:titles,chars:body.length});
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
 const artifactTitles=task.contract.sections;
 const artifact=render(pickSections(maker.output,artifactTitles),input.artifactLimit??limit);
 manifest.push({ref:"artifact:"+task.id,sections:artifactTitles,chars:artifact.length});
 const parts:string[]=[REVIEW_REQUEST_PREFIX+" The first non-empty line MUST be PASS or CHANGES_REQUIRED."];
 if(slots>1)parts.push("You are independent reviewer "+(slot+1)+" of "+slots+". You cannot see the other reviewers or the author's reasoning.");
 parts.push("--- TASK REQUIREMENTS ---\n"+task.prompt);
 if(upstream.length){
  const blocks=upstream.map(dep=>{
   const titles=downstreamSections(dep.task,["Evidence","Handoff","Blockers"]),body=render(pickSections(dep.output,titles),limit);
   manifest.push({ref:"upstream:"+dep.task.id,sections:titles,chars:body.length});return "UPSTREAM "+dep.task.id+"\n"+body;
  });
  parts.push("--- UPSTREAM CONTEXT THE AUTHOR WAS GIVEN ---\n"+blocks.join("\n\n"));
 }
 parts.push("--- ARTIFACT UNDER REVIEW ---\n"+artifact);
 if(maker.changedFiles.length)parts.push("--- CHANGED FILES ---\n"+maker.changedFiles.join("\n")+(maker.commitSha?"\ncommit "+maker.commitSha:""));
 // Deterministic evidence produced by the runtime (gates, checks). The author's own ## Evidence section is part of the artifact above.
 const evidence=[...maker.evidence,...maker.gates.map(g=>"gate "+g.name+": "+g.status+(g.detail?" — "+g.detail:""))].join("\n");
 parts.push("--- DETERMINISTIC TEST EVIDENCE (from the runtime) ---\n"+(evidence?clip(evidence,limit):"(none: no code gates ran for this step; the author's ## Evidence section is in the artifact)"));
 manifest.push({ref:"evidence:"+task.id,sections:["gates"],chars:evidence.length});
 if(input.previousFindings)parts.push("--- YOUR PREVIOUS FINDINGS (verify each is resolved) ---\n"+clip(input.previousFindings,limit));
 return {prompt:parts.join("\n\n"),manifest};
}

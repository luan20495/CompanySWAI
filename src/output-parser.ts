export type ParsedAgentOutput={deliverables?:string;decision?:string;handoff?:string;blockers?:string;evidence?:string};
export type ReviewVerdict="PASS"|"CHANGES_REQUIRED";

/** Body of a `## Title` section (case-insensitive heading), up to the next `##` heading. Empty sections count as missing. */
export function section(text:string,title:string){
 const lines=text.split(/\r?\n/),target="## "+title.toLowerCase();let start=-1;
 for(let i=0;i<lines.length;i++)if(lines[i].trim().toLowerCase()===target){start=i+1;break;}
 if(start<0)return undefined;
 let end=lines.length;
 for(let i=start;i<lines.length;i++)if(/^##\s+/.test(lines[i])){end=i;break;}
 const value=lines.slice(start,end).join("\n").trim();
 return value||undefined;
}
export function parseReviewVerdict(text:string):ReviewVerdict|undefined{
 const first=text.split(/\r?\n/).map(x=>x.trim()).find(Boolean)?.toUpperCase()??"";
 if(first.startsWith("PASS"))return "PASS";
 if(first.startsWith("CHANGES_REQUIRED"))return "CHANGES_REQUIRED";
 return undefined;
}
export function parseAgentOutput(text:string):ParsedAgentOutput{
 return {deliverables:section(text,"Deliverables"),decision:section(text,"Decisions"),handoff:section(text,"Handoff"),blockers:section(text,"Blockers"),evidence:section(text,"Evidence")};
}
export const isNone=(value?:string)=>!value||/^(none|no blockers|n\/a|nothing)\.?$/i.test(value.trim());

export type ContractRequirement={sections:string[];verdict:boolean};
/** Human-readable list of what the output fails to provide under the contract. */
export function contractViolations(text:string,contract:ContractRequirement):string[]{
 const problems:string[]=[];
 if(contract.verdict&&!parseReviewVerdict(text))problems.push("first non-empty line must be PASS or CHANGES_REQUIRED");
 for(const title of contract.sections)if(!section(text,title))problems.push("missing or empty section '## "+title+"'");
 return problems;
}

/** Context handed to downstream agents: the sections that carry the handoff, not the whole transcript. */
export function condense(text:string,maxChars:number){
 const picked=["Deliverables","Decisions","Blockers","Handoff"].map(title=>{const body=section(text,title);return body?"## "+title+"\n"+body:undefined;}).filter(Boolean) as string[];
 const body=picked.length?picked.join("\n\n"):text.trim();
 return body.length>maxChars?body.slice(0,maxChars)+"\n…[truncated; full artifact is persisted]":body;
}

/** Every review request starts with this line; providers that must tell reviews from maker work (dry-run) key on it. */
export const REVIEW_REQUEST_PREFIX="Review the output below against the task.";

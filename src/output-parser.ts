export type ParsedAgentOutput={decision?:string;handoff?:string;blockers?:string;evidence?:string};
function section(text:string,title:string){
 const lines=text.split(/\r?\n/);const target="## "+title.toLowerCase();let start=-1;
 for(let i=0;i<lines.length;i++)if(lines[i].trim().toLowerCase()===target){start=i+1;break;}
 if(start<0)return undefined;let end=lines.length;
 for(let i=start;i<lines.length;i++)if(/^##\s+/.test(lines[i])){end=i;break;}
 const value=lines.slice(start,end).join("\n").trim();return value||undefined;
}
export function parseReviewVerdict(text:string){
 const first=text.split(/\r?\n/).map(x=>x.trim()).find(Boolean)?.toUpperCase()??"";
 if(first.startsWith("PASS"))return "PASS" as const;
 if(first.startsWith("CHANGES_REQUIRED"))return "CHANGES_REQUIRED" as const;
 return undefined;
}
export function parseAgentOutput(text:string):ParsedAgentOutput{return {decision:section(text,"Decisions"),handoff:section(text,"Handoff"),blockers:section(text,"Blockers"),evidence:section(text,"Evidence")};}

export type ParsedAgentOutput={decision?:string;handoff?:string};
function section(text:string,title:string){
 const lines=text.split(/\r?\n/);const target="## "+title.toLowerCase();let start=-1;
 for(let i=0;i<lines.length;i++)if(lines[i].trim().toLowerCase()===target){start=i+1;break;}
 if(start<0)return undefined;let end=lines.length;
 for(let i=start;i<lines.length;i++)if(/^##\s+/.test(lines[i])){end=i;break;}
 const value=lines.slice(start,end).join("\n").trim();return value||undefined;
}
export function parseAgentOutput(text:string):ParsedAgentOutput{return {decision:section(text,"Decisions"),handoff:section(text,"Handoff")};}

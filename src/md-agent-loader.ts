import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {z} from "zod";
import {SafeId} from "./ids.js";

const Mode=z.enum(["maker","reviewer"]);
const AgentMeta=z.object({
 id:SafeId,department:z.string().min(1),mode:Mode,activation:z.string().min(1),
 stage:z.number().int().nonnegative(),skills:z.array(SafeId).default([]),
 modelCapabilities:z.array(z.string().min(1)).default(["reasoning"])
});
const RuleMeta=z.object({
 requires:z.array(z.string()).default([]),optionalRequires:z.array(z.string()).default([]),
 produces:z.array(z.string()).default([]),reviewedBy:z.string().default("none"),
 /** Deterministic output validators the runtime applies to this agent's answers (see src/validators.ts). */
 validators:z.array(z.string()).default([]),
 /** Review lens applied by this agent's independent reviewer (declared in company/GATES.md). */
 reviewLens:z.string().optional(),
 /** True for agents whose deliverable is code in the project workspace (code gates apply). */
 deliversCode:z.boolean().default(false)
});
const ManifestMeta=z.object({agents:z.array(SafeId).length(11)});
export type AgentDefinition=z.infer<typeof AgentMeta>&z.infer<typeof RuleMeta>&{identity:string;rules:string;skillText:string[]};

function scalar(raw:string):unknown{
 const value=raw.trim();
 if(value.startsWith("[")||value.startsWith("{"))return JSON.parse(value);
 if(/^\d+$/.test(value))return Number(value);
 if(value==="true")return true;
 if(value==="false")return false;
 return value;
}
export function parseMarkdownFrontmatter(text:string){
 const match=text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
 if(!match)throw new Error("Markdown file is missing frontmatter");
 const meta:Record<string,unknown>={},lines=match[1].split(/\r?\n/);
 for(let i=0;i<lines.length;i++){
  const line=lines[i];
  if(!line.trim()||line.trim().startsWith("#"))continue;
  const index=line.indexOf(":");
  if(index<1)throw new Error("Invalid frontmatter line: "+line);
  let raw=line.slice(index+1);
  // JSON values may span several lines; keep reading until the value parses.
  while(/^\s*[[{]/.test(raw)&&i+1<lines.length&&!parsesAsJson(raw))raw+="\n"+lines[++i];
  meta[line.slice(0,index).trim()]=scalar(raw);
 }
 return {meta,body:match[2].trim()};
}
const parsesAsJson=(raw:string)=>{try{JSON.parse(raw);return true;}catch{return false;}};

export class MarkdownAgentRegistry{
 constructor(private agentsRoot="agents",private skillsRoot="skills"){}
 async loadAgent(id:string):Promise<AgentDefinition>{
  const dir=join(this.agentsRoot,SafeId.parse(id));
  const [identityText,rulesText]=await Promise.all([
   readFile(join(dir,"IDENTITY.md"),"utf8"),
   readFile(join(dir,"RULES.md"),"utf8")
  ]);
  const identity=parseMarkdownFrontmatter(identityText),rules=parseMarkdownFrontmatter(rulesText);
  const im=AgentMeta.parse(identity.meta),rm=RuleMeta.parse(rules.meta);
  if(im.id!==id)throw new Error("Agent directory/id mismatch: "+id);
  const skillText=await Promise.all(im.skills.map(skill=>readFile(join(this.skillsRoot,skill+".md"),"utf8")));
  return {...im,...rm,identity:identity.body,rules:rules.body,skillText};
 }
 async loadAll(){
  const manifest=parseMarkdownFrontmatter(await readFile(join(this.agentsRoot,"AGENTS.md"),"utf8"));
  const {agents}=ManifestMeta.parse(manifest.meta);
  if(new Set(agents).size!==agents.length)throw new Error("Duplicate agent id in AGENTS.md");
  return Promise.all(agents.map(id=>this.loadAgent(id)));
 }
}

export function activationMatches(expression:string,capabilities:string[],complexity:number){
 if(expression==="always")return true;
 if(expression.startsWith("complexity>="))return complexity>=Number(expression.slice("complexity>=".length));
 if(expression.startsWith("capability:")){
  const options=expression.slice("capability:".length).split("|").map(x=>x.trim()).filter(Boolean);
  return options.some(x=>capabilities.includes(x));
 }
 throw new Error("Unsupported activation expression: "+expression);
}

export function systemPromptFor(agent:AgentDefinition,companyText="",workflowText="",qualityText="",contractText="",extraSections:string[]=[]){
 return [companyText,workflowText,qualityText,contractText,agent.identity,agent.rules,...agent.skillText,...extraSections].filter(Boolean).join("\n\n---\n\n");
}

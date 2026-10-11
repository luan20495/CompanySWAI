import {readdir} from "node:fs/promises";
import {estimateTokens,contextClass} from "./skill-registry.js";
import {SkillCatalog,type DynamicSkill} from "./skill-selector.js";
import {INSTALL_HINTS,probeBinaries,type ToolProbe} from "./tool-probe.js";
import {MarkdownAgentRegistry} from "./md-agent-loader.js";

/** Read-only visibility of the skill registry for the operator: what exists, where it came from, who may use it, what it needs. */
export type SkillRow={
 name:string;kind:"core"|"dynamic";version:string;description:string;source:string;sourceCommit?:string;upstreamPath?:string;license:string;decision:string;
 riskLevel:string;appliesTo:string[];activation:{capabilities:string[];keywords:string[];tags:string[];minComplexity?:number};
 contextChars:number;tokensEstimate:number;contextClass:string;references:Array<{file:string;chars:number}>;
 requires:{network:boolean;browser:boolean;credentials:boolean;binaries:Array<{name:string;available:boolean;hint?:string}>};
 overlapGroup?:string;alsoFrom:Array<{source:string;sourceCommit:string;upstreamPath:string;license:string}>;attribution?:string;outputContract:string[];
};

export async function skillRows(catalog:DynamicSkill[],probes?:ToolProbe[]):Promise<SkillRow[]>{
 const known=probes??await probeBinaries(catalog.flatMap(s=>s.requiresExternalBinary));
 const available=new Map(known.map(p=>[p.name,p.available]));
 return catalog.map(s=>({
  name:s.name,kind:"dynamic" as const,version:s.version,description:s.description,source:s.source,sourceCommit:s.sourceCommit,upstreamPath:s.upstreamPath,license:s.license,decision:s.decision,
  riskLevel:s.riskLevel,appliesTo:s.appliesTo,activation:{capabilities:s.capabilities,keywords:s.keywords,tags:s.tags,minComplexity:s.minComplexity},
  contextChars:s.body.length,tokensEstimate:estimateTokens(s.body.length),contextClass:contextClass(s.body.length),
  references:s.references.map(r=>({file:r.file,chars:s.referenceBodies[r.file]?.length??0})),
  requires:{network:s.requiresNetwork,browser:s.requiresBrowser,credentials:s.requiresCredentials,
   binaries:s.requiresExternalBinary.map(name=>({name,available:available.get(name)??false,hint:available.get(name)?undefined:INSTALL_HINTS[name]}))},
  overlapGroup:s.overlapGroup,alsoFrom:s.alsoFrom,attribution:s.attribution,outputContract:s.outputContract
 }));
}

/** The 11 permanent roles carry fixed core skills (Markdown files named in each agent's `skills`). */
export async function coreSkillAssignments(){
 const agents=await new MarkdownAgentRegistry().loadAll(),files=(await readdir("skills")).filter(f=>f.endsWith(".md")).map(f=>f.replace(/\.md$/,""));
 return {roles:agents.map(a=>({role:a.id,core:a.skills})),files};
}

export type SkillCatalogView={dynamic:SkillRow[];core:Array<{role:string;core:string[]}>;optionalDependencies:Array<{name:string;available:boolean;hint?:string;neededBy:string[]}>};

export async function catalogView(options:{catalog?:SkillCatalog;role?:string;probes?:ToolProbe[]}={}):Promise<SkillCatalogView>{
 const catalog=await (options.catalog??new SkillCatalog()).load(),all=await skillRows(catalog,options.probes);
 const rows=options.role?all.filter(r=>r.appliesTo.includes(options.role!)||r.appliesTo.includes("*")):all;
 const core=(await coreSkillAssignments()).roles.filter(r=>!options.role||r.role===options.role);
 const needed=new Map<string,{available:boolean;hint?:string;neededBy:string[]}>();
 for(const row of rows)for(const b of row.requires.binaries){const e=needed.get(b.name)??{available:b.available,hint:b.hint,neededBy:[]};e.neededBy.push(row.name);needed.set(b.name,e);}
 return {dynamic:rows,core,optionalDependencies:[...needed].map(([name,v])=>({name,...v})).sort((a,b)=>a.name.localeCompare(b.name))};
}

const yes=(b:boolean)=>b?"yes":"no";
export function renderCatalog(view:SkillCatalogView,role?:string){
 const w=Math.max(...view.dynamic.map(r=>r.name.length),6)+2,pad=(s:string,n:number)=>s.length>=n?s:s+" ".repeat(n-s.length);
 const lines=["SKILLS"+(role?" for role "+role:"")+" ("+view.dynamic.length+" specialist skills injected only when a task's signals fire; the permanent roles never change)"];
 for(const r of view.dynamic){
  lines.push("- "+pad(r.name,w)+pad("v"+r.version,8)+pad(r.decision,11)+pad(r.license,24)+pad("risk "+r.riskLevel,12)+pad(r.contextClass+" ~"+r.tokensEstimate+"t",14)+"roles: "+(r.appliesTo.join(",")));
 }
 if(view.optionalDependencies.length){
  lines.push("","OPTIONAL EXTERNAL DEPENDENCIES (skills still apply without them; the tool's results are then reported NOT RUN)");
  for(const d of view.optionalDependencies)lines.push("- "+pad(d.name,16)+(d.available?"installed":"missing"+(d.hint?"  → "+d.hint:""))+"   used by: "+d.neededBy.join(", "));
 }
 if(!role&&view.core.length){lines.push("","CORE SKILLS PER ROLE (always part of the role)");for(const c of view.core)lines.push("- "+pad(c.role,20)+(c.core.join(", ")||"-"));}
 lines.push("","(skill <name> for source, version, commit, licence, activation signals and dependencies)");
 return lines.join("\n");
}

export function renderSkill(r:SkillRow){
 const bins=r.requires.binaries.map(b=>b.name+(b.available?" (installed)":" (missing"+(b.hint?": "+b.hint:"")+")")).join(", ")||"none";
 return [
  "SKILL: "+r.name+"  v"+r.version+"  ["+r.decision+"]  risk "+r.riskLevel,
  r.description,
  "SOURCE: "+r.source+(r.sourceCommit?"  @ "+r.sourceCommit:"")+(r.upstreamPath?"  ("+r.upstreamPath+")":""),
  ...r.alsoFrom.map(a=>"ALSO FROM: "+a.source+" @ "+a.sourceCommit+" ("+a.upstreamPath+", "+a.license+")"),
  "LICENSE: "+r.license+(r.attribution?"\nATTRIBUTION: "+r.attribution:""),
  "ROLES: "+r.appliesTo.join(", "),
  "ACTIVATES ON: "+[...r.activation.capabilities.map(c=>"capability:"+c),...r.activation.tags.map(t=>"tag:"+t),...r.activation.keywords.map(k=>"keyword:"+k)].join(", ")+(r.activation.minComplexity?"  (complexity >= "+r.activation.minComplexity+")":""),
  "CONTEXT: "+r.contextChars+" chars (~"+r.tokensEstimate+" tokens, "+r.contextClass+")"+(r.references.length?"; references on demand: "+r.references.map(x=>x.file+" "+x.chars+" chars").join(", "):""),
  "NEEDS: network "+yes(r.requires.network)+", browser "+yes(r.requires.browser)+", credentials "+yes(r.requires.credentials)+", binaries: "+bins,
  ...(r.overlapGroup?["OVERLAP GROUP: "+r.overlapGroup+" (only the best match in a group is injected)"]:[]),
  "OUTPUT: "+(r.outputContract.join(", ")||"-")
 ].join("\n");
}

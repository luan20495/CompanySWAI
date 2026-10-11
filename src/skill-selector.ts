import {readFile,readdir} from "node:fs/promises";
import {join} from "node:path";
import {parseMarkdownFrontmatter} from "./md-agent-loader.js";
import {
 SKILL_CONTEXT_BUDGET_CHARS,SkillMeta,SkillRejectedError,type SkillTraceValue,type SkillUseValue,type RegistrySkill,
 isConfinedReference,validateCatalog,validateSkill
} from "./skill-registry.js";

/**
 * Dynamic specialist skills: Markdown files whose frontmatter declares which agents they apply to and which task
 * signals activate them. The 11 permanent agents never change; a skill is injected only when a signal fires, the role
 * policy allows it, the permission policy allows what it needs, and the per-task context budget has room.
 */
export type DynamicSkill=RegistrySkill;
export type SkillSignals={capabilities:string[];complexity:number;tags:string[];text:string};
/** What a project allows skills to rely on. Everything defaults to off: a skill that needs it is skipped, never forced. */
export type SkillPolicy={allowNetwork?:boolean;allowBrowser?:boolean};
export type SelectedSkill={name:string;matched:string[];body:string;use:SkillUseValue;references:Array<{file:string;body:string}>};

export const DEFAULT_MAX_DYNAMIC_SKILLS=4;

export class SkillCatalog{
 private cache?:Promise<DynamicSkill[]>;
 constructor(private root="skills/dynamic",private referencesRoot="skills/references"){}
 load(){return this.cache??=this.read();}
 private async read(){
  const files=(await readdir(this.root)).filter(f=>f.endsWith(".md")).sort(),skills:DynamicSkill[]=[];
  for(const file of files){
   const parsed=parseMarkdownFrontmatter(await readFile(join(this.root,file),"utf8")),meta=SkillMeta.parse(parsed.meta);
   if(meta.name!==file.replace(/\.md$/,""))throw new Error("Dynamic skill name must match its file name: "+file);
   const referenceBodies:Record<string,string>={};
   for(const ref of meta.references){
    if(!isConfinedReference(ref.file))throw new SkillRejectedError(meta.name,["reference '"+ref.file+"' escapes the skill reference directory"]);
    const text=await readFile(join(this.referencesRoot,meta.name,ref.file),"utf8").catch(()=>undefined);
    if(text!=null)referenceBodies[ref.file]=text;
   }
   const skill:DynamicSkill={...meta,body:parsed.body,referenceBodies},problems=validateSkill(skill);
   if(problems.length)throw new SkillRejectedError(meta.name,problems);
   skills.push(skill);
  }
  const catalogProblems=validateCatalog(skills);
  if(catalogProblems.length)throw new SkillRejectedError("catalog",catalogProblems);
  return skills;
 }
}

const escape=(text:string)=>text.replace(/[.*+?^${}()|[\]\\/]/g,"\\$&");
const mentions=(text:string,word:string)=>new RegExp("(^|[^a-z0-9])"+escape(word.toLowerCase())+"([^a-z0-9]|$)").test(text);

type Activation={capabilities:string[];keywords:string[];tags:string[];name?:string};
const matchSignals=(rule:Activation,signals:SkillSignals)=>{
 const text=signals.text.toLowerCase(),tags=new Set(signals.tags.map(t=>t.toLowerCase())),capabilities=new Set(signals.capabilities),matched:string[]=[];
 for(const capability of rule.capabilities)if(capabilities.has(capability))matched.push("capability:"+capability);
 for(const tag of new Set([...(rule.name?[rule.name]:[]),...rule.tags]))if(tags.has(tag.toLowerCase()))matched.push("tag:"+tag);
 for(const keyword of rule.keywords)if(mentions(text,keyword))matched.push("keyword:"+keyword);
 return matched;
};

export type SkillResolution={selected:SelectedSkill[];trace:SkillTraceValue};

/**
 * task → capabilities/signals → role policy → permission policy → overlap → cap/context budget → minimum sufficient skills.
 * Deterministic: same inputs always give the same skills in the same order (most signals first, then preference, then name).
 * A skipped skill is reported with its reason, so a reviewer can see why something did not apply.
 */
export function resolveSkills(catalog:DynamicSkill[],agentId:string,signals:SkillSignals,options:{max?:number;budgetChars?:number;policy?:SkillPolicy}={}):SkillResolution{
 const max=options.max??DEFAULT_MAX_DYNAMIC_SKILLS,budget=options.budgetChars??SKILL_CONTEXT_BUDGET_CHARS,policy=options.policy??{};
 const skipped:SkillTraceValue["skipped"]=[],warnings:string[]=[],hits:Array<{skill:DynamicSkill;matched:string[]}>=[];
 for(const skill of catalog){
  // Role policy: a skill that does not name this agent is invisible to it (not even reported).
  if(!skill.appliesTo.includes(agentId)&&!skill.appliesTo.includes("*"))continue;
  const matched=matchSignals(skill,signals);
  if(skill.minComplexity!=null&&signals.complexity>=skill.minComplexity&&matched.length)matched.push("complexity>="+skill.minComplexity);
  // minComplexity gates a skill: below it, even keyword matches do not activate it.
  if(skill.minComplexity!=null&&signals.complexity<skill.minComplexity)continue;
  if(!matched.length)continue;
  if(skill.requiresNetwork&&!policy.allowNetwork){skipped.push({name:skill.name,reason:"policy: needs network access, which this project does not allow"});continue;}
  if(skill.requiresBrowser&&!policy.allowBrowser){skipped.push({name:skill.name,reason:"policy: needs a browser, which this project does not allow"});continue;}
  hits.push({skill,matched});
 }
 hits.sort((a,b)=>b.matched.length-a.matched.length||b.skill.preference-a.skill.preference||a.skill.name.localeCompare(b.skill.name));
 const selected:SelectedSkill[]=[],groups=new Map<string,string>();let used=0;
 for(const {skill,matched} of hits){
  if(skill.overlapGroup&&groups.has(skill.overlapGroup)){skipped.push({name:skill.name,reason:"overlap: '"+groups.get(skill.overlapGroup)+"' already covers group "+skill.overlapGroup});continue;}
  if(selected.length>=max){skipped.push({name:skill.name,reason:"cap: at most "+max+" specialist skills per task"});continue;}
  if(used+skill.body.length>budget){skipped.push({name:skill.name,reason:"budget: "+skill.body.length+" chars do not fit the remaining "+(budget-used)+" of the "+budget+"-char skill budget"});continue;}
  used+=skill.body.length;
  const references:SelectedSkill["references"]=[];
  for(const ref of skill.references){
   if(!matchSignals(ref,signals).length)continue;
   const body=skill.referenceBodies[ref.file];
   if(used+body.length>budget){warnings.push("reference "+skill.name+"/"+ref.file+" skipped: over the skill context budget");continue;}
   used+=body.length;references.push({file:ref.file,body});
  }
  if(skill.overlapGroup)groups.set(skill.overlapGroup,skill.name);
  const contextChars=skill.body.length+references.reduce((n,r)=>n+r.body.length,0);
  selected.push({name:skill.name,matched,body:skill.body,references,use:{
   name:skill.name,version:skill.version,source:skill.source,sourceCommit:skill.sourceCommit,license:skill.license,decision:skill.decision,riskLevel:skill.riskLevel,
   matched,contextChars,references:references.map(r=>r.file),requiresExternalBinary:skill.requiresExternalBinary
  }});
 }
 return {selected,trace:{used:selected.map(s=>s.use),skipped,warnings,budgetChars:budget,usedChars:used}};
}

/** Back-compatible view: the selected skills only (see `resolveSkills` for the reasons skills were skipped). */
export function selectSkills(catalog:DynamicSkill[],agentId:string,signals:SkillSignals,max=DEFAULT_MAX_DYNAMIC_SKILLS,policy:SkillPolicy={}):SelectedSkill[]{
 return resolveSkills(catalog,agentId,signals,{max,policy}).selected;
}

/** The text injected into a task's system prompt for one selected skill: core body, then any references that fired. */
export const skillPromptText=(skill:SelectedSkill)=>[skill.body,...skill.references.map(r=>"## Reference: "+r.file+"\n"+r.body)].join("\n\n");

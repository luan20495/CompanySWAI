import {readFile,readdir} from "node:fs/promises";
import {join} from "node:path";
import {z} from "zod";
import {SafeId} from "./ids.js";
import {parseMarkdownFrontmatter} from "./md-agent-loader.js";

/**
 * Dynamic specialist skills: Markdown files whose frontmatter declares which agents they apply to and which task
 * signals activate them. The 11 permanent agents never change; a skill is injected only when a signal fires.
 */
const SkillMeta=z.object({
 name:SafeId,appliesTo:z.array(z.string()).min(1),capabilities:z.array(z.string()).default([]),
 keywords:z.array(z.string().min(1)).default([]),tags:z.array(z.string()).default([]),minComplexity:z.number().int().min(1).optional()
});
export type DynamicSkill=z.infer<typeof SkillMeta>&{body:string};
export type SkillSignals={capabilities:string[];complexity:number;tags:string[];text:string};
export type SelectedSkill={name:string;matched:string[];body:string};

export const DEFAULT_MAX_DYNAMIC_SKILLS=4;

export class SkillCatalog{
 private cache?:Promise<DynamicSkill[]>;
 constructor(private root="skills/dynamic"){}
 load(){return this.cache??=this.read();}
 private async read(){
  const files=(await readdir(this.root)).filter(f=>f.endsWith(".md")).sort(),skills:DynamicSkill[]=[];
  for(const file of files){
   const parsed=parseMarkdownFrontmatter(await readFile(join(this.root,file),"utf8")),meta=SkillMeta.parse(parsed.meta);
   if(meta.name!==file.replace(/\.md$/,""))throw new Error("Dynamic skill name must match its file name: "+file);
   if(!meta.capabilities.length&&!meta.keywords.length&&!meta.tags.length&&meta.minComplexity==null)throw new Error("Dynamic skill "+meta.name+" declares no activation signal");
   skills.push({...meta,body:parsed.body});
  }
  return skills;
 }
}

const escape=(text:string)=>text.replace(/[.*+?^${}()|[\]\\/]/g,"\\$&");
const mentions=(text:string,word:string)=>new RegExp("(^|[^a-z0-9])"+escape(word.toLowerCase())+"([^a-z0-9]|$)").test(text);

/** Deterministic: same inputs always give the same skills in the same order (most signals first, then name). */
export function selectSkills(catalog:DynamicSkill[],agentId:string,signals:SkillSignals,max=DEFAULT_MAX_DYNAMIC_SKILLS):SelectedSkill[]{
 const text=signals.text.toLowerCase(),tags=new Set(signals.tags.map(t=>t.toLowerCase())),capabilities=new Set(signals.capabilities);
 const hits:SelectedSkill[]=[];
 for(const skill of catalog){
  if(!skill.appliesTo.includes(agentId)&&!skill.appliesTo.includes("*"))continue;
  const matched:string[]=[];
  for(const capability of skill.capabilities)if(capabilities.has(capability))matched.push("capability:"+capability);
  for(const tag of new Set([skill.name,...skill.tags]))if(tags.has(tag.toLowerCase()))matched.push("tag:"+tag);
  for(const keyword of skill.keywords)if(mentions(text,keyword))matched.push("keyword:"+keyword);
  if(skill.minComplexity!=null&&signals.complexity>=skill.minComplexity&&matched.length)matched.push("complexity>="+skill.minComplexity);
  // minComplexity gates a skill: below it, even keyword matches do not activate it.
  if(skill.minComplexity!=null&&signals.complexity<skill.minComplexity)continue;
  if(matched.length)hits.push({name:skill.name,matched,body:skill.body});
 }
 return hits.sort((a,b)=>b.matched.length-a.matched.length||a.name.localeCompare(b.name)).slice(0,max);
}

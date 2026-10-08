import {mkdir,readFile,writeFile} from "node:fs/promises";
import {dirname} from "node:path";
import {z} from "zod";
import {containsSecret} from "./secrets.js";
import type {CandidateValue,RetrospectiveValue} from "./retrospective.js";

const Experience=z.object({
 pattern:z.string().min(1),scope:z.string(),projects:z.array(z.string()).default([]),observations:z.number().int().nonnegative(),
 evidence:z.array(z.string()).default([]),status:z.enum(["CANDIDATE","VALIDATED","REJECTED"]),reason:z.string().optional(),
 reviewedBy:z.string().optional(),updatedAt:z.string().datetime()
});
const ExperienceFile=z.object({version:z.literal(2),items:z.array(Experience)});
const LegacyFile=z.object({version:z.literal(1),items:z.array(z.object({lesson:z.string(),projects:z.array(z.string()).default([]),observations:z.number().int().nonnegative(),status:z.enum(["CANDIDATE","VALIDATED"]),updatedAt:z.string().datetime()}))});
export type ExperienceValue=z.infer<typeof Experience>;

/** Distinct projects that must independently produce the same lesson before it is reused. */
export const PROMOTION_PROJECTS=2;
const MAX_EVIDENCE=5,MAX_PATTERN_CHARS=300;

/**
 * Validation gate between "a project proposed this" and "every future project is told this".
 * Returns a rejection reason for anything that looks specific to one project, otherwise undefined.
 */
export function specificityProblem(candidate:CandidateValue,projectIds:string[],knownRoles?:string[]):string|undefined{
 const text=candidate.pattern;
 if(text.length>MAX_PATTERN_CHARS)return "pattern is too long to be a general rule";
 for(const id of projectIds)if(id&&new RegExp("(^|[^A-Za-z0-9])"+id.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"([^A-Za-z0-9]|$)","i").test(text))return "mentions project id '"+id+"'";
 if(/https?:\/\/|www\./i.test(text))return "contains a URL";
 if(/\S+@\S+\.\S+/.test(text))return "contains an email address";
 if(/(^|\s)\.{0,2}\/[\w.-]+(\/[\w.-]+)*/.test(text)||/\b[\w-]+\/[\w.-]+\.\w{1,5}\b/.test(text))return "contains a file path";
 if(/\b[\w-]+\.(ts|tsx|js|jsx|json|md|py|kt|swift|java|go|rs|ya?ml|sql|sh)\b/i.test(text))return "mentions a specific file";
 if(/\$\s?\d|\b\d{4,}\b/.test(text))return "contains project-specific figures";
 if(containsSecret(text))return "contains a credential-shaped string";
 if(candidate.scope!=="company"){
  const role=candidate.scope.slice("role:".length);
  if(knownRoles&&!knownRoles.includes(role))return "scope names unknown role '"+role+"'";
 }
 return undefined;
}

export class CompanyExperienceStore{
 constructor(private path=".companyswai/company-experience.json"){}
 private async read():Promise<{version:2;items:ExperienceValue[]}>{
  let raw:unknown;
  try{raw=JSON.parse(await readFile(this.path,"utf8"));}
  catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return {version:2,items:[]};throw error;}
  const current=ExperienceFile.safeParse(raw);if(current.success)return current.data;
  const legacy=LegacyFile.parse(raw);
  return {version:2,items:legacy.items.map(item=>({pattern:item.lesson,scope:"company",projects:item.projects,observations:item.observations,evidence:["migrated from version 1"],status:item.status,updatedAt:item.updatedAt}))};
 }
 private async write(items:ExperienceValue[]){await mkdir(dirname(this.path),{recursive:true});await writeFile(this.path,JSON.stringify({version:2,items},null,2),"utf8");}

 /**
  * retrospective -> candidate -> validation -> reusable experience.
  * A candidate is VALIDATED only when it is general (specificityProblem) AND seen in PROMOTION_PROJECTS distinct projects.
  * Dry runs never teach the company anything.
  */
 async observe(retro:RetrospectiveValue,options:{knownRoles?:string[]}={}){
  const file=await this.read();
  if(retro.dryRun)return file.items;
  const now=new Date().toISOString();
  for(const candidate of retro.candidates){
   let item=file.items.find(x=>x.pattern===candidate.pattern&&x.scope===candidate.scope);
   if(!item){item={pattern:candidate.pattern,scope:candidate.scope,projects:[],observations:0,evidence:[],status:"CANDIDATE",updatedAt:now};file.items.push(item);}
   item.observations++;
   if(!item.projects.includes(retro.projectId))item.projects.push(retro.projectId);
   for(const evidence of candidate.evidence)if(!item.evidence.includes(evidence)&&item.evidence.length<MAX_EVIDENCE)item.evidence.push(evidence);
   const problem=specificityProblem(candidate,item.projects,options.knownRoles);
   if(problem){item.status="REJECTED";item.reason=problem;}
   else if(item.status!=="REJECTED"){item.status=item.projects.length>=PROMOTION_PROJECTS?"VALIDATED":"CANDIDATE";if(item.status==="VALIDATED")item.reviewedBy="validator";}
   item.updatedAt=now;
  }
  await this.write(file.items);return file.items;
 }
 /** Experience applicable to one agent role: company-wide lessons plus lessons scoped to that role. */
 async lessonsFor(role?:string){
  return (await this.read()).items.filter(x=>x.status==="VALIDATED"&&(x.scope==="company"||(role!=null&&x.scope==="role:"+role))).map(x=>({pattern:x.pattern,scope:x.scope}));
 }
 async validatedLessons(){return (await this.read()).items.filter(x=>x.status==="VALIDATED").map(x=>({pattern:x.pattern,scope:x.scope}));}
 async list(){return (await this.read()).items;}
}

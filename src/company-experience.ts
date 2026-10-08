import {readFile} from "node:fs/promises";
import {writeFileAtomic} from "./fs-atomic.js";
import {z} from "zod";
import {containsSecret} from "./secrets.js";
import {loadLearningPolicy,type LearningPolicy} from "./company.js";
import type {CandidateValue,RetrospectiveValue} from "./retrospective.js";

/** GLOBAL, ROLE:<agent>, SKILL:<skill> or DOMAIN:<tag>. */
export const ScopeSchema=z.string().regex(/^(GLOBAL|ROLE:[A-Za-z0-9._-]+|SKILL:[A-Za-z0-9._-]+|DOMAIN:[A-Za-z0-9._-]+)$/);
const Status=z.enum(["CANDIDATE","VALIDATED","REJECTED","PENDING_APPROVAL"]);
const Experience=z.object({
 pattern:z.string().min(1),scope:ScopeSchema,projects:z.array(z.string()).default([]),observations:z.number().int().nonnegative(),
 evidence:z.array(z.string()).default([]),confidence:z.number().min(0).max(1).default(0),status:Status,reason:z.string().optional(),
 reviewedBy:z.string().optional(),updatedAt:z.string().datetime()
});
const ExperienceFile=z.object({version:z.literal(3),items:z.array(Experience)});
const V2=z.object({version:z.literal(2),items:z.array(z.object({pattern:z.string(),scope:z.string(),projects:z.array(z.string()).default([]),observations:z.number(),evidence:z.array(z.string()).default([]),status:z.enum(["CANDIDATE","VALIDATED","REJECTED"]),reason:z.string().optional(),reviewedBy:z.string().optional(),updatedAt:z.string().datetime()}))});
const V1=z.object({version:z.literal(1),items:z.array(z.object({lesson:z.string(),projects:z.array(z.string()).default([]),observations:z.number(),status:z.enum(["CANDIDATE","VALIDATED"]),updatedAt:z.string().datetime()}))});
export type ExperienceValue=z.infer<typeof Experience>;

const upgradeScope=(scope:string)=>scope==="company"?"GLOBAL":scope.startsWith("role:")?"ROLE:"+scope.slice(5):scope;

/** Confidence grows with independent projects (full at 3), independent evidence (full at 3) and repeat observations. */
export function confidenceOf(item:{projects:string[];evidence:string[];observations:number}){
 const projects=Math.max(1,item.projects.length);
 return Number((0.45*Math.min(projects/3,1)+0.35*Math.min(item.evidence.length/3,1)+0.2*Math.min(item.observations/projects,1)).toFixed(3));
}

const anyMatch=(patterns:string[],text:string)=>patterns.some(p=>new RegExp(p,"i").test(text));
export type ValidationContext={knownRoles?:string[];knownSkills?:string[];policy:LearningPolicy};

/**
 * The gate between "a project proposed this" and "every future project is told this".
 * Returns why a candidate must be rejected, or undefined when it is general, safe and well scoped.
 */
export function rejectionReason(candidate:CandidateValue,projectIds:string[],context:ValidationContext):string|undefined{
 const text=candidate.pattern,{policy}=context;
 if(text.length>300)return "pattern is too long to be a general rule";
 if(candidate.kind==="operational")return "describes operational/provider behaviour, which is temporary and stays with the project that observed it";
 if(anyMatch(policy.temporaryPatterns,text))return "describes temporary provider behaviour";
 if(anyMatch(policy.forbiddenIntents,text))return "argues for weakening review, gates or approval";
 for(const id of projectIds)if(id&&new RegExp("(^|[^A-Za-z0-9])"+id.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"([^A-Za-z0-9]|$)","i").test(text))return "mentions project id '"+id+"'";
 if(/https?:\/\/|www\./i.test(text))return "contains a URL";
 if(/\S+@\S+\.\S+/.test(text))return "contains an email address";
 if(/(^|\s)\.{0,2}\/[\w.-]+(\/[\w.-]+)*/.test(text)||/\b[\w-]+\/[\w.-]+\.\w{1,5}\b/.test(text))return "contains a file path";
 if(/\b[\w-]+\.(ts|tsx|js|jsx|json|md|py|kt|swift|java|go|rs|ya?ml|sql|sh)\b/i.test(text))return "mentions a specific file";
 if(/\$\s?\d|\b\d{4,}\b/.test(text))return "contains project-specific figures";
 if(containsSecret(text))return "contains a credential-shaped string";
 const [kind,name]=candidate.scope.split(":");
 if(kind==="ROLE"&&context.knownRoles&&!context.knownRoles.includes(name))return "scope names unknown role '"+name+"'";
 if(kind==="SKILL"&&context.knownSkills&&!context.knownSkills.includes(name))return "scope names unknown skill '"+name+"'";
 if(kind==="DOMAIN"&&projectIds.some(id=>id.toLowerCase()===name.toLowerCase()))return "domain scope is a project id";
 return undefined;
}
/** Kept for callers that only need the specificity verdict. */
export const specificityProblem=rejectionReason;

export class CompanyExperienceStore{
 constructor(private path=".companyswai/company-experience.json",private companyRoot="company"){}
 private async read():Promise<{version:3;items:ExperienceValue[]}>{
  let raw:unknown;
  try{raw=JSON.parse(await readFile(this.path,"utf8"));}
  catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return {version:3,items:[]};throw error;}
  const current=ExperienceFile.safeParse(raw);if(current.success)return current.data;
  const v2=V2.safeParse(raw);
  if(v2.success)return {version:3,items:v2.data.items.map(i=>({...i,scope:upgradeScope(i.scope),confidence:confidenceOf(i)}))};
  const v1=V1.parse(raw);
  return {version:3,items:v1.items.map(item=>({pattern:item.lesson,scope:"GLOBAL",projects:item.projects,observations:item.observations,evidence:["migrated from version 1"],confidence:confidenceOf({projects:item.projects,evidence:["migrated"],observations:item.observations}),status:item.status,updatedAt:item.updatedAt}))};
 }
 private async write(items:ExperienceValue[]){await writeFileAtomic(this.path,JSON.stringify({version:3,items},null,2));}

 /**
  * retrospective -> candidate -> validation -> reusable experience.
  * VALIDATED needs: general + safe (rejectionReason), >= minProjects distinct projects, confidence >= minConfidence.
  * Protected topics wait for a person (PENDING_APPROVAL). Dry runs never teach the company anything.
  */
 async observe(retro:RetrospectiveValue,options:{knownRoles?:string[];knownSkills?:string[];policy?:LearningPolicy}={}){
  const file=await this.read();
  if(retro.dryRun)return file.items;
  const policy=options.policy??await loadLearningPolicy(this.companyRoot),context={knownRoles:options.knownRoles,knownSkills:options.knownSkills,policy},now=new Date().toISOString();
  for(const candidate of retro.candidates){
   const scope=upgradeScope(candidate.scope);
   let item=file.items.find(x=>x.pattern===candidate.pattern&&x.scope===scope);
   if(!item){item={pattern:candidate.pattern,scope,projects:[],observations:0,evidence:[],confidence:0,status:"CANDIDATE",updatedAt:now};file.items.push(item);}
   item.observations++;
   if(!item.projects.includes(retro.projectId))item.projects.push(retro.projectId);
   for(const evidence of candidate.evidence)if(!item.evidence.includes(evidence)&&item.evidence.length<policy.maxEvidence)item.evidence.push(evidence);
   item.confidence=confidenceOf(item);
   // A person's decision stands: later observations only add evidence, they never overturn it.
   if(item.reviewedBy?.startsWith("human:")){item.updatedAt=now;continue;}
   const problem=rejectionReason({...candidate,scope},item.projects,context);
   if(problem){item.status="REJECTED";item.reason=problem;item.reviewedBy=undefined;}
   else{
    const ready=item.projects.length>=policy.minProjects&&item.confidence>=policy.minConfidence&&item.evidence.length>0;
    item.reason=undefined;item.reviewedBy=undefined;
    if(!ready)item.status="CANDIDATE";
    else if(anyMatch(policy.protectedTopics,candidate.pattern)){item.status="PENDING_APPROVAL";item.reason="touches a protected topic (security/governance); needs explicit approval";}
    else{item.status="VALIDATED";item.reviewedBy="validator";}
   }
   item.updatedAt=now;
  }
  await this.write(file.items);return file.items;
 }
 /** A person's decision on a PENDING_APPROVAL item (index into list()). Never applies to rejected items. */
 async decide(index:number,decision:"approve"|"reject",by="owner"){
  const file=await this.read(),item=file.items[index];
  if(!item)throw new Error("No experience item at index "+index);
  if(item.status!=="PENDING_APPROVAL")throw new Error("Item "+index+" is "+item.status+", not PENDING_APPROVAL");
  item.status=decision==="approve"?"VALIDATED":"REJECTED";item.reviewedBy="human:"+by;item.reason=decision==="approve"?"approved by "+by:"rejected by "+by;item.updatedAt=new Date().toISOString();
  await this.write(file.items);return item;
 }
 /**
  * Validated experience that applies to one agent's work: GLOBAL, ROLE:<role>, SKILL:<any of its skills>,
  * DOMAIN:<any project signal tag>. Candidates, rejected and unapproved items are never returned.
  */
 async lessonsFor(context:{role?:string;skills?:string[];domains?:string[]}={}){
  const skills=new Set(context.skills??[]),domains=new Set((context.domains??[]).map(d=>d.toLowerCase()));
  return (await this.read()).items.filter(x=>{
   if(x.status!=="VALIDATED")return false;
   const [kind,name]=x.scope.split(":");
   return kind==="GLOBAL"||(kind==="ROLE"&&name===context.role)||(kind==="SKILL"&&skills.has(name))||(kind==="DOMAIN"&&domains.has(name.toLowerCase()));
  }).map(x=>({pattern:x.pattern,scope:x.scope}));
 }
 async validatedLessons(){return (await this.read()).items.filter(x=>x.status==="VALIDATED").map(x=>({pattern:x.pattern,scope:x.scope}));}
 async list(){return (await this.read()).items;}
}

import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {z} from "zod";
import {SafeId} from "./ids.js";
import {writeFileAtomic} from "./fs-atomic.js";
import type {ArchCategoryResult,ParsedResearch,QaTest,Requirement} from "./structured.js";

/**
 * Structured traceability: requirement IDs, artifact IDs, decision IDs, test IDs and the links between them.
 * Markdown memory stays a readable summary; this machine state is what QA, status and audits query.
 * All mutations are serialised per project so parallel tasks cannot lose each other's updates.
 */
const Ac=z.object({id:z.string(),text:z.string()});
const RequirementRecord=z.object({id:z.string(),basis:z.string(),text:z.string(),evidence:z.array(z.string()),acceptance:z.array(Ac),taskId:z.string()});
const TestRecord=z.object({id:z.string().optional(),requirementId:z.string(),status:z.enum(["PASS","FAIL","BLOCKED","NOT_APPLICABLE"]),text:z.string(),evidence:z.string().optional(),owner:z.string().optional(),taskId:z.string()});
const DecisionRecord=z.object({id:z.string(),taskId:z.string(),executionId:z.string(),text:z.string()});
const ArtifactRecord=z.object({id:z.string(),taskId:z.string(),executionId:z.string(),kind:z.string(),ref:z.string()});
const ArchitectureRecord=z.object({taskId:z.string(),verdict:z.string(),categories:z.array(z.object({category:z.string(),status:z.string(),note:z.string()})),unresolvedRisks:z.array(z.string())});
const QaRecord=z.object({taskId:z.string(),overall:z.enum(["PASS","FAIL","BLOCKED","NOT_APPLICABLE"]),at:z.string()});
const Trace=z.object({
 version:z.literal(1),requirements:z.array(RequirementRecord).default([]),tests:z.array(TestRecord).default([]),
 decisions:z.array(DecisionRecord).default([]),artifacts:z.array(ArtifactRecord).default([]),
 architecture:z.array(ArchitectureRecord).default([]),qa:QaRecord.optional()
});
export type TraceValue=z.infer<typeof Trace>;
const empty=():TraceValue=>({version:1,requirements:[],tests:[],decisions:[],artifacts:[],architecture:[]});
const pad=(n:number,prefix:string)=>prefix+String(n).padStart(3,"0");

export class TraceabilityStore{
 private queues=new Map<string,Promise<unknown>>();
 constructor(private root=".companyswai/traceability"){}
 private path(projectId:string){return join(this.root,SafeId.parse(projectId)+".json");}
 async load(projectId:string):Promise<TraceValue>{
  try{return Trace.parse(JSON.parse(await readFile(this.path(projectId),"utf8")));}
  catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return empty();throw error;}
 }
 private mutate<T>(projectId:string,fn:(trace:TraceValue)=>T){
  const previous=this.queues.get(projectId)??Promise.resolve();
  const next=previous.catch(()=>undefined).then(async()=>{const trace=await this.load(projectId),out=fn(trace);await writeFileAtomic(this.path(projectId),JSON.stringify(trace,null,2));return out;});
  this.queues.set(projectId,next);return next;
 }
 /** A revised requirements artifact replaces that task's earlier requirements. */
 setRequirements(projectId:string,taskId:string,requirements:Requirement[]){
  return this.mutate(projectId,trace=>{trace.requirements=[...trace.requirements.filter(r=>r.taskId!==taskId),...requirements.map(r=>({...r,taskId}))];});
 }
 setTests(projectId:string,taskId:string,overall:QaTest["status"],tests:QaTest[]){
  return this.mutate(projectId,trace=>{
   trace.tests=[...trace.tests.filter(t=>t.taskId!==taskId),...tests.map(t=>({id:t.testId,requirementId:t.requirementId,status:t.status,text:t.text,evidence:t.evidence,owner:t.owner,taskId}))];
   trace.qa={taskId,overall,at:new Date().toISOString()};
  });
 }
 /** Idempotent per execution: recovery never mints a second ID for the same output. */
 addDecision(projectId:string,taskId:string,executionId:string,text:string){
  return this.mutate(projectId,trace=>{
   const known=trace.decisions.find(d=>d.executionId===executionId);if(known)return known.id;
   const id=pad(trace.decisions.length+1,"DEC-");trace.decisions.push({id,taskId,executionId,text});return id;
  });
 }
 addArtifact(projectId:string,taskId:string,executionId:string,kind:string,ref:string){
  return this.mutate(projectId,trace=>{
   const known=trace.artifacts.find(a=>a.executionId===executionId);if(known)return known.id;
   const id=pad(trace.artifacts.length+1,"ART-");trace.artifacts.push({id,taskId,executionId,kind,ref});return id;
  });
 }
 addArchitectureReview(projectId:string,taskId:string,verdict:string,categories:ArchCategoryResult[],unresolvedRisks:string[]){
  return this.mutate(projectId,trace=>{trace.architecture=[...trace.architecture.filter(a=>a.taskId!==taskId),{taskId,verdict,categories,unresolvedRisks}];});
 }
 async requirementIds(projectId:string){return (await this.load(projectId)).requirements.map(r=>r.id);}

 /** Requirement -> acceptance criteria -> tests, for the compact table in QA.md. */
 async matrix(projectId:string){
  const trace=await this.load(projectId);
  return trace.requirements.map(req=>({
   requirement:req.id,text:req.text,acceptance:req.acceptance.map(a=>a.id),
   tests:trace.tests.filter(t=>t.requirementId===req.id).map(t=>({id:t.id,status:t.status}))
  }));
 }
 async renderMatrix(projectId:string){
  const rows=await this.matrix(projectId);if(!rows.length)return "";
  const trace=await this.load(projectId);
  return ["| Requirement | Acceptance | Tests | Result |","|---|---|---|---|",...rows.map(r=>"| "+r.requirement+" | "+(r.acceptance.join(", ")||"—")+" | "+(r.tests.map(t=>t.id??"n/a").join(", ")||"—")+" | "+(r.tests.length?r.tests.map(t=>t.status).join(", "):"UNTESTED")+" |"),"","Overall QA: "+(trace.qa?.overall??"not run")].join("\n");
 }
}

// ------------------------------------------------------------------ research citations
const StoredResearch=z.object({taskId:z.string(),at:z.string(),externalResearch:z.boolean(),sources:z.array(z.any()),claims:z.array(z.any()),conflicts:z.array(z.any()),notes:z.array(z.string())});
export class ResearchStore{
 async saveRetrieval(projectId:string,taskId:string,documents:unknown[]){await writeFileAtomic(join(this.root,SafeId.parse(projectId),SafeId.parse(taskId)+".retrieved.json"),JSON.stringify({taskId,at:new Date().toISOString(),documents},null,2));}
 constructor(private root=".companyswai/research"){}
 private path(projectId:string,taskId:string){return join(this.root,SafeId.parse(projectId),SafeId.parse(taskId)+".json");}
 async save(projectId:string,taskId:string,parsed:ParsedResearch,external:boolean,notes:string[]){
  const value=StoredResearch.parse({taskId,at:new Date().toISOString(),externalResearch:external,sources:parsed.sources,claims:parsed.claims,conflicts:parsed.conflicts,notes});
  await writeFileAtomic(this.path(projectId,taskId),JSON.stringify(value,null,2));return value;
 }
 async load(projectId:string,taskId:string){
  try{return StoredResearch.parse(JSON.parse(await readFile(this.path(projectId,taskId),"utf8")));}
  catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return undefined;throw error;}
 }
}

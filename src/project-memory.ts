import {appendFile,mkdir,readFile,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {ProjectPlan,type ProjectPlanInput} from "./project.js";
import {SafeId} from "./ids.js";
import {loadMemoryRouting,type MemoryRouting} from "./company.js";
import {pickSections} from "./context.js";
import {redact} from "./secrets.js";

export const MEMORY_FILES=["PLAN.md","REQUIREMENTS.md","ARCHITECTURE.md","DECISIONS.md","HANDOFFS.md","REVIEWS.md","BLOCKERS.md","QA.md","STATUS.md","RETROSPECTIVE.md"] as const;
export type MemoryFile=(typeof MEMORY_FILES)[number];
const SUMMARY_CHARS=3000,VIEW_CHARS=12000,REVIEW_CHARS=4000;
const stamp=()=>new Date().toISOString();
const clip=(text:string,limit:number,hint:string)=>text.length>limit?text.slice(0,limit)+"\n…[truncated — "+hint+"]":text;
/** Sections that are routed to their own memory files (or are evidence/handoff chatter) and so stay out of an artifact's view. */
const ROUTED_ELSEWHERE=["Decisions","Evidence","Handoff","Blockers"];

/**
 * Readable per-project Markdown memory. It is a human summary, not an execution dump: each task owns one block per
 * file that is replaced when the task is revised, long outputs are cut to their meaningful sections, and the full
 * text lives in the structured artifact store. Updates are idempotent and serialised per file.
 */
export class ProjectMemoryStore{
 private routing?:Promise<MemoryRouting>;
 private locks=new Map<string,Promise<unknown>>();
 constructor(private root=".companyswai/projects",private companyRoot="company"){}
 private dir(projectId:string){return join(this.root,SafeId.parse(projectId));}
 private path(projectId:string,name:string){return join(this.dir(projectId),name);}
 private routes(){return this.routing??=loadMemoryRouting(this.companyRoot);}
 private locked<T>(path:string,fn:()=>Promise<T>):Promise<T>{
  const next=(this.locks.get(path)??Promise.resolve()).catch(()=>undefined).then(fn);
  this.locks.set(path,next);return next;
 }

 async init(input:ProjectPlanInput){
  const plan=ProjectPlan.parse(input);
  await mkdir(this.dir(plan.projectId),{recursive:true});
  await Promise.all(MEMORY_FILES.map(name=>this.writeIfMissing(plan.projectId,name,name==="PLAN.md"?this.renderPlan(plan,new Map()):"# "+name.replace(/\.md$/,"")+"\n\n")));
 }
 private renderPlan(plan:ReturnType<typeof ProjectPlan.parse>,states:Map<string,string>){
  return ["# PLAN","","Project: `"+plan.projectId+"` — mode "+plan.mode,"","## Tasks",...plan.tasks.map(t=>{
   const state=states.get(t.id)??"PENDING",review=t.review?" — review: "+t.review.level+" ("+(t.review.slots.length||1)+"× "+t.review.role+")":"";
   return "- ["+(state==="DONE"?"x":" ")+"] **"+t.id+"** — "+t.agentRole+(t.dependencies.length?" — depends on: "+t.dependencies.join(", "):"")+review+(t.skills.length?" — skills: "+t.skills.join(", "):"")+" — "+state;
  }),""].join("\n");
 }
 /** Rewrite PLAN.md so the checklist always mirrors the persisted task states. */
 async syncPlan(input:ProjectPlanInput,states:Map<string,string>){
  const plan=ProjectPlan.parse(input);
  await mkdir(this.dir(plan.projectId),{recursive:true});
  await writeFile(this.path(plan.projectId,"PLAN.md"),this.renderPlan(plan,states),"utf8");
 }
 private async writeIfMissing(projectId:string,name:string,content:string){
  try{await readFile(this.path(projectId,name),"utf8");}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;await writeFile(this.path(projectId,name),content,"utf8");}
 }
 async read(projectId:string,name:MemoryFile){return readFile(this.path(projectId,name),"utf8");}
 async append(projectId:string,name:string,content:string){
  const path=this.path(projectId,name);
  await this.locked(path,async()=>{await mkdir(this.dir(projectId),{recursive:true});await appendFile(path,content.endsWith("\n")?content:content+"\n","utf8");});
 }
 /** Replace the block owned by `key` (or add it). Re-running with the same key never duplicates content. */
 async upsert(projectId:string,name:string,key:string,heading:string,body:string){
  const path=this.path(projectId,name),begin="<!-- begin:"+key+" -->",end="<!-- end:"+key+" -->";
  const block=begin+"\n## "+heading+"\n\n"+redact(body.trim())+"\n"+end+"\n";
  await this.locked(path,async()=>{
   await mkdir(this.dir(projectId),{recursive:true});
   let text="";try{text=await readFile(path,"utf8");}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
   const from=text.indexOf(begin),to=text.indexOf(end);
   const next=from>=0&&to>from?text.slice(0,from)+block+text.slice(to+end.length).replace(/^\n/,""):text+(text.endsWith("\n")||!text?"":"\n")+"\n"+block;
   await writeFile(path,next,"utf8");
  });
 }

 async recordStatus(projectId:string,taskId:string,status:string,message=""){await this.append(projectId,"STATUS.md","- "+stamp()+" — **"+taskId+"** — "+status+(message?" — "+redact(message):""));}
 /**
  * The artifact's meaningful sections go to the file routed for each artifact the agent produces (company/MEMORY.md);
  * unrouted artifacts get a short summary in the fallback file. The full text stays in the artifact store.
  */
 async recordOutput(projectId:string,task:{taskId:string;agentRole:string;produces:string[];sections:string[]},artifactId:string,output:string){
  const {routes,fallback}=await this.routes(),files=[...new Set(task.produces.map(a=>routes[a]).filter(Boolean))],heading=task.taskId+" — "+task.agentRole+" ("+artifactId+")";
  const titles=task.sections.filter(title=>!ROUTED_ELSEWHERE.includes(title)),view=pickSections(output,titles);
  const body=(text:string,limit:number)=>clip(text,limit,"full text in artifact "+artifactId);
  const rendered=view.map(p=>p.title?"### "+p.title+"\n"+p.body:p.body).join("\n\n");
  if(!files.length){await this.upsert(projectId,fallback,"output:"+task.taskId,heading+" — summary",body(rendered,SUMMARY_CHARS));return;}
  for(const file of files)await this.upsert(projectId,file,"output:"+task.taskId,heading,body(rendered,VIEW_CHARS));
 }
 async recordDecision(projectId:string,taskId:string,decisionId:string,text:string){if(text.trim())await this.upsert(projectId,"DECISIONS.md","decision:"+taskId,decisionId+" — "+taskId,text);}
 async recordBlocker(projectId:string,taskId:string,text:string){if(text.trim())await this.upsert(projectId,"BLOCKERS.md","blocker:"+taskId,taskId,text);}
 async clearBlocker(projectId:string,taskId:string){await this.upsert(projectId,"BLOCKERS.md","blocker:"+taskId,taskId,"Resolved.");}
 async recordHandoff(projectId:string,fromTaskId:string,toTaskId:string,summary:string){await this.upsert(projectId,"HANDOFFS.md","handoff:"+fromTaskId+">"+toTaskId,fromTaskId+" → "+toTaskId,clip(summary,SUMMARY_CHARS,"see artifact"));}
 async recordReview(projectId:string,taskId:string,reviewTaskId:string,verdict:string,body:string){await this.upsert(projectId,"REVIEWS.md","review:"+reviewTaskId,reviewTaskId+" — reviewing "+taskId+" — "+verdict,clip(body,REVIEW_CHARS,"full review in the review store"));}
 async recordTraceability(projectId:string,markdown:string){if(markdown)await this.upsert(projectId,"QA.md","traceability","Requirement → test traceability",markdown);}
 async writeRetrospective(projectId:string,markdown:string){await mkdir(this.dir(projectId),{recursive:true});await writeFile(this.path(projectId,"RETROSPECTIVE.md"),markdown.endsWith("\n")?markdown:markdown+"\n","utf8");}
}

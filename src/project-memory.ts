import {appendFile,mkdir,readFile,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {ProjectPlan,type ProjectPlanInput} from "./project.js";
import {SafeId} from "./ids.js";
import {loadMemoryRouting,type MemoryRouting} from "./company.js";
import {condense} from "./output-parser.js";
import {redact} from "./secrets.js";

export const MEMORY_FILES=["PLAN.md","REQUIREMENTS.md","ARCHITECTURE.md","DECISIONS.md","HANDOFFS.md","REVIEWS.md","BLOCKERS.md","QA.md","STATUS.md","RETROSPECTIVE.md"] as const;
const HANDOFF_SUMMARY_CHARS=3000;
const stamp=()=>new Date().toISOString();
const block=(heading:string,body:string)=>"\n## "+heading+"\n\n"+redact(body.trim())+"\n";

/**
 * Readable per-project Markdown memory. Appends are keyed by an idempotency marker so recovering
 * a crashed run never writes the same entry twice.
 */
export class ProjectMemoryStore{
 private routing?:Promise<MemoryRouting>;
 constructor(private root=".companyswai/projects",private companyRoot="company"){}
 private dir(projectId:string){return join(this.root,SafeId.parse(projectId));}
 private path(projectId:string,name:string){return join(this.dir(projectId),name);}
 private routes(){return this.routing??=loadMemoryRouting(this.companyRoot);}

 async init(input:ProjectPlanInput){
  const plan=ProjectPlan.parse(input);
  await mkdir(this.dir(plan.projectId),{recursive:true});
  await Promise.all(MEMORY_FILES.map(name=>this.writeIfMissing(plan.projectId,name,name==="PLAN.md"?this.renderPlan(plan,new Map()):"# "+name.replace(/\.md$/,"")+"\n\n")));
 }
 private renderPlan(plan:ReturnType<typeof ProjectPlan.parse>,states:Map<string,string>){
  return ["# PLAN","","Project: `"+plan.projectId+"`","","## Tasks",...plan.tasks.map(t=>{
   const state=states.get(t.id)??"PENDING";
   return "- ["+(state==="DONE"?"x":" ")+"] **"+t.id+"** — "+t.agentRole+(t.dependencies.length?" — depends on: "+t.dependencies.join(", "):"")+(t.review?" — reviewer: "+t.review.role:"")+" — "+state;
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
 async read(projectId:string,name:(typeof MEMORY_FILES)[number]){return readFile(this.path(projectId,name),"utf8");}
 async append(projectId:string,name:string,content:string){await mkdir(this.dir(projectId),{recursive:true});await appendFile(this.path(projectId,name),content.endsWith("\n")?content:content+"\n","utf8");}
 private async appendOnce(projectId:string,name:string,key:string,content:string){
  const marker="<!-- "+key+" -->";
  let existing="";try{existing=await readFile(this.path(projectId,name),"utf8");}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
  if(existing.includes(marker))return;
  await this.append(projectId,name,marker+content);
 }

 async recordStatus(projectId:string,taskId:string,status:string,message=""){await this.append(projectId,"STATUS.md","- "+stamp()+" — **"+taskId+"** — "+status+(message?" — "+redact(message):""));}
 /** Full output goes to the file routed for each artifact the agent produces (company/MEMORY.md); unrouted artifacts are summarised in the fallback file. */
 async recordOutput(projectId:string,task:{taskId:string;agentRole:string;produces:string[]},executionId:string,output:string){
  const {routes,fallback}=await this.routes(),files=[...new Set(task.produces.map(a=>routes[a]).filter(Boolean))],heading=task.taskId+" — "+task.agentRole;
  if(!files.length){await this.appendOnce(projectId,fallback,"output:"+executionId,block(heading+" (summary)",condense(output,HANDOFF_SUMMARY_CHARS)));return;}
  for(const file of files)await this.appendOnce(projectId,file,"output:"+executionId,block(heading,output));
 }
 async recordDecision(projectId:string,taskId:string,executionId:string,text:string){if(text.trim())await this.appendOnce(projectId,"DECISIONS.md","decision:"+executionId,block(taskId,text));}
 async recordBlocker(projectId:string,taskId:string,executionId:string,text:string){if(text.trim())await this.appendOnce(projectId,"BLOCKERS.md","blocker:"+executionId,block(taskId,text));}
 async recordHandoff(projectId:string,fromTaskId:string,toTaskId:string,executionId:string,summary:string){await this.appendOnce(projectId,"HANDOFFS.md","handoff:"+executionId+":"+toTaskId,block(fromTaskId+" → "+toTaskId,summary));}
 async recordReview(projectId:string,taskId:string,reviewTaskId:string,executionId:string,verdict:string,body:string){await this.appendOnce(projectId,"REVIEWS.md","review:"+executionId,block(reviewTaskId+" — reviewing "+taskId+" — "+verdict,body));}
 async writeRetrospective(projectId:string,markdown:string){await mkdir(this.dir(projectId),{recursive:true});await writeFile(this.path(projectId,"RETROSPECTIVE.md"),markdown.endsWith("\n")?markdown:markdown+"\n","utf8");}
}

import {appendFile,mkdir,readFile,writeFile} from "node:fs/promises";
import {join} from "node:path";
import type {ProjectPlanValue} from "./project.js";
import {SafeId} from "./ids.js";

const safe=(value:string)=>SafeId.parse(value);
export class ProjectMemoryStore{
 constructor(private root=".companyswai/projects"){}
 private dir(projectId:string){return join(this.root,safe(projectId));}
 private path(projectId:string,name:string){return join(this.dir(projectId),name);}
 async init(plan:ProjectPlanValue){
  const dir=this.dir(plan.projectId);await mkdir(dir,{recursive:true});
  const planMd=["# PLAN","","Project: `"+plan.projectId+"`","","## Tasks",...plan.tasks.map(t=>"- [ ] **"+t.id+"** — "+t.agentRole+(t.dependencies.length?" — depends on: "+t.dependencies.join(", "):"")),""].join("\n");
  await Promise.all([
   this.writeIfMissing(plan.projectId,"PLAN.md",planMd),
   this.writeIfMissing(plan.projectId,"REQUIREMENTS.md","# REQUIREMENTS\n\n"),
   this.writeIfMissing(plan.projectId,"ARCHITECTURE.md","# ARCHITECTURE\n\n"),
   this.writeIfMissing(plan.projectId,"DECISIONS.md","# DECISIONS\n\n"),
   this.writeIfMissing(plan.projectId,"HANDOFFS.md","# HANDOFFS\n\n"),
   this.writeIfMissing(plan.projectId,"REVIEWS.md","# REVIEWS\n\n"),\n   this.writeIfMissing(plan.projectId,"BLOCKERS.md","# BLOCKERS\n\n"),
   this.writeIfMissing(plan.projectId,"QA.md","# QA\n\n"),
   this.writeIfMissing(plan.projectId,"STATUS.md","# STATUS\n\n")
  ]);
 }
 private async writeIfMissing(projectId:string,name:string,content:string){
  try{await readFile(this.path(projectId,name),"utf8");}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;await writeFile(this.path(projectId,name),content,"utf8");}
 }
 async append(projectId:string,name:string,content:string){await mkdir(this.dir(projectId),{recursive:true});await appendFile(this.path(projectId,name),content.endsWith("\n")?content:content+"\n","utf8");}
 async recordStatus(projectId:string,taskId:string,status:string,message=""){await this.append(projectId,"STATUS.md","- "+new Date().toISOString()+" — **"+taskId+"** — "+status+(message?" — "+message:""));}
 async recordOutput(projectId:string,taskId:string,agentRole:string,output:string){
  const block="\n## "+taskId+" — "+agentRole+"\n\n"+output.trim()+"\n";
  if(agentRole==="business-analyst")await this.append(projectId,"REQUIREMENTS.md",block);
  else if(agentRole==="tech-lead")await this.append(projectId,"ARCHITECTURE.md",block);
  else if(agentRole==="reviewer"||taskId.includes("--review-"))await this.append(projectId,"REVIEWS.md",block);
  else if(agentRole==="qa-engineer")await this.append(projectId,"QA.md",block);
  else await this.append(projectId,"HANDOFFS.md",block);
 }
 async recordDecision(projectId:string,taskId:string,text:string){if(text.trim())await this.append(projectId,"DECISIONS.md","\n## "+taskId+"\n\n"+text.trim()+"\n");}
 async recordBlocker(projectId:string,taskId:string,text:string){if(text.trim())await this.append(projectId,"BLOCKERS.md","\n## "+taskId+"\n\n"+text.trim()+"\n");}
}

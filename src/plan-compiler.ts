import type {ProjectPlanValue} from "./project.js";
import {MarkdownAgentRegistry,systemPromptFor} from "./md-agent-loader.js";
import {loadCompanyMarkdown} from "./company.js";
import {planCompanyWork,type ProjectBriefValue} from "./work-planner.js";

export async function compileBriefToProjectPlan(brief:ProjectBriefValue):Promise<ProjectPlanValue>{
 const registry=new MarkdownAgentRegistry();
 const [work,globalMd]=await Promise.all([planCompanyWork(brief,registry),loadCompanyMarkdown()]);
 const all=work.departments.flatMap(d=>d.agents.map(a=>a.definition));
 const reviewerById=new Map(all.filter(a=>a.mode==="reviewer").map(a=>[a.id,a]));
 return {
  projectId:work.projectId,budget:{},
  tasks:work.tasks.map(task=>{
   const reviewer=task.reviewer?reviewerById.get(task.reviewer):undefined;
   return {
    id:task.id,agentRole:task.agentRole,dependencies:task.dependencies,system:task.system,prompt:task.objective,inputRefs:[],
    capabilities:["reasoning",task.department,task.risk==="critical"?"critical-review":"implementation"],
    estimatedInputTokens:task.risk==="critical"?5000:3000,estimatedOutputTokens:task.risk==="critical"?5000:3000,maxTokens:task.risk==="critical"?6000:4096,
    ...(reviewer?{review:{role:reviewer.id,system:systemPromptFor(reviewer,globalMd.company,globalMd.workflow,globalMd.quality),capabilities:["reasoning","review"],estimatedInputTokens:3000,estimatedOutputTokens:2000,maxTokens:3000,maxRounds:task.risk==="critical"?3:2}}:{})
   };
  })
 };
}

import {ProjectPlan,type ProjectPlanValue} from "./project.js";
import {MarkdownAgentRegistry,systemPromptFor} from "./md-agent-loader.js";
import {loadCompanyMarkdown} from "./company.js";
import {planCompanyWork,type ProjectBriefInput} from "./work-planner.js";

export async function compileBriefToProjectPlan(brief:ProjectBriefInput,lessons:string[]=[]):Promise<ProjectPlanValue>{
 const registry=new MarkdownAgentRegistry(),[work,globalMd]=await Promise.all([planCompanyWork(brief,registry),loadCompanyMarkdown()]),all=work.departments.flatMap(d=>d.agents.map(a=>a.definition)),reviewerById=new Map(all.filter(a=>a.mode==="reviewer").map(a=>[a.id,a]));
 const learning=lessons.length?"\n\n--- ORGANIZATIONAL LESSONS FROM PRIOR RUN ---\n"+lessons.map(x=>"- "+x).join("\n"):"";
 return ProjectPlan.parse({projectId:work.projectId,budget:brief.budget??{maxTeamCost:{},maxAgentCost:{}},...(brief.workspacePath?{workspace:{path:brief.workspacePath,checks:(brief.checks??[]).map(c=>({cmd:c.cmd,args:c.args??[]})),autoCommit:brief.autoCommit??false}}:{}),tasks:work.tasks.map(task=>{const reviewer=task.reviewer?reviewerById.get(task.reviewer):undefined;return {
  id:task.id,agentRole:task.agentRole,department:task.department,dependencies:task.dependencies,system:task.system+learning,prompt:task.objective,inputRefs:[],capabilities:task.capabilities,produces:task.produces,contract:task.contract,estimatedInputTokens:task.risk==="critical"?5000:3000,estimatedOutputTokens:task.risk==="critical"?5000:3000,maxTokens:task.risk==="critical"?6000:4096,
  ...(reviewer?{review:{role:reviewer.id,department:reviewer.department,system:systemPromptFor(reviewer,globalMd.company,globalMd.workflow,globalMd.quality,globalMd.contractText)+learning,capabilities:reviewer.modelCapabilities,contract:{sections:globalMd.contract.reviewerSections,verdict:true},estimatedInputTokens:3000,estimatedOutputTokens:2000,maxTokens:3000,maxRounds:task.risk==="critical"?3:2}}:{})
 };})});
}

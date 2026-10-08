import {ProjectPlan,type ProjectPlanValue} from "./project.js";
import {MarkdownAgentRegistry,systemPromptFor} from "./md-agent-loader.js";
import {loadCompanyMarkdown} from "./company.js";
import {PATTERNS} from "./retrospective.js";
import {planCompanyWork,type ProjectBriefInput} from "./work-planner.js";

export type Learning={projectLessons?:string[];experience?:Array<{pattern:string;scope:string}>};
const GENERIC_CLEAN=PATTERNS.clean;
/** Lessons reach an agent only when they apply: this project's own lessons, company experience, and experience scoped to that role. */
function learningFor(role:string,learning:Learning){
 const own=(learning.projectLessons??[]).filter(x=>x!==GENERIC_CLEAN);
 const shared=(learning.experience??[]).filter(x=>x.scope==="company"||x.scope==="role:"+role).map(x=>x.pattern);
 const lessons=[...own,...shared];
 return lessons.length?"\n\n--- LESSONS FROM PRIOR WORK ---\n"+lessons.map(x=>"- "+x).join("\n"):"";
}

export async function compileBriefToProjectPlan(brief:ProjectBriefInput,learning:Learning={}):Promise<ProjectPlanValue>{
 const registry=new MarkdownAgentRegistry(),[work,globalMd]=await Promise.all([planCompanyWork(brief,registry),loadCompanyMarkdown()]),all=work.departments.flatMap(d=>d.agents.map(a=>a.definition)),reviewerById=new Map(all.filter(a=>a.mode==="reviewer").map(a=>[a.id,a]));
 return ProjectPlan.parse({projectId:work.projectId,budget:brief.budget??{maxTeamCost:{},maxAgentCost:{}},...(brief.workspacePath?{workspace:{path:brief.workspacePath,checks:(brief.checks??[]).map(c=>({cmd:c.cmd,args:c.args??[]})),autoCommit:brief.autoCommit??false}}:{}),tasks:work.tasks.map(task=>{const reviewer=task.reviewer?reviewerById.get(task.reviewer):undefined;return {
  id:task.id,agentRole:task.agentRole,department:task.department,dependencies:task.dependencies,system:task.system+learningFor(task.agentRole,learning),prompt:task.objective,inputRefs:[],capabilities:task.capabilities,produces:task.produces,contract:task.contract,estimatedInputTokens:task.risk==="critical"?5000:3000,estimatedOutputTokens:task.risk==="critical"?5000:3000,maxTokens:task.risk==="critical"?6000:4096,
  ...(reviewer?{review:{role:reviewer.id,department:reviewer.department,system:systemPromptFor(reviewer,globalMd.company,globalMd.workflow,globalMd.quality,globalMd.contractText)+learningFor(reviewer.id,learning),capabilities:reviewer.modelCapabilities,contract:{sections:globalMd.contract.reviewerSections,verdict:true},estimatedInputTokens:3000,estimatedOutputTokens:2000,maxTokens:3000,maxRounds:task.risk==="critical"?3:2}}:{})
 };})});
}

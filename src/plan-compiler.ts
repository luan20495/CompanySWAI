import {ProjectPlan,type ProjectPlanValue} from "./project.js";
import {loadCompanyMarkdown} from "./company.js";
import {planCompanyWork,ProjectBrief,type ProjectBriefInput,type PlannedTask} from "./work-planner.js";
import {PATTERNS} from "./retrospective.js";

export type Learning={projectLessons?:string[];experience?:Array<{pattern:string;scope:string}>};
const GENERIC_CLEAN=PATTERNS.clean;
/**
 * Lessons reach an agent only when they apply: this project's own lessons, plus validated company experience whose scope
 * matches — GLOBAL, ROLE:<this agent>, SKILL:<a skill it runs with>, DOMAIN:<a project signal tag>.
 */
function learningFor(role:string,skills:string[],domains:string[],learning:Learning){
 const own=(learning.projectLessons??[]).filter(x=>x!==GENERIC_CLEAN),tags=domains.map(d=>d.toLowerCase());
 const applies=(scope:string)=>{
  const [kind,name]=scope.split(":");
  return scope==="company"||kind==="GLOBAL"||((kind==="ROLE"||kind==="role")&&name===role)||(kind==="SKILL"&&skills.includes(name))||(kind==="DOMAIN"&&tags.includes(name.toLowerCase()));
 };
 const lessons=[...own,...(learning.experience??[]).filter(x=>applies(x.scope)).map(x=>x.pattern)];
 return lessons.length?"\n\n--- LESSONS FROM PRIOR WORK ---\n"+lessons.map(x=>"- "+x).join("\n"):"";
}

/** Number of tasks that transitively depend on each task: work on the critical path is scheduled first. */
function criticality(tasks:PlannedTask[]){
 const dependents=new Map<string,Set<string>>(tasks.map(t=>[t.id,new Set<string>()]));
 for(const task of tasks)for(const dep of task.dependencies)dependents.get(dep)?.add(task.id);
 const memo=new Map<string,Set<string>>();
 const reach=(id:string):Set<string>=>{
  const known=memo.get(id);if(known)return known;
  const out=new Set<string>();memo.set(id,out);
  for(const next of dependents.get(id)??[]){out.add(next);for(const deeper of reach(next))out.add(deeper);}
  return out;
 };
 return (id:string)=>reach(id).size;
}

export async function compileBriefToProjectPlan(input:ProjectBriefInput,learning:Learning={}):Promise<ProjectPlanValue>{
 const brief=ProjectBrief.parse(input),[work,md]=await Promise.all([planCompanyWork(brief),loadCompanyMarkdown()]);
 const mode=md.policy.modes[brief.mode],critical=criticality(work.tasks);
 const quality={routing:mode.routing,minQualityTier:mode.minQualityTier};
 const workspace=brief.workspacePath?{path:brief.workspacePath,checks:brief.checks,gates:brief.gates,setup:brief.setup,autoCommit:brief.autoCommit,isolation:brief.isolation}:undefined;
 return ProjectPlan.parse({
  projectId:work.projectId,mode:brief.mode,maxQAReworkRounds:mode.qaReworkRounds,budget:brief.budget,research:brief.research,signals:work.signals,...(workspace?{workspace}:{}),
  tasks:work.tasks.map(task=>({
   id:task.id,agentRole:task.agentRole,department:task.department,dependencies:task.dependencies,system:task.system+learningFor(task.agentRole,task.skills,work.signals,learning),prompt:task.objective,inputRefs:[],
   capabilities:task.capabilities,produces:task.produces,contract:task.contract,risk:task.risk,skills:task.skills,requiredGates:task.requiredGates,deliversCode:task.deliversCode,priority:critical(task.id),
   ...quality,estimatedInputTokens:task.risk==="critical"?5000:3000,estimatedOutputTokens:task.risk==="critical"?5000:3000,maxTokens:task.risk==="critical"?6000:4096,
   ...(task.review?{review:{
    role:task.review.role,department:task.review.department,system:task.review.system+learningFor(task.review.role,task.review.skills,work.signals,learning),capabilities:task.review.capabilities,contract:task.review.contract,
    level:task.review.level,gates:task.review.gates,slots:task.review.slots.map(slot=>({...slot,system:slot.system+learningFor(task.review!.role,task.review!.skills,work.signals,learning)})),
    ...quality,estimatedInputTokens:3000,estimatedOutputTokens:2000,maxTokens:3000,maxRounds:task.review.maxRounds
   }}:{})
  }))
 });
}

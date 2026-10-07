import type {ProjectPlanValue} from "./project.js";
import {planCompanyWork,type ProjectBriefValue,type PlannedTask} from "./work-planner.js";

const systemFor=(task:PlannedTask)=>[
 "You are the "+task.agentRole+" in the "+task.department+" department.",
 "Work only on the assigned responsibility. Use upstream evidence and preserve explicit constraints.",
 "Return concrete, implementation-ready output. State assumptions and unresolved blockers.",
 task.risk==="critical"||task.risk==="high"?"Treat this as "+task.risk+" risk: include failure modes, validation evidence and rollback/safety considerations.":""
].filter(Boolean).join("\n");

const reviewSystem=(reviewer:string,task:PlannedTask)=>[
 "You are "+reviewer+", an independent reviewer.",
 "Check correctness, completeness, requirement coverage, regressions and evidence.",
 "For high-risk work, reject missing tests, security/performance evidence or rollback reasoning.",
 "The first non-empty line MUST be PASS or CHANGES_REQUIRED."
].join("\n");

export function compileBriefToProjectPlan(brief:ProjectBriefValue):ProjectPlanValue{
 const work=planCompanyWork(brief);
 return {
  projectId:work.projectId,budget:{},
  tasks:work.tasks.map(task=>({
   id:task.id,agentRole:task.agentRole,dependencies:task.dependencies,
   system:systemFor(task),prompt:task.objective,inputRefs:[],
   capabilities:["reasoning",task.department,task.risk==="critical"?"critical-review":"implementation"],
   estimatedInputTokens:task.risk==="critical"?5000:3000,estimatedOutputTokens:task.risk==="critical"?5000:3000,
   maxTokens:task.risk==="critical"?6000:4096,
   ...(task.reviewer?{review:{role:task.reviewer,system:reviewSystem(task.reviewer,task),capabilities:["reasoning","review"],estimatedInputTokens:3000,estimatedOutputTokens:2000,maxTokens:3000,maxRounds:task.risk==="critical"?3:2}}:{})
  }))
 };
}

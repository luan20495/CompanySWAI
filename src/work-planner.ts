import {z} from "zod";
import {composeCompany,type ProjectProfile,type DepartmentPlan} from "./company.js";
import {SafeId} from "./ids.js";

export const ProjectBrief=z.object({
 projectId:SafeId,
 objective:z.string().min(10),
 capabilities:z.array(z.enum(["backend","web-ui","mobile","deployment","security-critical","performance-critical"])).min(1),
 complexity:z.union([z.literal(1),z.literal(2),z.literal(3),z.literal(4),z.literal(5)]),
 mobileSkills:z.array(z.string()).optional()
});
export type ProjectBriefValue=z.infer<typeof ProjectBrief>;
export type PlannedTask={id:string;department:string;agentRole:string;dependencies:string[];objective:string;reviewer?:string;risk:"low"|"medium"|"high"|"critical"};
export type CompanyWorkPlan={projectId:string;departments:DepartmentPlan[];tasks:PlannedTask[]};

const slug=(value:string)=>value.replace(/[^A-Za-z0-9._-]+/g,"-").replace(/^-+|-+$/g,"").toLowerCase();
const risk=(profile:ProjectProfile):PlannedTask["risk"]=>profile.capabilities.includes("security-critical")?"critical":profile.capabilities.includes("performance-critical")?"high":profile.complexity>=4?"high":"medium";
const reviewer=(d:DepartmentPlan,role:string)=>d.agents.find(a=>a.role.includes("reviewer")&&a.role!==role)?.role;

export function planCompanyWork(input:ProjectBriefValue):CompanyWorkPlan{
 const brief=ProjectBrief.parse(input);const profile:ProjectProfile={capabilities:brief.capabilities,complexity:brief.complexity,mobileSkills:brief.mobileSkills};
 const departments=composeCompany(profile),tasks:PlannedTask[]=[];let previous:string[]=[];
 for(const department of departments){
  const makers=department.agents.filter(a=>!a.role.includes("reviewer"));
  const current:string[]=[];
  for(const agent of makers){
   const id=slug(department.name+"-"+agent.role);current.push(id);
   tasks.push({id,department:department.name,agentRole:agent.role,dependencies:[...previous],objective:brief.objective+" — "+department.name+" responsibility handled by "+agent.role,reviewer:reviewer(department,agent.role),risk:risk(profile)});
  }
  previous=current;
 }
 return {projectId:brief.projectId,departments,tasks};
}

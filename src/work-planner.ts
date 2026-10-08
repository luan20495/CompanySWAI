import {z} from "zod";
import {composeCompany,loadCompanyMarkdown,type ProjectProfile,type DepartmentPlan} from "./company.js";
import {MarkdownAgentRegistry,systemPromptFor,type AgentDefinition} from "./md-agent-loader.js";
import {SafeId} from "./ids.js";

const Budget=z.object({maxProjectCost:z.number().nonnegative().optional(),maxTaskCost:z.number().nonnegative().optional(),maxTeamCost:z.record(z.string(),z.number().nonnegative()).default({}),maxAgentCost:z.record(z.string(),z.number().nonnegative()).default({}),approvalThreshold:z.number().nonnegative().optional()}).default({maxTeamCost:{},maxAgentCost:{}});
const CheckCommand=z.object({cmd:z.string().regex(/^[A-Za-z0-9._-]+$/),args:z.array(z.string()).default([])});
export const ProjectBrief=z.object({
 projectId:SafeId,objective:z.string().min(10),
 capabilities:z.array(z.enum(["backend","web-ui","mobile","deployment","security-critical","performance-critical"])).min(1),
 complexity:z.union([z.literal(1),z.literal(2),z.literal(3),z.literal(4),z.literal(5)]),mobileSkills:z.array(z.string()).optional(),
 budget:Budget,workspacePath:z.string().min(1).optional(),checks:z.array(CheckCommand).default([]),autoCommit:z.boolean().default(false)
});
export type ProjectBriefValue=z.infer<typeof ProjectBrief>;
export type ProjectBriefInput=z.input<typeof ProjectBrief>;
export type PlannedTask={id:string;department:string;agentRole:string;dependencies:string[];objective:string;reviewer?:string;risk:"low"|"medium"|"high"|"critical";system:string;produces:string[];requires:string[];};
export type CompanyWorkPlan={projectId:string;departments:DepartmentPlan[];tasks:PlannedTask[]};
const risk=(profile:ProjectProfile):PlannedTask["risk"]=>profile.capabilities.includes("security-critical")?"critical":profile.capabilities.includes("performance-critical")?"high":profile.complexity>=4?"high":"medium";
export async function planCompanyWork(input:ProjectBriefInput,registry=new MarkdownAgentRegistry()):Promise<CompanyWorkPlan>{
 const brief=ProjectBrief.parse(input),profile:ProjectProfile={capabilities:brief.capabilities,complexity:brief.complexity,mobileSkills:brief.mobileSkills};
 const [departments,globalMd]=await Promise.all([composeCompany(profile,registry),loadCompanyMarkdown()]);const agents=departments.flatMap(d=>d.agents.map(a=>a.definition)),makers=agents.filter(a=>a.mode==="maker").sort((a,b)=>a.stage-b.stage||a.id.localeCompare(b.id)),producers=new Map<string,AgentDefinition[]>();
 for(const agent of makers)for(const artifact of agent.produces){const list=producers.get(artifact)??[];list.push(agent);producers.set(artifact,list);}
 const tasks:PlannedTask[]=[];
 for(const agent of makers){const deps=new Set<string>();for(const artifact of [...agent.requires,...agent.optionalRequires])for(const producer of producers.get(artifact)??[])if(producer.id!==agent.id)deps.add(producer.id);
  const reviewer=agent.reviewedBy!=="none"&&agents.some(a=>a.id===agent.reviewedBy&&a.mode==="reviewer")?agent.reviewedBy:undefined;
  tasks.push({id:agent.id,department:agent.department,agentRole:agent.id,dependencies:[...deps],objective:brief.objective+"\n\nAssigned responsibility: "+agent.identity.split(/\r?\n/)[0],reviewer,risk:risk(profile),system:systemPromptFor(agent,globalMd.company,globalMd.workflow,globalMd.quality),produces:agent.produces,requires:agent.requires});
 }
 return {projectId:brief.projectId,departments,tasks};
}

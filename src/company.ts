import {readFile} from "node:fs/promises";
import {MarkdownAgentRegistry,activationMatches,type AgentDefinition} from "./md-agent-loader.js";

export type Complexity=1|2|3|4|5;
export type Capability="backend"|"web-ui"|"mobile"|"deployment"|"security-critical"|"performance-critical";
export type ProjectProfile={capabilities:Capability[];complexity:Complexity;mobileSkills?:string[]};
export type AgentPlan={role:string;skills:string[];definition:AgentDefinition};
export type DepartmentPlan={name:string;agents:AgentPlan[];reviewDepth:number};

export async function composeCompany(profile:ProjectProfile,registry=new MarkdownAgentRegistry()):Promise<DepartmentPlan[]>{
 const all=await registry.loadAll();
 const active=all.filter(agent=>activationMatches(agent.activation,profile.capabilities,profile.complexity));
 const byDepartment=new Map<string,AgentPlan[]>();
 for(const agent of active){
  const list=byDepartment.get(agent.department)??[];
  list.push({role:agent.id,skills:agent.skills,definition:agent});
  byDepartment.set(agent.department,list);
 }
 return [...byDepartment.entries()].map(([name,agents])=>({
  name,agents:agents.sort((a,b)=>a.definition.stage-b.definition.stage||a.role.localeCompare(b.role)),
  reviewDepth:profile.complexity>=4||profile.capabilities.includes("security-critical")||profile.capabilities.includes("performance-critical")?2:1
 })).sort((a,b)=>Math.min(...a.agents.map(x=>x.definition.stage))-Math.min(...b.agents.map(x=>x.definition.stage)));
}

export async function loadCompanyMarkdown(root="company"){
 const [company,workflow,quality]=await Promise.all([
  readFile(root+"/COMPANY.md","utf8"),readFile(root+"/WORKFLOW.md","utf8"),readFile(root+"/QUALITY-GATES.md","utf8")
 ]);
 return {company,workflow,quality};
}

import {readFile} from "node:fs/promises";
import {z} from "zod";
import {MarkdownAgentRegistry,activationMatches,parseMarkdownFrontmatter,type AgentDefinition} from "./md-agent-loader.js";

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

const ContractMeta=z.object({
 sections:z.array(z.string().min(1)).min(1),reviewerSections:z.array(z.string().min(1)).default([]),verdicts:z.array(z.string().min(1)).min(1)
});
const MemoryMeta=z.object({routes:z.record(z.string(),z.string().regex(/^[A-Z]+\.md$/)),fallback:z.string().regex(/^[A-Z]+\.md$/)});
const Risk=z.enum(["low","medium","high","critical"]);
export type Risk=z.infer<typeof Risk>;
export const ReviewLevel=z.enum(["NORMAL","CRITICAL","HIGH_RISK"]);
export type ReviewLevelValue=z.infer<typeof ReviewLevel>;
export const QualityMode=z.enum(["FAST","BALANCED","MAX_QUALITY"]);
export type QualityModeValue=z.infer<typeof QualityMode>;
export const RoutingPolicy=z.enum(["QUALITY_FIRST","BALANCED","COST_FIRST","LOCAL_FIRST"]);
export type RoutingPolicyValue=z.infer<typeof RoutingPolicy>;
const PolicyMeta=z.object({
 levels:z.record(ReviewLevel,z.object({reviewers:z.number().int().min(1).max(3),gates:z.array(z.string())})),
 modes:z.record(QualityMode,z.object({
  reviewRisks:z.array(Risk),levelByRisk:z.partialRecord(Risk,ReviewLevel),routing:RoutingPolicy,
  minQualityTier:z.number().int().min(1).max(5),requiredGates:z.array(z.string()),qa:z.enum(["light","standard","deep"])
 }))
});
export type PolicyDefinition=z.infer<typeof PolicyMeta>;
const Applies=z.object({appliesWhen:z.string().min(1)});
const GatesMeta=z.object({
 codeGates:z.record(z.string(),Applies),architectureCategories:z.record(z.string(),Applies),
 lenses:z.record(z.string(),z.object({validator:z.string().optional(),skill:z.string().optional(),instruction:z.string().min(1)})),
 qaStatuses:z.array(z.string()).min(1)
});
export type GatesDefinition=z.infer<typeof GatesMeta>;

export type OutputContract=z.infer<typeof ContractMeta>;
export type MemoryRouting=z.infer<typeof MemoryMeta>;

export async function loadMemoryRouting(root="company"):Promise<MemoryRouting>{
 const memory=parseMarkdownFrontmatter(await readFile(root+"/MEMORY.md","utf8"));
 return MemoryMeta.parse(memory.meta);
}

export async function loadCompanyMarkdown(root="company"){
 const [company,workflow,quality,contractFile,memory,policyFile,gatesFile]=await Promise.all([
  readFile(root+"/COMPANY.md","utf8"),readFile(root+"/WORKFLOW.md","utf8"),readFile(root+"/QUALITY-GATES.md","utf8"),
  readFile(root+"/OUTPUT-CONTRACT.md","utf8"),loadMemoryRouting(root),readFile(root+"/POLICY.md","utf8"),readFile(root+"/GATES.md","utf8")
 ]);
 const contract=parseMarkdownFrontmatter(contractFile);
 return {company,workflow,quality,contractText:contract.body,contract:ContractMeta.parse(contract.meta),memory,
  policy:PolicyMeta.parse(parseMarkdownFrontmatter(policyFile).meta),gates:GatesMeta.parse(parseMarkdownFrontmatter(gatesFile).meta)};
}

import {z} from "zod";
import {composeCompany,loadCompanyMarkdown,type DepartmentPlan,type ProjectProfile,type Risk} from "./company.js";
import {MarkdownAgentRegistry,systemPromptFor,type AgentDefinition} from "./md-agent-loader.js";
import {SafeId} from "./ids.js";
import {BudgetPolicySchema,CheckCommand,ResearchSettings} from "./project.js";
import {QualityMode} from "./company.js";
import {appliesWhen} from "./applies.js";
import {reviewDecision} from "./policy.js";
import {SkillCatalog,selectSkills,type SkillSignals} from "./skill-selector.js";

export const ProjectBrief=z.object({
 projectId:SafeId,objective:z.string().min(10),
 capabilities:z.array(z.enum(["backend","web-ui","mobile","deployment","security-critical","performance-critical"])).min(1),
 complexity:z.union([z.literal(1),z.literal(2),z.literal(3),z.literal(4),z.literal(5)]),mobileSkills:z.array(z.string()).optional(),
 /** FAST | BALANCED | MAX_QUALITY: how much independent assurance and provider quality the project gets. */
 mode:QualityMode.default("BALANCED"),
 /** Free-form tags ("android", "postgres", "brownfield", …) that activate dynamic skills and gates. */
 signals:z.array(z.string().min(1)).default([]),
 research:ResearchSettings.default({enabled:false,maxSourceAgeDays:730,connectors:[]}),
 budget:BudgetPolicySchema,workspacePath:z.string().min(1).optional(),checks:z.array(CheckCommand).default([]),
 gates:z.record(z.string(),z.array(CheckCommand)).default({}),setup:z.array(CheckCommand).default([]),
 autoCommit:z.boolean().default(false),isolation:z.enum(["none","worktree"]).default("none")
});
export type ProjectBriefValue=z.infer<typeof ProjectBrief>;
export type ProjectBriefInput=z.input<typeof ProjectBrief>;

type Contract={sections:string[];verdict:boolean;validators:string[];params:Record<string,unknown>};
export type PlannedReviewSlot={lens?:string;system:string;contract:Contract};
export type PlannedReview={
 role:string;department:string;level:string;reviewers:number;gates:string[];system:string;capabilities:string[];
 contract:Contract;slots:PlannedReviewSlot[];skills:string[];
};
export type PlannedTask={
 id:string;department:string;agentRole:string;dependencies:string[];objective:string;reviewer?:string;risk:Risk;system:string;
 produces:string[];requires:string[];capabilities:string[];contract:Contract;skills:string[];requiredGates:string[];
 deliversCode:boolean;review?:PlannedReview;
};
export type CompanyWorkPlan={projectId:string;departments:DepartmentPlan[];tasks:PlannedTask[];signals:string[]};

const projectRisk=(profile:ProjectProfile):Risk=>profile.capabilities.includes("security-critical")?"critical":profile.capabilities.includes("performance-critical")?"high":profile.complexity>=4?"high":"medium";

export function skillSignals(brief:ProjectBriefValue):SkillSignals{
 return {capabilities:brief.capabilities,complexity:brief.complexity,tags:[...brief.signals,...(brief.mobileSkills??[])],text:brief.objective};
}

export async function planCompanyWork(input:ProjectBriefInput,registry=new MarkdownAgentRegistry(),catalog=new SkillCatalog()):Promise<CompanyWorkPlan>{
 const brief=ProjectBrief.parse(input),profile:ProjectProfile={capabilities:brief.capabilities,complexity:brief.complexity,mobileSkills:brief.mobileSkills};
 const [departments,md,dynamic]=await Promise.all([composeCompany(profile,registry),loadCompanyMarkdown(),catalog.load()]);
 const agents=departments.flatMap(d=>d.agents.map(a=>a.definition));
 const makers=agents.filter(a=>a.mode==="maker").sort((a,b)=>a.stage-b.stage||a.id.localeCompare(b.id)),producers=new Map<string,AgentDefinition[]>();
 for(const agent of makers)for(const artifact of agent.produces){const list=producers.get(artifact)??[];list.push(agent);producers.set(artifact,list);}
 for(const agent of makers)for(const artifact of agent.requires)if(!(producers.get(artifact)??[]).some(p=>p.id!==agent.id))throw new Error("Required artifact '"+artifact+"' for "+agent.id+" has no active producer; add a capability or complexity that activates one");

 const signals=skillSignals(brief),risk=projectRisk(profile),mode=md.policy.modes[brief.mode];
 const gateContext={capabilities:brief.capabilities,complexity:brief.complexity,tags:signals.tags};
 const architectureCategories=Object.entries(md.gates.architectureCategories).filter(([,rule])=>appliesWhen(rule.appliesWhen,gateContext)).map(([name])=>name);
 const requiredGates=mode.requiredGates.filter(name=>md.gates.codeGates[name]&&appliesWhen(md.gates.codeGates[name].appliesWhen,gateContext));
 const tasks:PlannedTask[]=[];
 for(const agent of makers){
  const deps=new Set<string>();
  for(const artifact of [...agent.requires,...agent.optionalRequires])for(const producer of producers.get(artifact)??[])if(producer.id!==agent.id)deps.add(producer.id);
  const picked=selectSkills(dynamic,agent.id,signals),skillBodies=picked.map(s=>s.body);
  const contract:Contract={sections:[...md.contract.sections,...agent.extraSections],verdict:false,validators:[...agent.validators],params:{externalResearch:brief.research.enabled&&brief.research.connectors.length>0,maxSourceAgeDays:brief.research.maxSourceAgeDays,workspaceConfigured:Boolean(brief.workspacePath)}};
  if(agent.deliversCode&&brief.workspacePath&&!contract.validators.includes("code-delivery"))contract.validators.push("code-delivery");
  const qaDepth=md.policy.qaDepth[mode.qa];
  if(contract.validators.includes("qa-traceability"))contract.params.minTestsPerRequirement=qaDepth.minTests;
  const reviewerAgent=agent.reviewedBy!=="none"?agents.find(a=>a.id===agent.reviewedBy&&a.mode==="reviewer"):undefined;
  const decision=reviewerAgent?reviewDecision(md.policy,brief.mode,risk):undefined;
  let review:PlannedReview|undefined;
  if(reviewerAgent&&decision){
   const makerSkillNames=new Set(picked.map(s=>s.name));
   // The reviewer sees only the specialist skills that matter for the work under review.
   const reviewSkills=selectSkills(dynamic,reviewerAgent.id,signals).filter(s=>makerSkillNames.has(s.name));
   const securityApplies=makerSkillNames.has("security")||brief.capabilities.includes("security-critical");
   const slots:PlannedReviewSlot[]=[];
   for(let k=0;k<decision.reviewers;k++){
    const lensName=k>=1&&decision.gates.includes("security")&&securityApplies?"security":agent.reviewLens;
    const lens=lensName?md.gates.lenses[lensName]:undefined;
    if(lensName&&!lens)throw new Error("Unknown review lens '"+lensName+"' for "+agent.id);
    const extra=[...reviewSkills.map(s=>s.body)];
    if(lens?.skill&&!reviewSkills.some(s=>s.name===lens.skill)){const skill=dynamic.find(s=>s.name===lens.skill);if(skill)extra.push(skill.body);}
    if(lens)extra.push("# Review lens: "+lensName+"\n\n"+lens.instruction+(lens.validator==="architecture-review"?"\n\nApplicable categories: "+architectureCategories.join(", ")+".":""));
    slots.push({lens:lensName,system:systemPromptFor(reviewerAgent,md.company,md.workflow,md.quality,md.contractText,extra),
     contract:{sections:[...md.contract.reviewerSections,...(lens?.sections??[])],verdict:true,validators:lens?.validator?[lens.validator]:[],params:{architectureCategories}}});
   }
   review={role:reviewerAgent.id,department:reviewerAgent.department,level:decision.level,reviewers:decision.reviewers,gates:decision.gates,system:slots[0].system,capabilities:reviewerAgent.modelCapabilities,contract:slots[0].contract,slots,skills:reviewSkills.map(s=>s.name)};
  }
  tasks.push({
   id:agent.id,department:agent.department,agentRole:agent.id,dependencies:[...deps],objective:brief.objective+"\n\nAssigned responsibility: "+agent.identity.split(/\r?\n/)[0]+(contract.validators.includes("qa-traceability")?"\n\n"+qaDepth.guidance:""),
   reviewer:review?.role,risk,system:systemPromptFor(agent,md.company,md.workflow,md.quality,md.contractText,skillBodies),produces:agent.produces,requires:agent.requires,
   capabilities:agent.modelCapabilities,contract,skills:picked.map(s=>s.name),requiredGates:agent.deliversCode?requiredGates:[],deliversCode:agent.deliversCode,review
  });
 }
 return {projectId:brief.projectId,departments,tasks,signals:signals.tags};
}

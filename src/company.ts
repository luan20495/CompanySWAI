export type Complexity=1|2|3|4|5;
export type Capability="backend"|"web-ui"|"mobile"|"deployment"|"security-critical"|"performance-critical";
export type ProjectProfile={capabilities:Capability[];complexity:Complexity;mobileSkills?:string[]};
export type AgentPlan={role:string;skills:string[]};
export type DepartmentPlan={name:string;agents:AgentPlan[];reviewDepth:number};

const has=(p:ProjectProfile,c:Capability)=>p.capabilities.includes(c);
const a=(role:string,skills:string[]=[]):AgentPlan=>({role,skills});

export function composeCompany(p:ProjectProfile):DepartmentPlan[]{
 const deep=p.complexity>=4;
 const plans:DepartmentPlan[]=[
  {name:"product",agents:[a("product-lead"),a("ba"),...(deep?[a("researcher"),a("product-critic")]:[])],reviewDepth:deep?2:1},
  {name:"architecture",agents:[a("tech-lead"),...(deep?[a("architect")]:[]),...(has(p,"security-critical")?[a("security-architect")]:[]),...(has(p,"performance-critical")?[a("performance-architect")]:[])],reviewDepth:has(p,"security-critical")||has(p,"performance-critical")?2:1}
 ];
 if(has(p,"backend")) plans.push({name:"backend",agents:[a("backend-lead"),a("backend-dev"),...(deep?[a("backend-dev"),a("data-specialist"),a("backend-reviewer")]:[])],reviewDepth:has(p,"security-critical")?2:1});
 if(has(p,"web-ui")){
  plans.push({name:"design",agents:[a("ux-designer"),a("ui-designer"),...(deep?[a("ux-researcher"),a("design-reviewer")]:[])],reviewDepth:2});
  plans.push({name:"frontend",agents:[a("frontend-architect"),a("frontend-dev"),...(deep?[a("frontend-dev"),a("frontend-reviewer"),a("performance-specialist")]:[])],reviewDepth:has(p,"performance-critical")?2:1});
 }
 if(has(p,"mobile")){
  const skills=p.mobileSkills??[];
  plans.push({name:"mobile",agents:[a("mobile-architect",skills),a("mobile-engineer",skills),...(deep||has(p,"performance-critical")?[a("android-native-specialist",["kotlin","android-platform"]),a("ios-native-specialist",["swift","ios-platform"]),a("mobile-reviewer",skills)]:[])],reviewDepth:deep?2:1});
 }
 if(has(p,"deployment")) plans.push({name:"platform",agents:[a("devops"),...(deep?[a("platform-architect"),a("sre")]:[]),...(has(p,"security-critical")?[a("platform-security-reviewer")]:[])],reviewDepth:has(p,"security-critical")?2:1});
 plans.push({name:"qa",agents:[a("qa-lead"),a("functional-api-qa"),...(deep?[a("automation-e2e-qa")]:[]),...(has(p,"security-critical")||has(p,"performance-critical")?[a("performance-security-qa")]:[])],reviewDepth:deep?2:1});
 return plans;
}

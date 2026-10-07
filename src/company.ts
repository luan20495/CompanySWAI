export type ProjectCapabilities={ui:boolean;backend:boolean;deployment:boolean;securityCritical:boolean;complexity:1|2|3|4|5};
export type DepartmentPlan={name:string;agents:string[];reviewDepth:number};

export function composeCompany(c:ProjectCapabilities):DepartmentPlan[]{
 const scale=(base:string[],extra:string[])=>c.complexity<=2?base:[...base,...extra];
 const p:DepartmentPlan[]=[
  {name:"product",agents:scale(["product-lead","ba"],["researcher","product-critic"]),reviewDepth:c.complexity>=4?2:1},
  {name:"architecture",agents:scale(["tech-lead"],["architect",...(c.securityCritical?["security-architect"]:[])]),reviewDepth:c.securityCritical?2:1},
  {name:"qa",agents:scale(["qa-lead","functional-api-qa"],["automation-e2e-qa",...(c.securityCritical?["performance-security-qa"]:[])]),reviewDepth:c.complexity>=4?2:1}
 ];
 if(c.backend)p.splice(2,0,{name:"backend",agents:scale(["backend-lead","backend-dev"],["backend-dev","data-specialist","backend-reviewer"]),reviewDepth:c.securityCritical?2:1});
 if(c.ui){
  p.splice(2,0,{name:"design",agents:scale(["ux-designer","ui-designer"],["ux-researcher","design-reviewer"]),reviewDepth:2});
  p.splice(3,0,{name:"frontend",agents:scale(["frontend-architect","frontend-dev"],["frontend-dev","frontend-reviewer","performance-specialist"]),reviewDepth:2});
 }
 if(c.deployment)p.splice(p.length-1,0,{name:"platform",agents:scale(["devops"],["platform-architect","sre",...(c.securityCritical?["platform-security-reviewer"]:[])]),reviewDepth:c.securityCritical?2:1});
 return p;
}

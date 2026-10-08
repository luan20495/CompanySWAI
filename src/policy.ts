import type {PolicyDefinition,QualityModeValue,ReviewLevelValue,Risk} from "./company.js";

export type ReviewDecision={level:ReviewLevelValue;reviewers:number;maxRounds:number;gates:string[]};

/** Whether a task of this risk is reviewed in this mode, and how thoroughly. Both tables come from company/POLICY.md. */
export function reviewDecision(policy:PolicyDefinition,mode:QualityModeValue,risk:Risk):ReviewDecision|undefined{
 const rules=policy.modes[mode];
 if(!rules)throw new Error("Unknown quality mode: "+mode);
 if(!rules.reviewRisks.includes(risk))return undefined;
 const level=rules.levelByRisk[risk]??"NORMAL",definition=policy.levels[level];
 if(!definition)throw new Error("Policy has no definition for review level "+level);
 return {level,reviewers:definition.reviewers,maxRounds:definition.maxRounds,gates:definition.gates};
}

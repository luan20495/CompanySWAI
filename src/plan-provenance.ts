import type {ProjectPlanValue} from "./project.js";
import {LESSONS_HEADER} from "./plan-compiler.js";

/**
 * Where a plan came from and whether it carried company lessons. A plan compiled from a brief gets lessons appended to its
 * system prompts; a plan supplied whole (for example by an external operator) bypasses the planner and gets none unless its
 * author added them. Counting is by the lessons header, so it works on plans persisted before provenance was recorded.
 */
export type PlanSource="brief"|"supplied-plan";

/** Number of system prompts (maker, review, review slots) that carry a lessons block. */
export function lessonsInjected(plan:Pick<ProjectPlanValue,"tasks">):number{
 let count=0;
 for(const task of plan.tasks){
  const systems=[task.system,task.review?.system,...(task.review?.slots??[]).map(s=>s.system)];
  for(const system of systems)if(system?.includes(LESSONS_HEADER))count++;
 }
 return count;
}

/**
 * Provenance of a run persisted before it was recorded explicitly. The autonomous pipeline stores `briefHash` as the hash of its
 * input: equal to the plan hash exactly when the input was the plan itself. A replanned or reprioritised run changes `planHash`
 * without changing its input, so a mismatch is only "probably compiled from a brief" — callers label it as derived.
 */
export function derivedPlanSource(run:{planHash:string;briefHash?:string}):PlanSource|"unknown"{
 if(!run.briefHash)return "unknown";
 return run.briefHash===run.planHash?"supplied-plan":"brief";
}

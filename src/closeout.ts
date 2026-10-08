import type {ProjectRunSummary} from "./orchestrator.js";
import type {ProjectPlanValue} from "./project.js";
import {buildRetrospective,renderRetrospective} from "./retrospective.js";
import type {CompanyState} from "./state.js";

/** End of every run (including parked ones): retrospective JSON + RETROSPECTIVE.md, then the validated learning loop. */
export async function closeProject(state:CompanyState,summary:ProjectRunSummary,options:{dryRun?:boolean;knownRoles?:string[];knownSkills?:string[];plan?:ProjectPlanValue}={}){
 const records=await state.executions.list(summary.projectId);
 const retrospective=await state.retrospectives.save(buildRetrospective(summary.projectId,records,{dryRun:options.dryRun,taskSkills:Object.fromEntries((options.plan?.tasks??[]).map(t=>[t.id,t.skills])),signals:options.plan?.signals}));
 await state.memory.writeRetrospective(summary.projectId,renderRetrospective(retrospective,summary,summary.budget));
 const experience=await state.experience.observe(retrospective,{knownRoles:options.knownRoles,knownSkills:options.knownSkills});
 return {retrospective,experience};
}

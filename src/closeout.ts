import type {ProjectRunSummary} from "./orchestrator.js";
import {buildRetrospective,renderRetrospective} from "./retrospective.js";
import type {CompanyState} from "./state.js";

/** End of every run (including parked ones): retrospective JSON + RETROSPECTIVE.md, then the validated learning loop. */
export async function closeProject(state:CompanyState,summary:ProjectRunSummary,options:{dryRun?:boolean;knownRoles?:string[]}={}){
 const records=await state.executions.list(summary.projectId);
 const retrospective=await state.retrospectives.save(buildRetrospective(summary.projectId,records,{dryRun:options.dryRun}));
 await state.memory.writeRetrospective(summary.projectId,renderRetrospective(retrospective,summary,summary.budget));
 const experience=await state.experience.observe(retrospective,{knownRoles:options.knownRoles});
 return {retrospective,experience};
}

import type {CompanyState} from "./state.js";
import {buildProjectStatus} from "./telemetry.js";

/** Everything an operator needs about a project in one object: live state, phase, final verdict, usage and problems. */
export async function projectStatusView(state:CompanyState,projectId:string,options:{isAlive?:(pid:number)=>boolean}={}){
 const [events,records,run,plan]=await Promise.all([state.telemetry.list(projectId),state.executions.list(projectId),state.runs.load(projectId),state.runs.loadPlan(projectId)]);
 const live=buildProjectStatus(projectId,events,records,{planTasks:plan?.tasks.map(t=>t.id),isAlive:options.isAlive});
 return {
  ...live,
  phase:run?.phase,completedPhases:run?.completedPhases??[],stopped:run?.stopped,final:run?.final,notes:run?.notes??[],
  mode:plan?.mode,plannedTasks:plan?.tasks.length,corruptLogLines:await state.executions.corruptLines(projectId)
 };
}

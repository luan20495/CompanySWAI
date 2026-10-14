import {CompanyState} from "./state.js";
import {noteIntervention} from "./intervention-log.js";

const raw=process.argv.slice(2),stateFlag=raw.indexOf("--state-dir");
const stateDir=stateFlag>=0?raw[stateFlag+1]:".companyswai";
const [projectId,taskId,costOrBy,maybeBy]=raw.filter((arg,i)=>arg!=="--state-dir"&&raw[i-1]!=="--state-dir");
if(!projectId||!taskId)throw new Error("Usage: npm run approve -- <projectId> <taskId> [estimatedCost] [approvedBy] [--state-dir .companyswai]");
const numeric=costOrBy!=null&&costOrBy!==""&&Number.isFinite(Number(costOrBy))?Number(costOrBy):undefined;
const approvedBy=numeric!=null?(maybeBy??"owner"):(costOrBy??"owner");
const state=new CompanyState(stateDir),approval=await state.approvals.approve(projectId,taskId,numeric,approvedBy);
await noteIntervention(state.interventions,{kind:"approval",projectId,taskId,actor:approval.approvedBy,via:"npm run approve",detail:"approved up to "+approval.estimatedCost.toFixed(6)});
await new CompanyState(stateDir).memory.recordStatus(projectId,taskId,"APPROVED","by "+approval.approvedBy+" up to "+approval.estimatedCost.toFixed(6)).catch(()=>undefined);
console.log(JSON.stringify(approval,null,2));

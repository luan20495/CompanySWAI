import {FileApprovalStore} from "./approval-store.js";
const [projectId,taskId,cost,approvedBy="owner"]=process.argv.slice(2);
if(!projectId||!taskId||!cost||!Number.isFinite(Number(cost)))throw new Error("Usage: npm run approve -- <projectId> <taskId> <estimatedCost> [approvedBy]");
console.log(JSON.stringify(await new FileApprovalStore().approve(projectId,taskId,Number(cost),approvedBy),null,2));

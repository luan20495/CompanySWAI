import {FileApprovalStore} from "./approval-store.js";
const [projectId,taskId,costOrBy,maybeBy]=process.argv.slice(2);
if(!projectId||!taskId)throw new Error("Usage: npm run approve -- <projectId> <taskId> [estimatedCost] [approvedBy]");
const numeric=costOrBy!=null&&costOrBy!==""&&Number.isFinite(Number(costOrBy))?Number(costOrBy):undefined;
const approvedBy=numeric!=null?(maybeBy??"owner"):(costOrBy??"owner");
console.log(JSON.stringify(await new FileApprovalStore().approve(projectId,taskId,numeric,approvedBy),null,2));

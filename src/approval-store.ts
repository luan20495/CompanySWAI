import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {writeFileAtomic} from "./fs-atomic.js";
import {z} from "zod";
import {SafeId} from "./ids.js";

export const ApprovalRequest=z.object({
 projectId:SafeId,taskId:SafeId,estimatedCost:z.number().nonnegative(),
 requestedAt:z.string().datetime(),status:z.enum(["PENDING","APPROVED"])
});
export const Approval=z.object({
 projectId:SafeId,taskId:SafeId,approvedAt:z.string().datetime(),approvedBy:z.string().min(1),estimatedCost:z.number().nonnegative()
});
export type ApprovalValue=z.infer<typeof Approval>;
export type ApprovalRequestValue=z.infer<typeof ApprovalRequest>;

export class FileApprovalStore{
 constructor(private root=".companyswai/approvals"){}
 private approvalPath(projectId:string,taskId:string){return join(this.root,SafeId.parse(projectId),SafeId.parse(taskId)+".json");}
 private requestPath(projectId:string,taskId:string){return join(this.root,SafeId.parse(projectId),SafeId.parse(taskId)+".request.json");}
 async request(projectId:string,taskId:string,estimatedCost:number){
  const existing=await this.loadRequest(projectId,taskId);
  if(existing&&existing.status==="PENDING"&&existing.estimatedCost>=estimatedCost)return existing;
  const value=ApprovalRequest.parse({projectId,taskId,estimatedCost,requestedAt:new Date().toISOString(),status:"PENDING"});
  await writeFileAtomic(this.requestPath(projectId,taskId),JSON.stringify(value,null,2));return value;
 }
 async approve(projectId:string,taskId:string,estimatedCost?:number,approvedBy="owner"){
  const request=await this.loadRequest(projectId,taskId),cost=estimatedCost??request?.estimatedCost;
  if(cost==null)throw new Error("No pending approval request and no estimated cost supplied");
  const value=Approval.parse({projectId,taskId,estimatedCost:cost,approvedBy,approvedAt:new Date().toISOString()});
  await writeFileAtomic(this.approvalPath(projectId,taskId),JSON.stringify(value,null,2));
  if(request){await writeFileAtomic(this.requestPath(projectId,taskId),JSON.stringify({...request,status:"APPROVED"},null,2));}
  return value;
 }
 async load(projectId:string,taskId:string){try{return Approval.parse(JSON.parse(await readFile(this.approvalPath(projectId,taskId),"utf8")));}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return undefined;throw error;}}
 async loadRequest(projectId:string,taskId:string){try{return ApprovalRequest.parse(JSON.parse(await readFile(this.requestPath(projectId,taskId),"utf8")));}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return undefined;throw error;}}
 async covers(projectId:string,taskId:string,estimatedCost:number){const approval=await this.load(projectId,taskId);return Boolean(approval&&approval.estimatedCost>=estimatedCost);}
}

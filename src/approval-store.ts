import {mkdir,readFile,writeFile} from "node:fs/promises";
import {dirname,join} from "node:path";
import {z} from "zod";

export const Approval=z.object({
 projectId:z.string().min(1),taskId:z.string().min(1),
 approvedAt:z.string().datetime(),approvedBy:z.string().min(1),
 estimatedCost:z.number().nonnegative()
});
export type ApprovalValue=z.infer<typeof Approval>;

export class FileApprovalStore{
 constructor(private root=".companyswai/approvals"){}
 private path(projectId:string,taskId:string){return join(this.root,projectId,taskId+".json");}
 async approve(projectId:string,taskId:string,estimatedCost:number,approvedBy="owner"){
  const value=Approval.parse({projectId,taskId,estimatedCost,approvedBy,approvedAt:new Date().toISOString()});
  const path=this.path(projectId,taskId);await mkdir(dirname(path),{recursive:true});
  await writeFile(path,JSON.stringify(value,null,2),"utf8");return value;
 }
 async load(projectId:string,taskId:string){
  try{return Approval.parse(JSON.parse(await readFile(this.path(projectId,taskId),"utf8")));}
  catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return undefined;throw error;}
 }
 async covers(projectId:string,taskId:string,estimatedCost:number){
  const approval=await this.load(projectId,taskId);
  return Boolean(approval&&approval.estimatedCost>=estimatedCost);
 }
}

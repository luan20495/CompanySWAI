import {z} from "zod";
import {readFile} from "node:fs/promises";

export const ProjectPlan=z.object({
 projectId:z.string().min(1),
 tasks:z.array(z.object({
  id:z.string().min(1),agentRole:z.string().min(1),dependencies:z.array(z.string()).default([]),
  system:z.string().min(1),prompt:z.string().min(1),inputRefs:z.array(z.string()).default([]),
  maxTokens:z.number().int().positive().default(4096),
  provider:z.string().min(1),model:z.string().min(1)
 })).min(1)
});
export type ProjectPlanValue=z.infer<typeof ProjectPlan>;
export async function loadProjectPlan(path:string){
 return ProjectPlan.parse(JSON.parse(await readFile(path,"utf8")));
}

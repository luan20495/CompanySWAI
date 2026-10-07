import {z} from "zod";
import {readFile} from "node:fs/promises";
import {SafeId} from "./ids.js";

const ReviewPlan=z.object({
 role:z.string().min(1),
 system:z.string().min(1),
 provider:z.string().min(1),
 model:z.string().min(1),
 maxTokens:z.number().int().positive().default(2048),
 maxRounds:z.number().int().min(1).max(5).default(2)
});

export const ProjectPlan=z.object({
 projectId:SafeId,
 tasks:z.array(z.object({
  id:SafeId,
  agentRole:z.string().min(1),
  dependencies:z.array(SafeId).default([]),
  system:z.string().min(1),
  prompt:z.string().min(1),
  inputRefs:z.array(z.string()).default([]),
  maxTokens:z.number().int().positive().default(4096),
  provider:z.string().min(1),
  model:z.string().min(1),
  review:ReviewPlan.optional()
 })).min(1)
});

export type ProjectPlanValue=z.infer<typeof ProjectPlan>;

export async function loadProjectPlan(path:string){
 return ProjectPlan.parse(JSON.parse(await readFile(path,"utf8")));
}

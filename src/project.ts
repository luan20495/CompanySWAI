import {z} from "zod";
import {readFile} from "node:fs/promises";
import {SafeId} from "./ids.js";

const Selection=z.object({provider:z.string().min(1).optional(),model:z.string().min(1).optional(),capabilities:z.array(z.string().min(1)).default([]),estimatedInputTokens:z.number().int().nonnegative().default(2000),estimatedOutputTokens:z.number().int().nonnegative().default(2000),maxCost:z.number().nonnegative().optional(),minContextWindow:z.number().int().positive().optional()}).refine(value=>Boolean(value.provider)===Boolean(value.model),{message:"provider and model must be supplied together"});
const ReviewPlan=Selection.and(z.object({role:z.string().min(1),system:z.string().min(1),maxTokens:z.number().int().positive().default(2048),maxRounds:z.number().int().min(1).max(5).default(2)}));
const TaskPlan=Selection.and(z.object({id:SafeId,agentRole:z.string().min(1),dependencies:z.array(SafeId).default([]),system:z.string().min(1),prompt:z.string().min(1),inputRefs:z.array(z.string()).default([]),maxTokens:z.number().int().positive().default(4096),review:ReviewPlan.optional()}));
const CheckCommand=z.object({cmd:z.string().regex(/^[A-Za-z0-9._-]+$/),args:z.array(z.string()).default([])});
export const ProjectPlan=z.object({
 projectId:SafeId,
 budget:z.object({maxProjectCost:z.number().nonnegative().optional(),maxTaskCost:z.number().nonnegative().optional(),approvalThreshold:z.number().nonnegative().optional()}).default({}),
 workspace:z.object({path:z.string().min(1),checks:z.array(CheckCommand).default([]),autoCommit:z.boolean().default(false)}).optional(),
 tasks:z.array(TaskPlan).min(1)
});
export type ProjectPlanValue=z.infer<typeof ProjectPlan>;
export async function loadProjectPlan(path:string){return ProjectPlan.parse(JSON.parse(await readFile(path,"utf8")));}

import {z} from "zod";
import {SafeId} from "./ids.js";

export const ExecutionRecord=z.object({
 id:z.string(),projectId:SafeId,taskId:SafeId,agentRole:z.string(),department:z.string().default("general"),provider:z.string(),model:z.string(),
 status:z.enum(["STARTED","CHECKPOINTED","SUCCEEDED","FAILED","PAUSED_CAPACITY"]),
 startedAt:z.string(),finishedAt:z.string().optional(),inputRefs:z.array(z.string()).default([]),output:z.string().default(""),
 artifactRefs:z.array(z.string()).default([]),decisionRefs:z.array(z.string()).default([]),reviewRefs:z.array(z.string()).default([]),blockerRefs:z.array(z.string()).default([]),
 inputTokens:z.number().int().nonnegative().default(0),outputTokens:z.number().int().nonnegative().default(0),estimatedCost:z.number().nonnegative().optional(),actualCost:z.number().nonnegative().optional(),
 billing:z.enum(["metered","subscription"]).default("metered"),changedFiles:z.array(z.string()).default([]),commitSha:z.string().optional(),evidence:z.array(z.string()).default([]),error:z.string().optional()
});
export type ExecutionRecordValue=z.infer<typeof ExecutionRecord>;

import {z} from "zod";
import {SafeId} from "./ids.js";

export const TaskStatus=z.enum(["READY","DOING","REVIEW","BLOCKED","PAUSED_CAPACITY","DONE"]);
export const TaskContract=z.object({
 id:SafeId,projectId:SafeId,department:z.string(),role:z.string(),skills:z.array(z.string()).default([]),
 objective:z.string().min(10),contextRefs:z.array(z.string()).default([]),dependencies:z.array(SafeId).default([]),
 deliverables:z.array(z.string()).min(1),acceptanceCriteria:z.array(z.string()).min(1),
 risk:z.enum(["low","medium","high","critical"]),status:TaskStatus,
 reviewer:z.string().optional(),approver:z.string().optional(),
 estimatedInputTokens:z.number().int().nonnegative().optional(),estimatedOutputTokens:z.number().int().nonnegative().optional()
});
export const Review=z.object({taskId:SafeId,reviewer:z.string(),verdict:z.enum(["PASS","CHANGES_REQUIRED","BLOCKED"]),findings:z.array(z.string()),evidence:z.array(z.string()),requiredChanges:z.array(z.string())});
export const Checkpoint=z.object({taskId:SafeId,at:z.string(),status:TaskStatus,completed:z.array(z.string()),remaining:z.array(z.string()),artifactRefs:z.array(z.string()),decisionRefs:z.array(z.string()),compactContext:z.string(),provider:z.string().optional(),model:z.string().optional(),inputTokens:z.number().int().nonnegative().default(0),outputTokens:z.number().int().nonnegative().default(0)});
export const ExperienceCandidate=z.object({pattern:z.string(),scope:z.string(),evidence:z.array(z.string()).min(1),projectsObserved:z.number().int().positive(),proposedBy:z.string(),reviewedBy:z.string().optional(),status:z.enum(["CANDIDATE","VALIDATED","REJECTED"])});

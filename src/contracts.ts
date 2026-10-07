import {z} from "zod";

export const TaskContract=z.object({
 id:z.string(),projectId:z.string(),department:z.string(),role:z.string(),
 objective:z.string().min(10),context:z.array(z.string()),dependencies:z.array(z.string()),
 deliverables:z.array(z.string()).min(1),acceptanceCriteria:z.array(z.string()).min(1),
 risk:z.enum(["low","medium","high","critical"]),status:z.enum(["READY","DOING","REVIEW","BLOCKED","DONE"]),
 reviewer:z.string().optional(),approver:z.string().optional()
});

export const Review=z.object({
 taskId:z.string(),reviewer:z.string(),verdict:z.enum(["PASS","CHANGES_REQUIRED","BLOCKED"]),
 findings:z.array(z.string()),evidence:z.array(z.string()),requiredChanges:z.array(z.string())
});

export const ExperienceCandidate=z.object({
 pattern:z.string(),scope:z.string(),evidence:z.array(z.string()).min(1),
 projectsObserved:z.number().int().positive(),proposedBy:z.string(),reviewedBy:z.string().optional(),
 status:z.enum(["CANDIDATE","VALIDATED","REJECTED"])
});

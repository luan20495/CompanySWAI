import {z} from "zod";
import {SafeId} from "./ids.js";
import {QualityMode,ReviewLevel,RoutingPolicy} from "./company.js";

const Selection=z.object({
 provider:z.string().min(1).optional(),
 model:z.string().min(1).optional(),
 capabilities:z.array(z.string().min(1)).default([]),
 estimatedInputTokens:z.number().int().nonnegative().default(2000),
 estimatedOutputTokens:z.number().int().nonnegative().default(2000),
 maxCost:z.number().nonnegative().optional(),
 minContextWindow:z.number().int().positive().optional(),
 routing:RoutingPolicy.optional(),
 minQualityTier:z.number().int().min(1).max(5).optional()
}).refine(value=>Boolean(value.provider)===Boolean(value.model),{message:"provider and model must be supplied together"});

/** What an agent's answer must satisfy. `validators` name deterministic checks implemented by the runtime; `params` configure them. */
export const Contract=z.object({
 sections:z.array(z.string().min(1)).default([]),verdict:z.boolean().default(false),
 validators:z.array(z.string().min(1)).default([]),params:z.record(z.string(),z.unknown()).default({})
});
const ReviewSlot=z.object({lens:z.string().optional(),system:z.string().min(1),contract:Contract});
const Risk=z.enum(["low","medium","high","critical"]);

const ReviewPlan=Selection.and(z.object({
 role:z.string().min(1),
 department:z.string().min(1).default("quality"),
 system:z.string().min(1),
 maxTokens:z.number().int().positive().default(2048),
 maxRounds:z.number().int().min(1).max(5).default(2),
 contract:Contract.default({sections:[],verdict:true,validators:[],params:{}}),
 level:ReviewLevel.default("NORMAL"),
 /** Gates (checks, qa, security) that must hold before the reviewed work counts as accepted. */
 gates:z.array(z.string()).default([]),
 /** One entry per independent reviewer; empty means a single reviewer using system/contract above. */
 slots:z.array(ReviewSlot).default([])
}));

const TaskPlan=Selection.and(z.object({
 id:SafeId,
 agentRole:z.string().min(1),
 department:z.string().min(1).default("general"),
 dependencies:z.array(SafeId).default([]),
 system:z.string().min(1),
 prompt:z.string().min(1),
 inputRefs:z.array(z.string()).default([]),
 produces:z.array(z.string()).default([]),
 risk:Risk.default("medium"),
 /** Names of the dynamic specialist skills injected into this task's system prompt. */
 skills:z.array(z.string()).default([]),
 /** Code gates this task must pass when it delivers code. */
 requiredGates:z.array(z.string()).default([]),
 /** Higher runs first among ready tasks; aging prevents starvation of low priorities. */
 priority:z.number().default(0),
 contract:Contract.default({sections:[],verdict:false,validators:[],params:{}}),
 maxTokens:z.number().int().positive().default(4096),
 review:ReviewPlan.optional()
}));

export const CheckCommand=z.object({cmd:z.string().regex(/^[A-Za-z0-9._-]+$/),args:z.array(z.string()).default([]),timeoutMs:z.number().int().positive().optional()});
export const WorkspaceSchema=z.object({
 path:z.string().min(1),
 /** The `project-checks` gate: deterministic commands that must pass for any code change. */
 checks:z.array(CheckCommand).default([]),
 /** Named code gates (typecheck, unit-tests, integration-tests, lint, build, security): each a list of commands. */
 gates:z.record(z.string(),z.array(CheckCommand)).default({}),
 /** Commands run once inside a fresh isolated worktree before its gates (for example dependency installation). */
 setup:z.array(CheckCommand).default([]),
 autoCommit:z.boolean().default(false),
 /** `worktree`: every coding task works in its own git worktree and is integrated after its gates pass. */
 isolation:z.enum(["none","worktree"]).default("none")
}).refine(w=>w.isolation==="none"||w.autoCommit,{message:"worktree isolation requires autoCommit (accepted work is integrated as a commit)"});

export const BudgetPolicyObject=z.object({
 maxProjectCost:z.number().nonnegative().optional(),
 maxTaskCost:z.number().nonnegative().optional(),
 maxTeamCost:z.record(z.string(),z.number().nonnegative()).default({}),
 maxAgentCost:z.record(z.string(),z.number().nonnegative()).default({}),
 approvalThreshold:z.number().nonnegative().optional(),
 /** Estimated whole-project cost above which the autonomous pipeline stops for a persisted approval. */
 projectApprovalThreshold:z.number().nonnegative().optional()
});
export const BudgetPolicySchema=BudgetPolicyObject.default({maxTeamCost:{},maxAgentCost:{}});

export const ResearchSettings=z.object({
 /** When enabled, FACT claims in research artifacts must cite external sources (URL, retrieval date, authority). */
 enabled:z.boolean().default(false),maxSourceAgeDays:z.number().int().positive().default(730)
});

export const ProjectPlan=z.object({
 projectId:SafeId,
 mode:QualityMode.default("BALANCED"),
 budget:BudgetPolicySchema,
 workspace:WorkspaceSchema.optional(),
 research:ResearchSettings.default({enabled:false,maxSourceAgeDays:730}),
 /** Project signal tags (for example "android", "postgres", "brownfield") used for skill and gate selection. */
 signals:z.array(z.string()).default([]),
 tasks:z.array(TaskPlan).min(1)
});
export type ProjectPlanValue=z.infer<typeof ProjectPlan>;
export type ProjectPlanInput=z.input<typeof ProjectPlan>;
export type TaskPlanValue=ProjectPlanValue["tasks"][number];

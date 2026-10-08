# Orchestration

## Isolation
Each model call is built from scratch (`src/context.ts`): a maker gets its task plus the declared upstream sections (bounded, never evidence/handoff chatter); a reviewer gets requirements, the complete artifact under review (all contract sections, large cap), the upstream context the author saw and the runtime's deterministic test evidence. Maker reasoning, system prompts and conversations are never shared, reviewers do not see each other, and `claude-code` runs one process per call. `contextRefs` on every execution record prove what was passed.

## Scheduler
Event-driven DAG: a task starts the moment its dependencies are done and a project slot is free (`maxParallelTasks`). Priority is critical-path weight plus aging (no starvation). Provider selection happens at dispatch time with `requireFreeSlot`: if every eligible provider is at its concurrency limit the task waits for a completion event (backpressure; whichever provider frees first takes it — work stealing); if the eligible ones are rate-limited it waits for their cooldown (bounded by `maxCooldownWaitMs`, then PAUSED_CAPACITY). Only provider failures are retried (bounded); model output that violates the contract is repaired once; nothing is ever re-run after it succeeded.

## Durable state machine
The execution log (`.companyswai/executions/<project>/records.jsonl`) is the single source of truth. A task's position is derived from it on every step:

| Log says | Resume does |
|---|---|
| maker + passing review(s) from every slot | skip |
| maker succeeded, reviews missing | run only the missing review slots |
| any review `CHANGES_REQUIRED` | revise (never regenerate the first draft); splits are recorded as disagreements |
| paid response recorded (`CHECKPOINTED`) but not finalized | finalize it without a second model call |
| `PAUSED_CAPACITY` / no success | run again when capacity exists |
| approval pending | wait (`--wait-approval`) or exit; rerun after `npm run approve` |

Torn log lines and corrupt checkpoints are quarantined; JSON state is written atomically. A failing task is isolated: it is recorded in `BLOCKERS.md`/`STATUS.md`, independent tasks still finish and dependents wait.

## Review levels and quality modes
`company/POLICY.md` maps risk to a review level per mode. NORMAL: one reviewer. CRITICAL: two independent reviewers; both must PASS. HIGH_RISK: two reviewers (second with the security lens where applicable), passing deterministic gates, and a passing QA gate at project level. FAST reviews only high/critical work with the cheapest eligible provider; BALANCED reviews everything and double-reviews critical work; MAX_QUALITY routes quality-first and escalates review levels.

## Budget
Limits per project, department, task (reviews count toward the task they review) and agent; reserved while a call is in flight so parallel tasks cannot jointly overspend. A profile without prices fails closed when limits are configured. Subscription-billed profiles (`claude-code`) have no per-token price: they are excluded from money limits, shown as subscription in estimates, records and `RETROSPECTIVE.md`. Above `approvalThreshold` a task needs a persisted approval; above `projectApprovalThreshold` the whole project does. An estimate (which includes independent reviews) that exceeds the budget stops the run before any model call.

## Repo workspace
Patches are confined to the workspace (no absolute paths, traversal, `.git`, symlink escapes, credential-shaped content), applied transactionally, verified by the required gates (run without provider credentials, with timeouts) and rolled back on any failure. A required gate that is not configured fails the task. With `isolation: worktree` each coding task runs in its own detached worktree, integrates serialised and conflict-checked (a conflict is aborted cleanly and the task is re-asked once against the new repository state), and the merged tree is re-verified and reverted if it fails. Execution records carry changed files, commit SHA, gate results and evidence.

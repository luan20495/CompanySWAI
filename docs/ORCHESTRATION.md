# Orchestration

- Minimum sufficient context: each agent gets its identity, rules, declared skills, the output contract and the handoff sections (`Deliverables`, `Decisions`, `Blockers`, `Handoff`, bounded in size) of its dependencies — not whole transcripts.
- Work is ordered by produced/required artifacts and runs in parallel waves.
- Routing is by capability, cost and capacity across provider profiles; each profile has its own `maxConcurrency`; saturated profiles spill to free ones.
- Review depth scales with risk; reviewers never review their own role's work.

## Durable state machine
The execution log (`.companyswai/executions/<project>/records.jsonl`) is the single source of truth for progress. A task's position is derived from it on every step, so resume needs no special mode:

| Log says | Resume does |
|---|---|
| maker + passing review | skip |
| maker succeeded, no review after it | run the review only |
| last review `CHANGES_REQUIRED` | revise (never regenerate the first draft) |
| paid response recorded (`CHECKPOINTED`) but not finalized | finalize it without a second model call |
| `PAUSED_CAPACITY` / no success | run again when capacity exists |
| approval pending | wait (`--wait-approval`) or exit; rerun after `npm run approve` |

A failing task (rejected patch, failed check, contract violation after repair, exhausted review rounds, budget) is isolated: it is recorded in `BLOCKERS.md`/`STATUS.md` and independent tasks still finish; its dependents wait.

## Budget
Subscription-billed profiles (`claude-code`) have no per-token price: they are excluded from money limits and approvals, shown as subscription in estimates, execution records and `RETROSPECTIVE.md`.

Limits exist per project, department, task (reviews count toward the task they review) and agent. Cost estimates reserve budget while a call is in flight, so parallel tasks cannot jointly overspend. A profile without prices fails closed when limits are configured. Above `approvalThreshold` a task needs a persisted approval. `RETROSPECTIVE.md` and the run summary compare estimate with actual at every level.

## Repo workspace
Optional `workspacePath`: agent ```` ```file path ```` blocks are confined to it (no absolute paths, traversal, `.git`, symlink escapes, credential-shaped content), applied transactionally, verified by the configured checks (run without provider credentials, with timeouts), rolled back on any failure, and optionally committed — only the patched paths, never over uncommitted local edits. Execution records carry changed files, commit SHA and check evidence.

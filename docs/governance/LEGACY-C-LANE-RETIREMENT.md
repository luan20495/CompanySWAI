# Retire C0–C7 coordination safely — migration contract

**Decision:** As of 2026-10-14, C0–C7 are **RETIRED as a model for NEW assignment and decision routing**. CompanySWAI is the only future orchestration owner, using the 11 native roles listed in `agents/AGENTS.md`. The old C-numbered labels are not permanent CompanySWAI roles.

**Important distinction:** Logical retirement can take effect immediately; physical deletion of live Mac worktrees/processes/branches/files must wait for a completed dependency audit. This file does **not** claim any HBLXWeb worktree or running service has already been removed.

## Migration map — responsibilities, not 1:1 permanent replacements

| Old lane | Function to preserve | CompanySWAI role/workflow for NEW tasks |
| --- | --- | --- |
| C0 | integration, architecture, cross-module contracts | `tech-lead` + `devops-sre`; project DAG dependencies, review and safe integration gate |
| C1 | auth, identity, tenant permissions, security | `backend-engineer` + independent `reviewer`, `qa-engineer` |
| C2 | build, publish, deploy, rollback | `backend-engineer` + `devops-sre` + independent release gate |
| C3 | data API, connectors, persistence | `backend-engineer`, `tech-lead`, `researcher` if external contracts need evidence |
| C4 | durable action/workflow | `backend-engineer`, `tech-lead`, independent reviewer and QA |
| C5 | frontend, Studio, UX, browser | `frontend-engineer` + `ux-ui-designer`, `qa-engineer` |
| C6 | regression, QA, E2E, performance | independent `qa-engineer`, `reviewer`; executed external gates |
| C7 / coordination aliases | management, integration or any extra integration lane | classify actual function from evidence; map to `product-lead`, `business-analyst`, `tech-lead`, `devops-sre` as needed rather than assuming a new fixed role |

No 1:1 lane recreation, no permanent `c1-backend` role, no new fixed C-named worktree or Claude session. Staffing should follow tasks, risk and measured provider capacity; no artificial assignment count.

## Mandatory pre-cleanup gate — harvest the C0–C7 experience FIRST

**Owner addendum (2026-10-14):** The C-lane team's historical engineering work is a valuable knowledge source. **DO NOT physically delete, prune or overwrite legacy agent instructions, source branches, worktrees, handoff records, QA/incident evidence or learning material until BOTH `KNOWLEDGE_HARVEST=PASS` and `DEPENDENCY_MIGRATION=PASS` are independently reviewed.** New C-lane assignment remains retired immediately, but material and operational state are retained until migration is proven safe. Dedicated requirements and acceptance: https://github.com/luan20495/CompanySWAI/issues/18.

Capture domain-specific lessons from each lane C0–C7: successes **and failures**, root causes, accepted solutions and evidence, review/correction loops, safety/performance/QA patterns, dynamic tools and skill ideas. Classify as proven reusable, promising unverified, context-specific, unsafe/obsolete or already covered. Compare against the CURRENT 11 CompanySWAI native roles, permanent/dynamic skills, and deterministic checks; select the smallest nonduplicating destinations (role rules / skill / review gate / validator / operational playbook). **Do not mechanically paste legacy prompts or retain fixed C-numbered teams under different names.** Static and historical audit first; no token-heavy 11-role live benchmark now.

**Private/public boundary:** The legacy HBLXWeb repository and local operational records are private, but CompanySWAI is public. Preserve all exact source references, full materials, customer/project details, environment information and evidence in an authorized PRIVATE location; the public CompanySWAI PR receives only a scrubbed, reusable lesson/skill decision matrix. Never copy raw private docs, internal logs, secrets, access details or security findings into the public repo. Confirm source licences and provenance.

**Proof gate before ANY physical cleanup:** (1) all 8 lanes inventoried and evidence preserved privately, (2) accepted/deferred/rejected candidate ledger completed, (3) high-value patterns mapped to CompanySWAI roles/skills/gates and sanitized proposals reviewed, (4) backup/restore and live-dependency inventory verified, (5) independent `[CHATGPT-KNOWLEDGE-REVIEW]` PASS, (6) migration-specific review/QA and rollback PASS. If any evidence is missing, mark `UNKNOWN/BLOCKED` and retain it, rather than guessing or destroying a source. This gate applies before the existing class-A/B cleanup steps below.

## Four classes to inventory before deletion

| Class | What it includes | Allowed handling |
| --- | --- | --- |
| A — obsolete instructions | C-lane role prompts, old handoff docs, duplicate task routing with no active reference | Replace with CompanySWAI role/DAG process on a feature branch; keep link or superseded notice for audit |
| B — operational dependencies | active worktrees, unmerged commits, CI entrypoints, dev scripts, running agents, databases, containers, configs, ports, local state | **STOP/AUDIT** until dependency and safe replacement are demonstrated; no forced kill, resets, deletes or worktree removal |
| C — historical evidence | commits, reviews, QA logs, old closed issues, release evidence and delivery artifacts | RETAIN read-only; mark superseded; never rewrite Git history |
| D — unrelated name collisions | other uses of C0, C1, C2 etc unrelated to coordination | Leave intact |

## Required staged cleanup on the OWNER'S MAC DEV

0. **Scope:** inventory only CompanySWAI orchestration and previously approved C-lane coordination. Do not modify application source, migrations, HBLXWeb run state, Mac PROD/Windows, other services or accounts as an incidental cleanup.
1. **Snapshot:** collect git branch/worktree status, exact SHA, dirty/untracked entries, upstream and open PR refs, process tree, scripts/hooks/schedulers, ports/services and state paths. Sanitize publicly posted evidence. Identify active vs abandoned ownership.
2. **Map dependencies:** for every C-named script, worktree, process, branch or file, classify A/B/C/D, who consumes it, and the consequence if removed; identify a replacement by the CompanySWAI task DAG/agent registry before changing it.
3. **Freeze new use:** all future handoffs go through CompanySWAI's 11 roles and task IDs. Existing live tasks either finish or checkpoint safely; don't orphan them, rewrite their ownership records, or start competing engines.
4. **Plan replacement:** implement changes only on `feature/retire-c-lane-routing` (branched from current `dev`), with PR into `dev`. Require impact report `LEGACY_C_LANE_IMPACT_AUDIT.md`, explicit migration tasks, test plan, rollback, expected owner actions and affected paths. For changes to other application repositories, open separate owner-approved scoped PRs there; CompanySWAI changes do not authorize mutation of every repo.
5. **Physical cleanup last:** only proven A items are archived/replaced; B items must first become inactive, clean, backed up and no longer required. Use safe `git worktree remove` when warranted, not `rm -rf` across live paths. Keep C historical records, D untouched. No deletion of remote branches with open PRs, unmerged commits or active references.
6. **Release gate:** QA/review of routing and restore/migration scenarios, verify no data loss and no work disruption, and confirm the sole CompanySWAI orchestration path works before retiring remaining B dependencies. Report each item DONE/DEFERRED/BLOCKED with exact evidence; no guess-based COMPLETE.

## Success condition

- No **new** task uses a C-numbered team or coordination file.
- Every live dependency formerly routed via C lanes either safely migrated or explicitly quarantined as a tracked blocker, with no data/work loss.
- Exactly the 11 native roles remain the role registry; dynamic task/team composition instead of eight hardwired owner sessions.
- No destructive change touched application features, production, migrations, historical evidence or unrelated repositories.
- Owner can see what was removed and what was preserved, with file/commit/process-specific proof, on Issue #13.

**Current state:** POLICY_RETIRED_FOR_NEW_WORK; PHYSICAL_CLEANUP=NOT_VERIFIED; ISSUE #13=OPEN. These must not be conflated.

Tracking: https://github.com/luan20495/CompanySWAI/issues/13

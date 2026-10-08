# CompanySWAI

A local, **MD-first autonomous software company**. Markdown defines the company: 11 permanent agents, their rules and skills, the output contract, review/quality policy, gates and learning rules. TypeScript is only the engine — parsing, validation, scheduling, provider routing, budget, checkpoints, resume, review, persistence and repo operations.

## What is defined in Markdown
| Path | Defines |
|---|---|
| `agents/AGENTS.md`, `agents/<agent>/{IDENTITY,RULES}.md` | the 11 agents: role, activation, skills, provider capabilities, artifacts, reviewer, output validators |
| `skills/*.md` | permanent skills, loaded only into agents that declare them |
| `skills/dynamic/*.md` | 15 specialist skills (security, performance, accessibility, database, distributed-systems, mobile-native, android, ios, flutter, frontend-performance, backend-reliability, devops, observability, testing, ux-research) injected only when task signals require them |
| `company/COMPANY.md`, `WORKFLOW.md`, `QUALITY-GATES.md` | principles, workflow, gate prose |
| `company/OUTPUT-CONTRACT.md`, `MEMORY.md` | the structured output contract; where outputs land in project memory |
| `company/POLICY.md` | quality modes (FAST / BALANCED / MAX_QUALITY) and review levels (NORMAL / CRITICAL / HIGH_RISK) |
| `company/GATES.md` | code gates, architecture review categories, review lenses, QA statuses |
| `company/LEARNING.md` | when a lesson may become company experience |

See `docs/MD-ARCHITECTURE.md`.

## Quick start
```bash
npm ci
npm run check      # typecheck + tests (incl. failure injection and the benchmark)
npm run doctor     # structural + secret checks of the Markdown company and config
npm run company -- examples/project-brief.json --dry-run     # deterministic end-to-end run, no API key
npm run benchmark                                            # deterministic benchmark project with metrics
```

## Autonomous project mode
`npm run company` (alias `npm run autonomous`) runs one brief to the end:

`PLAN → ESTIMATE → APPROVAL → EXECUTE → FINALIZE → RETROSPECTIVE`

Research, requirements, architecture (with an architecture review gate), decomposition, implementation, independent review, revision, QA, deterministic gates and repo integration are the plan's tasks and run inside EXECUTE. Each phase is persisted; the plan is persisted at PLAN time. Re-running the same command resumes after a crash at any point without repeating successful work. A changed brief is refused unless `--replan` is given.

Flags: `--dry-run`, `--runtime <file>`, `--state-dir <dir>` (default `.companyswai`), `--wait-approval[=seconds]`, `--replan`, `--max-parallel N`, `--supervise[=minutes]` (unattended: while the run is only parked for provider capacity, wait with exponential backoff and resume; failures, QA outcomes and approvals are returned to a person, never retried blindly).
Exit codes: `0` accepted (`ACCEPTED` or `ACCEPTED_WITH_RISKS`), `1` failed (`FAILED`, `FAILED_QA`, `BLOCKED`, `INCOMPLETE`), `2` parked (capacity, approval or blocked work — fix and rerun), `3` brief changed (use `--replan`).

Briefs choose a **quality mode** (`FAST`, `BALANCED`, default, `MAX_QUALITY`), `signals` (tags such as `android`, `postgres`, `brownfield` that activate skills/gates), `research` (see below) and optionally a code workspace. `examples/project-brief.json` and `benchmarks/commerce-brief.json` are complete examples.

## Real runs and providers
1. `cp config/providers.example.json config/providers.json` (git-ignored) and edit.
2. `npm run company -- examples/project-brief.json --runtime config/providers.json`

Provider kinds: `claude-code` (your signed-in Claude Code subscription), `anthropic`, `openrouter`, `openai-compatible`, plus any kind you register with `ProviderRegistry` — the orchestrator never changes. Each profile can set `qualityTier` (1–5), `locality`, `maxConcurrency`, prices (metered kinds); top-level `routing.policy` is `QUALITY_FIRST`, `BALANCED` (default), `COST_FIRST` or `LOCAL_FIRST`. Routing weighs capability, quality tier, availability, context window, estimated and observed latency, cost, concurrency, rate-limit cooldowns and recent failure rate (rolling health score). A quality tier nobody meets degrades to the best available and is recorded as a shortfall.

### Claude Code subscription (`claude-code`)
```json
{"providers":[{"id":"claude-code-team","provider":"claude-code","model":"sonnet","capabilities":["reasoning","product","architecture","coding","design","deployment","testing","review"],"contextWindow":200000,"maxConcurrency":1}]}
```
Every model call is a separate `claude -p` process (prompt on stdin, no shell, no tools, empty scratch directory, session persistence off, timeout and cancellation supported). Authentication stays with the Claude CLI: nothing reads tokens from disk, and `ANTHROPIC_API_KEY`/cloud switches are stripped from the child environment so the subscription is used. `model` is a CLI alias (`sonnet`, `opus`, …) or `default`; no version is hard-coded and the model that actually answered is recorded. The profile is used only when `claude --version` and `claude auth status` succeed. It is subscription billed: cost shows as *subscription / n/a* (never $0), prices are rejected on this kind and money budgets do not apply; Anthropic's usage limits surface as rate-limit errors and trigger cooldown/failover/pause.

## Agent isolation and review
Every execution is a fresh request (a fresh process for `claude-code`): only a system prompt and a prompt built for that step reach the model. Makers receive the declared upstream sections only. Reviewers receive the task requirements, the complete artifact (every section of the output contract, Evidence and Handoff included), the upstream context the author was given and the runtime's deterministic test evidence — never the maker's system prompt, reasoning/scratch text outside the contract sections or conversation, and never another reviewer's findings. Execution records list exactly what context each step was built from (`contextRefs`).

Review levels (`company/POLICY.md`): **NORMAL** one reviewer; **CRITICAL** two independent reviewers, both must PASS, a split is recorded as a disagreement and reconciled by revision; **HIGH_RISK** two reviewers (the second with the security lens where it applies), passing deterministic checks, and a passing QA gate before the project can be accepted.

## Contract, validators, traceability
Every output follows `company/OUTPUT-CONTRACT.md` (Deliverables, Decisions, Evidence, Blockers, Handoff; reviewers start with `PASS`/`CHANGES_REQUIRED`). Agents add deterministic validators in their `RULES.md`; a violation is sent back once for repair, then fails the attempt:
- **research-evidence** — sources (URL, title, retrieval date, authority, freshness), claims labelled FACT / ASSUMPTION / INFERENCE / RECOMMENDATION, FACTs must cite, conflicting facts must be acknowledged, citations persist. Pluggable **research connectors** (`static` corpus, `http-json`, custom kinds) retrieve documents *before* the research task; only retrieved sources may be cited, so no URL comes from model memory.
- **requirements-ids** — `REQ-n` with a basis label and testable `AC-n.m` criteria.
- **qa-traceability** — every requirement traced to tests classified `PASS` / `FAIL` / `BLOCKED` / `NOT_APPLICABLE` (QA outcomes, never reviewer verdicts).
- **architecture-review** — applicable categories (modularity, scalability, maintainability, security, observability, portability, cost, failure modes, data integrity, backward compatibility) each get a verdict; decisions and unresolved risks are explicit; any FAIL forces CHANGES_REQUIRED. Implementation tasks cannot start until the architecture passes.
- **code-delivery** — a configured workspace requires real code, not prose.

IDs (`REQ-`, `AC-`, `T-`, `DEC-`, `ART-`) live in a structured traceability store; Markdown memory stays a readable summary (one block per task per file, revisions replace earlier drafts).

## Code gates and isolated worktrees
Add to a brief: `workspacePath`, `checks`, `gates` (`typecheck`, `unit-tests`, `integration-tests`, `lint`, `build`, `security`; `[]` declares a gate not applicable), `setup`, `autoCommit`, `isolation`. A coding task is only done when every required gate passed; a required gate that is not configured fails the task. With `"isolation":"worktree"` each coding task works in its own detached git worktree (`.companyswai/worktrees/<project>/<task>`), runs its gates there, and is integrated serialised and conflict-checked; conflicts are rolled back and the task is re-asked against the new repository state; the merged tree is re-verified and reverted if it fails. Patches are confined to the workspace (no traversal, `.git`, symlink escapes or credential-shaped content) and never overwrite uncommitted local edits.

## Scheduling and observability
An event-driven DAG scheduler (no polling): critical-path priority with aging, per-project and per-provider concurrency, backpressure, work stealing between eligible providers, cooldown waits for rate-limited providers, bounded retries only for provider failures. Runs report queue wait, task latency, provider utilisation, retries, throughput and token/cost usage. `npm run status -- <project> --json` (or without `--json` for a loopback API: `/status`, `/tasks`, `/telemetry`, `/executions`) shows phase, running/queued tasks, providers, elapsed time, usage, retries, blockers and the final verdict.

## Budget and approvals
Limits per project, department, task and agent, reserved while calls are in flight; unknown prices fail closed on metered profiles; `approvalThreshold` per task and `projectApprovalThreshold` for the whole estimated project need a persisted approval (`npm run approve -- <project> <task|project-approval>`). An estimate that already exceeds the budget stops before any model call.

## Learning
Retrospectives propose candidates; a lesson becomes company experience only if observed in ≥ 2 projects with enough confidence, with evidence, general (no project/customer/secret detail), not temporary provider behaviour, and validly scoped (`GLOBAL`, `ROLE:<agent>`, `SKILL:<skill>`, `DOMAIN:<tag>`). Security/governance lessons wait as `PENDING_APPROVAL` for `npm run experience -- approve <n>`; lessons that weaken review/gates/approval are rejected. Learning only adds advisory prompt lessons — it never edits Markdown rules.

## State and safety
Everything persists under `.companyswai/` (git-ignored): `projects/<project>/` (PLAN, REQUIREMENTS, ARCHITECTURE, DECISIONS, HANDOFFS, REVIEWS, BLOCKERS, QA, STATUS, RETROSPECTIVE), `executions/` (the resume source of truth; torn lines and corrupt checkpoints are quarantined, writes are atomic), `runs/`, `traceability/`, `research/`, `telemetry/`, `worktrees/`, and the rest. Credentials come from the environment only, are redacted from everything persisted and withheld from check commands; `npm run doctor` scans tracked files for credential-shaped strings. Never commit `config/providers.json` or `.env`.

## Benchmark
`npm run benchmark` runs a deterministic project (product, research, requirements, architecture, backend, frontend, QA, review, DevOps) with worktrees, gates, double review, an injected rate limit, a forced revision and a crash-and-resume, and reports successful tasks, review revisions, retries, resume correctness, provider distribution, gate results, traceability, runtime and token/cost usage (CI runs it). `npm run benchmark -- --live --runtime config/providers.json` runs the same project through real providers.

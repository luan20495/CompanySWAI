# CompanySWAI

A local, **MD-first AI software company**. Markdown defines the company, its 11 core agents, their rules, skills, dependencies, output contract and quality gates. TypeScript is only the engine: parsing, validation, orchestration, provider routing, budget, checkpoints, resume, review, persistence and repo operations.

## The Markdown that defines the company
| Path | Defines |
|---|---|
| `agents/AGENTS.md` | the authoritative list of the 11 agents |
| `agents/<agent>/IDENTITY.md` | role, department, activation, skills, provider capabilities |
| `agents/<agent>/RULES.md` | required/produced artifacts, reviewer, Done conditions |
| `skills/*.md` | shared skills, loaded only into agents that declare them |
| `company/*.md` | principles, workflow, quality gates, **output contract**, **memory routing** |

Agents: product-lead, business-analyst, researcher, tech-lead, backend-engineer, frontend-engineer, mobile-engineer, ux-ui-designer, reviewer, qa-engineer, devops-sre. Only the ones a project needs are activated. See `docs/MD-ARCHITECTURE.md`.

## Quick start
```bash
npm ci
npm run check      # typecheck + tests
npm run doctor     # structural + secret checks of the Markdown company and config
npm run company -- examples/project-brief.json --dry-run   # deterministic end-to-end run, no API key
```

## Running for real
1. `cp config/providers.example.json config/providers.json` (git-ignored) and edit profiles. Each profile names its own `credentialEnv`; export those variables (or put them in a git-ignored `.env`). Provider kinds: `anthropic`, `openrouter`, `openai-compatible` (needs `baseUrl`). Prices (`inputCostPerMillion`/`outputCostPerMillion`) are required for budget enforcement.
2. `npm run company -- examples/project-brief.json --runtime config/providers.json`

`npm run company` and `npm run resume` are the same command and accept a **brief** (compiled from the Markdown company) or a **plan** (`examples/project-plan.json`). Re-running resumes; see `docs/ORCHESTRATION.md`.

Flags: `--dry-run`, `--runtime <file>`, `--state-dir <dir>` (default `.companyswai`), `--wait-approval[=seconds]`.
Exit codes: `0` all done, `1` a task failed, `2` parked (capacity, approval or blocked dependents) — fix and rerun.

Other commands: `npm run estimate -- <brief> [--runtime file]` (cost/time/capacity estimate vs budget), `npm run approve -- <project> <task> [cost] [by]`, `npm run status -- <project> [port] [stateDir]` (loopback JSON API; no UI required).

## What gets persisted (`.companyswai/`, git-ignored)
- `projects/<project>/`: `PLAN.md REQUIREMENTS.md ARCHITECTURE.md DECISIONS.md HANDOFFS.md REVIEWS.md BLOCKERS.md QA.md STATUS.md RETROSPECTIVE.md`, updated automatically
- `executions/`, `checkpoints/`, `approvals/`: resume state; `artifacts/ decisions/ handoffs/ reviews/ blockers/`: structured records
- `retrospectives/`, `company-experience.json`: the learning loop (`docs/MEMORY-AND-LEARNING.md`)

## Output contract
Every maker answers with `## Deliverables`, `## Decisions`, `## Evidence`, `## Blockers`, `## Handoff`; reviewers start with `PASS` or `CHANGES_REQUIRED`. A non-compliant response is sent back once for repair, then fails the attempt. Defined only in `company/OUTPUT-CONTRACT.md`.

## Optional real code workspace
Add to a project brief:
```json
{
  "workspacePath": "/absolute/path/to/your/local/repo",
  "checks": [{"cmd": "npm", "args": ["test"], "timeoutMs": 300000}],
  "autoCommit": false
}
```
Agents emit ```` ```file relative/path ```` blocks. Patches are confined to the workspace, applied transactionally, checked deterministically (without provider credentials in the environment), rolled back on failure and, with `autoCommit`, committed path-scoped. Records include changed files, commit SHA and check evidence.

## Safety
Credentials are read from the environment only, redacted from everything persisted, and withheld from check commands. `npm run doctor` scans tracked files for credential-shaped strings. Never commit `config/providers.json` or `.env`.

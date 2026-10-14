# Phase 0 — Baseline replay (aggregate only)

**Measured with:** `npm run scorecard -- --baseline --json`, metric catalog v1, on branch `evolution/phase-0-observability`.
**Data:** a private, byte-identical snapshot of the main checkout's `.companyswai/` taken 2026-10-14T04:46:39Z (7,894 files, tree sha256 prefix `fef80622e4554e10`). The live state was not read again after the snapshot. Raw records, prompts, outputs, project code and machine paths are **not** published; only the aggregate numbers below.
**Engine version that produced the data:** all runs predate Phase 0, so none carries a recorded company version (0/344) or recorded provenance (0/344). Remote `main` was `3ecdab1` for the whole window except possibly some of the 45 runs on 2026-10-11 before that commit landed (17:50 +0700).
**Nature:** historical observation, **not** a controlled experiment. Task difficulty, size and acceptance criteria vary between runs; trends across days are not attributable to CompanySWAI changes.

## Window and coverage

| Item | Value |
|---|---|
| Activity window (UTC) | 2026-10-08 07:33 → 2026-10-14 00:29 |
| Projects / runs in view | 344 (341 with run state and plan; 3 takeover audits without a run state) |
| Execution attempts (one per record id) | 798; 1 never finished |
| Maker tasks with attempts | 383 |
| Unreadable execution-log lines | 0 |
| Attempts with provider-reported usage | 771 of 797 finished |
| Attempts with fixture (dry-run) estimated tokens | 23 |
| Attempts with no usage reported (timeouts) | 3 |
| Human intervention log | did not exist → interventions are **UNKNOWN**, not zero |

## Audit claims — independent recomputation

| # | Audit claim | Replay (scorecard definition) | Status |
|---|---|---|---|
| C1 | Most executions bypassed the company planner | **340/341** runs had their plan supplied whole | Confirmed — *derived* from `briefHash == planHash` for all 341 (no run recorded provenance yet) |
| C2 | Prior lessons were not applied to plans | **0/341** persisted plans contain a lessons block | Confirmed |
| C3 | Some QA FAIL/BLOCKED executions were reported ACCEPTED | **20/20** runs whose QA task reported FAIL or BLOCKED ended ACCEPTED | Confirmed with the engine's own `parseQa` (the audit used a regex). QA verdicts were parseable in 109 runs; QA outputs without a `## QA Status` section are not counted |
| C4 | Makers lacked effective verification tools | Structural: the `claude-code` provider runs the CLI with `--tools ""` | Confirmed from code; not a runtime metric |
| C5 | Skill selection was not proven to improve outcomes | 809 skill selections recorded; 0 per-skill outcome measurements | Confirmed: selection is traced, outcome is not |

### New baseline findings and corrections

1. **Token totals in the audit mixed real and synthetic usage.** 23 attempts used the dry-run provider, whose token counts are character-based estimates. Provider-reported usage is **59,310,808** tokens; the audit's 59,366,641 included 55,833 estimated tokens. Phase 0 separates the sources.
2. **Supplied plans also dropped the QA contract.** Of 114 tasks assigned to the QA role in persisted plans, only 1 carries the `qa-traceability` validator, so the engine did not validate those QA outputs' structure. Another effect of bypassing the planner (relevant to Phase 1/3).
3. **"Busy time" depends on the definition.** Measured from attempt timestamps it is 24h 43m; the audit's 27.9h used run start/update times. The catalog fixes the definition (union of attempt intervals).

## Baseline metrics (catalog v1)

| Metric | Value | Numerator / denominator | Coverage / note |
|---|---|---|---|
| `accepted_run_rate` | 90.6% | 309 / 341 | ACCEPTED is the engine's verdict (see C3) |
| `qa_conflict_rate` | 100% | 20 / 20 | 109 runs with a parsed QA verdict |
| `first_attempt_gate_pass` | 81.9% | 313 / 382 | maker tasks with a finished first attempt |
| `first_pass_acceptance` | 77.5% | 283 / 365 | 341/344 runs have a readable plan |
| `attempt_failure_rate` | 26.8% | 141 / 527 | finished maker attempts |
| `rework_token_share` | 23.7% | 14,071,612 / 59,310,808 | provider-reported tokens only |
| `review_changes_required_rate` | 13.0% | 35 / 270 | review verdicts |
| `reviewer_escape_rate` | UNKNOWN | — | QA ran as separate projects with no recorded link to the reviewed work |
| `planner_bypass_rate` | 99.7% | 340 / 341 | all derived |
| `lesson_injection_rate` | 0% | 0 / 341 | |
| `reported_tokens` | 59,310,808 | — | 771/797 finished attempts |
| `tokens_per_accepted_run` | 154,298 | 47,523,875 / 308 | accepted runs with reported usage |
| `median_attempt_ms` | 52s | 797 attempts | |
| `accepted_runs_per_busy_hour` | 12.5 /h | 309 / 24.73 h | runs are mostly single-task micro-runs |
| `dispatch_gap_ms` | 112h 12m | — | includes the 3-day gap between 10-08 and 10-11 |
| `interventions_per_accepted_run` | UNKNOWN | — | no log before Phase 0 |
| `known_cost` | UNKNOWN | — | 775 subscription attempts have no per-call price |
| `skill_outcome_effect` | NOT AVAILABLE | — | Phase 4 |
| `repeated_error_rate` | NOT AVAILABLE | — | Phase 5 |
| `model_escalation_success` | NOT AVAILABLE | — | Phase 6 |
| `release_readiness` | NOT AVAILABLE | — | Phase 7 |

## Reproduce

On the owner's machine, from the Phase 0 worktree (read-only; copying the state first avoids even reading the live directory while other jobs write to it):

```bash
cp -Rp <main-checkout>/.companyswai /tmp/cswai-snapshot
npm run scorecard -- --state-dir /tmp/cswai-snapshot --baseline
npm run scorecard -- --state-dir /tmp/cswai-snapshot --baseline --json
```

# CompanySWAI Evolution Program

Coordination: master issue [#9](https://github.com/luan20495/CompanySWAI/issues/9) (decision ledger), one issue per phase (Phase 0: [#10](https://github.com/luan20495/CompanySWAI/issues/10)). Historical baseline: the read-only audit on branch `audit/companyswai-evolution-20261014`.

Every phase is implemented on its own branch and worktree, reviewed independently, accepted by the owner (UAT) and only then merged. A phase is not complete because an agent says so; status lives in [`phases.json`](phases.json) and is printed by `npm run scorecard`.

| Phase | Status | Report |
|---|---|---|
| P0 Baseline, metrics & owner visibility | IN_REVIEW · owner UAT PENDING | [phase-0/REPORT.md](phase-0/REPORT.md) |
| P1–P8 | NOT_STARTED | — |

## Owner tools (Phase 0)

| Command | What it shows | Writes |
|---|---|---|
| `npm run scorecard` | What CompanySWAI is doing now, what finished or failed (why, which role), time, tokens by source, interventions, catalog metrics, data quality | nothing |
| `npm run scorecard -- --project <id>` | Every task of one project: attempts, first/last result, DONE, review verdicts, QA verdict, wall time, failure reason | nothing |
| `npm run scorecard -- --baseline` | The audit's headline claims recomputed from the state directory | nothing |
| `npm run intervene -- <kind> --project <id> --detail "…"` | Records something a person did outside the engine (re-dispatch, model change, plan edit, …) | `.companyswai/interventions.jsonl` |
| `npm run intervene -- list` | The intervention log | nothing |

Starting work (`npm run company`), approvals (`approve`, `experience`, `takeover approve`) and operator `stop` / `resume` / `priority --apply` record their own intervention entries. Actors are self-declared (`--actor` or `COMPANYSWAI_ACTOR`) and stored as unverified.

Metric definitions: [METRICS.md](METRICS.md).

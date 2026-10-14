# Phase 0 Report — Baseline, metrics & owner visibility

| Field | Value |
|---|---|
| **PHASE** | P0 — Safe baseline, measurement & owner visibility ([#10](https://github.com/luan20495/CompanySWAI/issues/10), master [#9](https://github.com/luan20495/CompanySWAI/issues/9)) |
| **BASE_SHA** | `3ecdab1361b86e3604f6822301d29ad3b78a625d` (= `origin/main` = audit baseline) |
| **BRANCH** | `evolution/phase-0-observability` (isolated worktree, outside the main checkout) |
| **FINAL SHA / PR** | posted with `[CLAUDE-READY-FOR-REVIEW]` on #10 (a report cannot contain its own commit hash) |
| **QA_VERDICT (independent)** | PENDING — ChatGPT review not yet performed |
| **OWNER_UAT** | PENDING |
| **OWNER_DECISION** | PENDING · ready for next phase: **NO** (needs review + UAT) |

## 1. Scope completed

| Requirement (#10 / program brief) | Delivered | Evidence |
|---|---|---|
| Company version / baseline tracking | `src/company-version.ts`: git SHA, dirty flag, sha256 of `company/`+`agents/`+`skills/`, package version; recorded on every new run (`runs/<p>.json → companyVersion`). Unreadable → `unknown`, never blocks a run | `test/observability.test.ts` (end-to-end, version failure, hash stability) |
| Task and run status; active assignment | Scorecard NOW section: engine RUNNING / INTERRUPTED / FINISHED per project, running task and the role holding it | fixture `demo-running`; test "live state" |
| Start/end timestamps, wall-clock | From recorded attempt timestamps only (independent of when the report runs) | test "durations come from recorded timestamps" |
| Attempts and retries | One attempt per execution-record id (STARTED/CHECKPOINTED/terminal lines counted once); first vs last attempt per task | test "each attempt counts once" |
| Review and QA results | Review verdicts (store), QA verdict via the engine's `parseQa`; `QA_CONFLICT` flag when ACCEPTED contradicts QA FAIL/BLOCKED — **detection only**, verdicts unchanged (Phase 1) | test "QA conflict" |
| Token usage + unknown explicit | `tokenSource` (`reported` / `estimated` / `partial`) and cache creation/read recorded by providers and runner; scorecard keeps reported, fixture-estimated and unknown separate | tests "token sources stay separate", "token provenance across repair rounds" |
| Measured tokens vs estimates vs subscription charge | Reported tokens shown; dry-run estimates labelled NOT real; money = known metered cost or UNKNOWN for subscription (never 0) | metric `known_cost` |
| Human intervention logging | `interventions.jsonl` (append-only, actor self-declared, `actorVerified:false`), written automatically by `company`, `approve`, `experience`, `takeover approve`, operator `stop`/`resume`/`priority --apply`; `npm run intervene` for manual actions | tests "commands record interventions", "operator stop records … only when requested" |
| Phase and release acceptance status | `docs/evolution/phases.json` printed by the scorecard; release readiness explicitly `NOT TRACKED (Phase 7)` | scorecard output |
| Plan provenance (minimal) | `provenance: {source: brief|supplied-plan, lessonsInjected, lessonsAvailable}` on new runs; older runs derived from hashes and labelled `derived` | tests "provenance", "a supplied plan is recorded as such" |
| Reproducible benchmark fixtures | `benchmarks/evolution/p0/`: synthetic 6-project state (accepted, retry+revision, QA conflict, timeout+torn line, dry-run, running engine) + golden scorecard; generator reproduces it byte for byte | tests "committed fixture is exactly what the generator produces", "golden scorecard" |
| Historical evidence coverage | Baseline replay of the audit claims, data-quality section (unreadable lines, missing state/plan, unfinished attempts, estimated/unknown tokens) | [BASELINE.md](BASELINE.md) |
| Versioned metric definitions | Catalog v1 (`src/metric-catalog.ts`), 21 metrics with numerator, denominator, source, limitations; unavailable ones marked with the phase that makes them measurable | [../METRICS.md](../METRICS.md); test "METRICS.md documents every catalog metric" |
| No hidden writes | Scorecard reads with a new side-effect-free `FileExecutionStore.read()` (the existing `list()` quarantines by writing) | test "strictly read-only" (tree hash before/after, CLI included, torn line present) |
| No secret leak | All output redacted; registered secrets and credential-shaped strings never printed | test "no secrets or credential-shaped strings leak" |

## 2. Scope not completed / deliberately excluded

- **No change to acceptance semantics.** QA FAIL/BLOCKED still ends ACCEPTED in the engine; Phase 0 only makes it visible (Phase 1).
- **Approver identity is not verified** (Phase 1); intervention actors are self-declared.
- **Interventions before Phase 0 are unknown** and stay UNKNOWN; nothing was reconstructed.
- **Same-run reviewer escape** is computed but UNKNOWN on historical data: QA ran as separate projects with no recorded link (Phase 3).
- **No controlled before/after performance experiment**: Phase 0 changes measurement, not delivery behaviour; there is nothing comparable to run yet. The golden fixture is the comparison baseline for later phases.
- `npm run status` / `operator` views were not changed (the scorecard is a new company-wide view).

## 3. Affected files

New: `src/company-version.ts`, `src/plan-provenance.ts`, `src/intervention-log.ts`, `src/intervene-cli.ts`, `src/metric-catalog.ts`, `src/scorecard.ts`, `src/scorecard-render.ts`, `src/scorecard-cli.ts`, `test/scorecard.test.ts`, `test/observability.test.ts`, `benchmarks/evolution/p0/{fixture.ts,build.ts,expected-scorecard.json,state/**}`, `docs/evolution/**`.

Changed (additive): `src/run-store.ts` (optional `companyVersion`, `provenance`), `src/autonomous.ts` (records them at PLAN), `src/execution-record.ts` (optional `tokenSource`, cache fields), `src/provider.ts` + 4 providers (report token source/cache), `src/runner.ts` (carries them through repair rounds, checkpoint and finalize), `src/execution-store.ts` (read-only `read()`), `src/state.ts` (intervention log), `src/plan-compiler.ts` (exports the lessons header, same text), CLIs `company`, `approve`, `experience`, `takeover`, `operator-commands` (intervention entries, `--actor`), `package.json` (`scorecard`, `intervene` scripts), `tsconfig.json` (type-checks `benchmarks/**/*.ts`), `README.md`, `CLAUDE.md` (two operator intents), `test/operator.test.ts` (see §6).

## 4. Tests and results

| Run | Result |
|---|---|
| Baseline before any change (`npm run check` at `3ecdab1`, isolated worktree) | typecheck OK, **320/320** pass |
| After Phase 0 (`nice -n 15 npm run check`) | typecheck OK, **342/342** pass (320 existing + 22 new), 0 fail, 0 skipped |
| Read-only proof on real data | scorecard over the live state twice before the isolation gate: tree hash identical before/after; afterwards only a private snapshot was read |

## 5. Before / after

| Capability | Before (3ecdab1) | After (this branch) |
|---|---|---|
| See what the company is doing / did, company-wide | Per-project operator views only; no company-wide failure/time/token view | `npm run scorecard` (overview, per project, baseline, JSON) |
| Know which CompanySWAI version produced a run | Not recorded | Recorded on every new run |
| Know where a plan came from and if lessons were injected | Only inferable from hashes | Recorded; old runs labelled derived |
| Tell real tokens from estimates and unknown | Mixed (`0` meant both none and unknown; dry-run estimates looked real) | Separated and labelled |
| Count human interventions | Impossible | Logged from Phase 0 onward |
| Detect ACCEPTED-with-QA-FAIL | Manual analysis | Flagged automatically (20/20 historical cases found) |
| Organisational metrics | Ad-hoc scripts in the audit | Versioned catalog v1, reproducible on a public fixture |

Historical baseline values: [BASELINE.md](BASELINE.md). No delivery-performance "after" values exist yet, by design.

## 6. Changed behaviour and migration

- `operator stop` (when a stop is requested), `operator priority --apply`, `operator resume`, `npm run company`, `npm run approve`, `npm run experience approve|reject`, `npm run takeover approve` now append one line to `<state>/interventions.jsonl`. A logging failure prints a warning and never fails the command. The existing operator test that lists every file a mutating command touches was updated to include this file and to check the entries.
- New runs carry `companyVersion` and `provenance` in `runs/<p>.json`; execution records may carry `tokenSource`, `cacheCreationInputTokens`, `cacheReadInputTokens`. All fields are optional: existing state loads unchanged (test "state created by an older CompanySWAI … still loads"); older code ignores the extra keys.
- `inputTokens` keeps its meaning (includes cache tokens) so budgets and estimates are unaffected.
- Creating a run now runs `git rev-parse HEAD` and `git status --porcelain` (read-only, optional locks off, 5 s timeout) in the CompanySWAI root.

## 7. Demo instructions (owner, isolated)

```bash
cd <phase-0 worktree>                        # never the main checkout
npm ci
npm run scorecard -- --state-dir benchmarks/evolution/p0/state                       # public synthetic fixture
npm run scorecard -- --state-dir benchmarks/evolution/p0/state --project demo-supplied-retry
npm run scorecard -- --state-dir benchmarks/evolution/p0/state --json | head -40
cp -Rp <main-checkout>/.companyswai /tmp/cswai-snapshot                               # read-only copy of real history
npm run scorecard -- --state-dir /tmp/cswai-snapshot                                  # what happened, why it failed, who, time, tokens
npm run scorecard -- --state-dir /tmp/cswai-snapshot --baseline                       # audit claims recomputed
npm run intervene -- manual --project demo --detail "UAT check" --actor owner --state-dir /tmp/cswai-uat   # writes only to /tmp
npm run intervene -- list --state-dir /tmp/cswai-uat
nice -n 15 npm run check                                                              # 342 tests
```

Expected: fixture overview shows 1 QA conflict, 1 failed task (devops-sre, gate failure), separate reported/estimated/unknown tokens, interventions "4 recorded since 2026-01-13", `demo-running` as INTERRUPTED (its pid is not alive outside the test); baseline shows C1 340/341, C2 0/341, C3 20/20.

## 8. Known limitations

- Scorecard reads every project's log on each call (≈2 s for 344 projects); fine now, not designed for very large histories.
- QA verdicts are what the QA agent wrote; the scorecard parses, it does not verify them.
- Derived plan source can be wrong for replanned/reprioritised supplied plans (labelled `derived`).
- `dispatch_gap_ms` includes intentional idle time.
- Interventions are only as complete as what people record for actions outside the engine.

## 9. Security risks

- Intervention actors are unverified (documented; Phase 1 binds approvals to requests and identities).
- New file `interventions.jsonl` may contain free-text details: redacted and capped at 500 characters; it lives in the git-ignored state directory.
- `git` is invoked read-only by run creation and the scorecard; no shell, fixed argv, timeout.
- No network, provider or port is used by any new code or test.

## 10. Rollback

Do not merge, or revert the branch's commits. State written by this branch stays readable by the old code (zod drops unknown keys); `interventions.jsonl` can be deleted. No migration is needed in either direction.

## 11. Definition of organisational progress

1. **New capability:** the owner can see, without asking an agent, what CompanySWAI is doing, what failed and why, who was responsible, time and tokens by source — and the audit's baseline claims are reproducible by product code.
2. **Intervention reduced:** none yet in delivery; analysis that needed ad-hoc scripts is now one command.
3. **Failures now preventable:** none prevented; ACCEPTED-with-QA-FAIL is now *detected* automatically (prevention is Phase 1).
4. **Faster / more accurate:** not claimed; Phase 0 changes measurement only.
5. **New risks / overhead:** one extra JSONL file, two read-only git calls per new run, an extra command; unverified actors.
6. **Evidence:** 342/342 tests, golden fixture, baseline replay with numerators/denominators, read-only hash proof.
7. **Easier or harder to operate:** easier to observe; nothing extra is required to operate.
8. **Next:** Phase 1 — make QA/reviewer verdicts authoritative (the 20/20 conflict), review-before-integration, request-bound approvals, cross-process locks.

## 12. Rejected approaches

- Extending `operator` views instead of a new command: they load per-task checkpoints/approvals and the store `list()` that quarantines (writes); a separate strictly read-only reader was safer.
- Identifying QA tasks by role name: violates the Markdown-first rule (a guard test caught it); QA is detected by contract (`qa-traceability`) or by a `## QA Status` section.
- Counting `inputTokens = 0` as zero usage: it also meant "not reported"; replaced by explicit token sources.

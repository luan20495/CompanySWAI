# C0–C7 knowledge harvest — public decision matrix (Issue #18, deliverable C)

**Status:** `KNOWLEDGE_HARVEST=NOT_PASSED` · `DEPENDENCY_MIGRATION` tracked on #13 · `PHYSICAL_C_CLEANUP=BLOCKED`. This document deletes nothing and authorizes nothing.

**Inputs (public only).** (1) The sanitized first-pass matrix posted on Issue #18 (comment `6166124070`, 32 generalized patterns, privacy-reviewed by its author and operator). (2) This repository at `dev` `92075aa`. No private source, other repository, transcript or run log was read for this document. Provenance of each pattern (which legacy lane, which evidence) stays in the owner's private archive and is **pending independent verification**; nothing below upgrades a pattern's proof level.

**What this document adds.** An independent check of the "Coverage today" column against the actual role rules, skills, policy and validators on `dev`, with `file:line` evidence, the exact delta still missing, the overlap with the static role audit (PR #19, `docs/audits/ROLE-STATIC-AUDIT-11.md`), and integration batches. Method: a keyword scan over `agents/`, `skills/`, `skills/dynamic/`, `company/`, `src/validators.ts`, `src/takeover-exec.ts`, then reading every hit; false friends are noted.

Coverage vocabulary: `ALREADY_COVERED` · `COVERED_BUT_WEAK` (the idea is present but the delta matters) · `GAP` (absent on `dev`). Decision vocabulary as on #18: `ACCEPT` / `DEFER` / `REJECT`; every ACCEPT becomes a small, separately reviewed PR into `dev`.

## 1. Corrections to the first-pass coverage column

| # | First pass said | Verified on `dev` | Why |
|---|---|---|---|
| 2 | GAP | COVERED_BUT_WEAK | `skills/dynamic/code-review.md:34` already requires that tests "fail without the fix"; missing only for **checkers** (gates, guards, QA harnesses) |
| 10 | COVERED_BUT_WEAK | **GAP** | the branch-lifecycle document it relies on is on unmerged PR #7, not on `dev`; no skill mentions preservation before cleanup |
| 18 | GAP | COVERED_BUT_WEAK | `skills/dynamic/migration-review.md:36` already says "tenant_id and composite keys preserved"; missing the design rule and a catalog-query test |
| 19 | GAP | COVERED_BUT_WEAK | secrets out of logs/URLs/errors exist (`skills/dynamic/security.md:16`, `security-review.md:32`); missing serialized sessions/string forms and the delegated-credential rule |
| 21 | GAP | COVERED_BUT_WEAK | `skills/dynamic/testing.md:16` "fix flaky tests, never retry-mask them"; `api-quality.md:40` skip-vs-fail; missing owner + tracked issue + report listing |
| 24 | COVERED_BUT_WEAK | **GAP** | only container resource limits (`devops.md:16`); nothing on sequencing heavy gates or host prechecks (gates run on the host, PR #19 F-05) |
| 25 | COVERED_BUT_WEAK | **GAP** | no rule text mentions off-by-default switches; canary/rollback (`devops.md:16`) is a different control |
| 26 | COVERED_BUT_WEAK | **GAP** | no declared-scope review rule, no decision-record rule; reviewers do not even see the repository diff (PR #19 I-02) |
| 28 | ALREADY_COVERED | **GAP + enforcement conflict** | `agents/qa-engineer/RULES.md` has no "never edit production code" rule, and QA file blocks are applied with no gate and no review (PR #19 F-04: `src/runner.ts:148,168-173`, `reviewedBy: none`). Prompt text alone cannot fix this; it needs P-05 |
| 7, 17 | COVERED_BUT_WEAK | COVERED_BUT_WEAK, **narrower delta** | most of the pattern already exists (see rows below); only the listed delta should be added |

Note on a false friend: `skills/dynamic/security-review.md:38` "Default deny" is about *not probing live systems*, not about authorization; pattern 8 still needs its own line.

## 2. Verified matrix

| # | Pattern (generalized, from #18) | Verified coverage on `dev` (evidence) | Delta still missing | Destination | Overlap with PR #19 | Decision |
|---|---|---|---|---|---|---|
| 1 | Terminate only processes you can prove you started; never by name/port; static ban of kill idioms in delivered scripts | GAP (no hit for kill/pid/process group) | the whole rule + deterministic scan | devops-sre rule, `platform-reliability` skill, scan in batch A | F-05 (gates run model code on the host) | ACCEPT |
| 2 | A checker is trusted only after a seeded broken fixture makes it fail | COVERED_BUT_WEAK (`code-review.md:34` for tests) | extend to gates/guards/QA harnesses; reviewer asks "does this gate have a failing fixture" | qa-engineer + reviewer rule, `verification-before-completion` | I-04, P-06 | ACCEPT |
| 3 | Only an executed, uncached run is evidence | COVERED_BUT_WEAK (`verification-before-completion.md:32` "a required gate that did not run is a failure"; `src/takeover-exec.ts:29` rejects PASS with no test run) | explicit cache markers ⇒ not evidence; read result files | executed-evidence parser (takeover-exec pattern) + one skill bullet | F-06, P-07 | ACCEPT |
| 4 | Bind every result to revision + command + output | COVERED_BUT_WEAK (`src/takeover-exec.ts:12` binds takeover evidence to a commit; nothing for project QA) | revision identifier in QA/gate evidence lines | qa-engineer output contract; optional validator | P-04, P-07 | ACCEPT |
| 5 | Mutation check of new tests; a regression test must fail without its fix | GAP for mutation (0 hits); "fail without the fix" exists (`code-review.md:34`) | targeted mutation step for security/permission/escaping code | `qa-risk-testing` section or small dynamic skill | P-06 test-adequacy gate | ACCEPT |
| 6 | Recovery is not deployment: restart only the approved immutable artifact, fail closed | COVERED_BUT_WEAK (`devops.md:16` same-artifact promotion, automatic rollback) | restart path = approved artifact only, fail closed, bounded watchdog | devops skill + devops-sre "done only when" | 2.11 (no deploy evidence) | ACCEPT |
| 7 | Forward-only migrations, central number allocation, ledger, void-gap rule, release proof pins schema level | COVERED_BUT_WEAK (`migration-review.md:40` never edit applied, owner allocates numbers, no out-of-order; `database.md:16`) | only: recorded void-gap rule, release proof pins expected schema level | `migration-review` (two lines) | — | ACCEPT |
| 8 | Authorization: default deny, decide on permission codes not role names, uniform not-found for unknown and foreign, foreign-id vs random-id negative tests | COVERED_BUT_WEAK (`security.md:16` server-side object authorization; `security-review.md:32` tenant boundary; `api-quality.md:37` wrong-tenant/not-found taxonomy) | permission codes not role names; uniform not-found; the foreign-vs-random negative test | `security-review` checklist, reviewer rule, `qa-risk-testing` hint | — | ACCEPT |
| 9 | Reserve the idempotency key before the effect; an interrupted mutating step is an UNKNOWN outcome, not retried | COVERED_BUT_WEAK (`api-quality.md:32`, `backend-reliability.md:16`, `distributed-systems.md:17`) | ordering reserve→act→record; "ambiguous write = UNKNOWN, not auto-retried" (must not contradict the retry advice: retries only for idempotent operations) | `backend-reliability`, `distributed-systems` | — | ACCEPT |
| 10 | Preserve before cleanup: inventory, patches, verified bundle, restore test, off-machine copy, non-force removal | **GAP** on `dev` | whole rule; prerequisite of the #13 dependency-migration gate | devops-sre skill; link from the branch-lifecycle doc once PR #7 lands | — | ACCEPT |
| 11 | Single-writer resources: lease + fencing token + compare-and-set | GAP (hits are false friends) | whole rule | `distributed-systems` | P1 plan Q5 (fenced leases) | ACCEPT |
| 12 | One shared decision point for every path to a protected state | GAP | whole rule | `security-review` + reviewer checklist | — | ACCEPT |
| 13 | Count-based invariants lock the counted rows; repeated race tests | GAP | whole rule | `database` / `backend-reliability` | — | ACCEPT |
| 14 | Run all browser specs before merging a UI change; screenshot the real running app | GAP | whole rule (only meaningful with an executing harness) | `e2e-browser-testing`, qa-engineer regression rule | F-05, P-04 (agents cannot run browsers) | ACCEPT, sequence after P-04 |
| 15 | Evidence class labels (unit/mock/harness/integration/real); never relabel upward; BLOCKED ≠ PASS | COVERED_BUT_WEAK (`api-quality.md:38`, `testing.md:16` real dependencies; `qa-engineer/RULES.md:44` BLOCKED vs FAIL) | the label vocabulary and the no-relabel rule | qa-engineer rule + validator vocabulary | F-06, P-07 | ACCEPT |
| 16 | Severity is never lowered to ship; reclassification needs evidence; accepted risk needs a named decision | COVERED_BUT_WEAK (severity formats in `code-review.md:40`, `security-review.md:30`) | the no-downgrade rule and named risk acceptance | product-lead / reviewer / qa-engineer wording | P1 plan Q6 (owner-only risk acceptance) | ACCEPT |
| 17 | Bounded queries; keyset over deep offset; realistic-volume plans; pool exhaustion test | COVERED_BUT_WEAK (`database.md:16` EXPLAIN, no N+1/unbounded scans, stable-key pagination; `api-quality.md:31`) | only: query/statement timeouts, byte bounds, pool-exhaustion test, plan check at realistic volume | `database` / `performance` | — | ACCEPT |
| 18 | Tenant-carrying composite foreign keys with a catalog-query test | COVERED_BUT_WEAK (`migration-review.md:36`) | design rule + catalog-query test | `database` / `migration-review` | — | ACCEPT |
| 19 | Delegated one-time credentials only from a holder of every right, re-checked at use; secrets out of sessions/string forms | COVERED_BUT_WEAK (`security.md:16`, `security-review.md:32` for logs/URLs/errors) | delegated-credential rule; serialized session / toString leakage | `security-review` (principle only) | — | ACCEPT |
| 20 | Maker-pack rules for generate-then-gate systems; diff touches only declared files | GAP (no scope check; `src/validators.ts` has none) | operator playbook; optional "changed files ⊆ declared scope" validator | operator playbook (docs) | I-02, P-02 | ACCEPT |
| 21 | Quarantined tests need an owner, a tracked issue and a report line | COVERED_BUT_WEAK (`testing.md:16`, `api-quality.md:40`) | owner + issue + report listing | reviewer + qa-engineer rule | — | DEFER (needs a trial) |
| 22 | STOP rules in maker briefs (no progress, repeated failure, foreign file) | COVERED_BUT_WEAK (`verification-before-completion.md:32` BLOCKED wording) | the stop triggers and checkpoint format | maker brief template | — | DEFER |
| 23 | Persistence proven by reload/restart test with counts and hashes | GAP | whole rule | `qa-risk-testing` hint | — | ACCEPT (small) |
| 24 | Heavy-gate hygiene: sequential heavy jobs, resource precheck recorded, timeout first diagnosed as starvation | **GAP** | whole rule (thresholds stay project-specific) | devops-sre skill paragraph | F-05, I-05 | ACCEPT |
| 25 | New capability behind an off-by-default switch; enabling is a recorded decision | **GAP** | whole rule | tech-lead rule line | — | ACCEPT (small) |
| 26 | Review the delta against the declared file scope; contract changes only via a numbered decision; record what is NOT delegated | **GAP** | whole rule; reviewer needs the real diff first | reviewer / tech-lead rules | I-02, P-02 | ACCEPT, sequence after P-02 |
| 27 | Persistent QA master per revision; previous PASS retested on the new revision | COVERED_BUT_WEAK (`qa-engineer/RULES.md:18`, `company/POLICY.md:9-10`, per-run `qa-traceability`) | cross-revision persistence and retest ordering | qa-engineer artifact + workflow | I-03 (stale acceptance after replan) | ACCEPT |
| 28 | Independent QA never edits production code; fixtures only through product interfaces | **GAP + enforcement conflict** (no rule; QA file blocks are applied ungated and unreviewed, PR #19 F-04) | rule text **and** runtime enforcement | qa-engineer rule **plus** P-05 (non-code roles may not write files) | F-04, P-05 | ACCEPT, enforcement first |
| 29 | Evidence archive: text in version control, binaries outside with checksums and a manifest, off-machine copy | GAP for projects (takeover only hashes its logs, `src/takeover-exec.ts:12`) | whole rule | devops-sre / qa playbook | P-04 | ACCEPT |
| 30 | Pure-logic-first UI with a real-browser acceptance pass | COVERED_BUT_WEAK (mobile only: `android.md:16`, `flutter.md:17`) | web frontend line | `frontend-engineering` / `frontend-performance` | — | ACCEPT (small) |
| 31 | Ratchet guards: known-bad pattern counts may only go down | GAP | — | — | — | DEFER |
| 32 | Decision records list options considered and why rejected | COVERED_BUT_WEAK (`company/OUTPUT-CONTRACT.md:13-14` "Decisions taken and why") | "options considered / rejected" | output contract wording | P-08 (ADR sections) | ACCEPT (small) |

Not for import (unchanged from #18): fixed eight-owner staffing and per-role worktrees, kill-by-name/port cleanup, content-fingerprint portal rebuild, product-domain workflow/cache designs → REJECT or DEFER as listed there; the three duplicates stay `n/a`.

## 3. Integration batches (refined; each a separate PR into `dev`, none started)

| Batch | Contents | Kind | Depends on | Size |
|---|---|---|---|---|
| A — enforcement first | P-05 from PR #19 (non-code roles may not write files) so that pattern 28 is real; delivered-script kill-idiom scan (1); cache markers rejected and revision required in executed evidence (3, 4) | code + targeted tests | PR #19 review | M |
| B — QA and reviewer rules | 2, 15, 16, 21 (after trial), 27, 28 (text), 32 | Markdown rules, one or two lines each | A for 28 | S |
| C — specialist skills | 1, 6, 7, 8, 9, 10, 11, 12, 13, 17, 18, 19, 23, 24, 30 (only the listed deltas) | skill paragraphs; check context-size caps (`src/skill-selector.ts:20`, reviewer 9,000 chars) | — | M |
| D — after evidence harness / review-before-integrate | 5, 14 (need executed browser/mutation evidence, P-04/P-06); 20, 26 (need the real diff in review, P-02) | mixed | P-02, P-04, P-06 | M–L |
| E — operator playbook | 20 (maker-pack), 22 (stop rules) | docs | — | S |

Every batch: independent review for duplication with the existing skill text, prompt size, injection safety; no project names, paths or incident detail; provenance "first-party, private ledger" recorded, nothing copied from third parties.

## 4. Still open before `KNOWLEDGE_HARVEST=PASS`

- Independent accuracy review of the patterns against the private ledger (not possible from this public document; owner-side reviewer).
- Second pass over unread private sources for the low/medium-depth lanes (listed on #18).
- A restore drill and off-machine copy of the preservation bundle (pattern 10), before any removal.
- `[CHATGPT-KNOWLEDGE-REVIEW]` of this matrix.

Privacy check of this document: generalized patterns and repository citations only; no private paths, revisions, hosts, ports, project or customer names, credentials, logs or live-weakness descriptions.

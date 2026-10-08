# Live benchmark results (claude-code, Claude Code Team subscription)

These are real runs through the local `claude -p` provider, recorded as they happened. The deterministic benchmark (`npm run benchmark`) is the CI gate; the live ones are evidence of behaviour with a real model and are expected to vary.

## Library benchmark (`benchmarks/library-brief.json`, BALANCED, real gates) — 495 s
- 5 of 5 tasks completed (product-lead, business-analyst, tech-lead, backend-engineer, qa-engineer), 9 model calls, all on `claude-code`, 135k input / 61k output tokens (subscription, no price).
- The backend task delivered a working semver library: 10 files, **64 tests passing in an isolated worktree**, typecheck/unit-test/project gates PASS, integrated into main as one commit and re-verified on the merged tree.
- One gate retry: `tech-lead` emitted a file block that failed the strict test gate and the gate-repair loop fixed it on the next attempt.
- QA traced 20 requirements to the runtime's executed test output (22 tests) and reported **FAIL**: one low-severity requirement deviation (a test file imports `node:fs`, against REQ-015) and one criterion BLOCKED (Node 18 execution). Final status: `FAILED_QA`.
- Not claimed as a pass: the project verdict is whatever QA found. (The QA → rework loop was added afterwards, see the closure runs below.)

## Library benchmark, closure runs (after QA rework, Node 18 gate and the fixes below)
Three live runs of `benchmarks/library-brief.json` (BALANCED, real gates including a real Node 18 run of the suite):
1. **Resumed run** (from a paused checkpoint): all 5 tasks, 4 reviews PASS, QA PASS (26 requirements traced), final `ACCEPTED_WITH_RISKS` (3 risks). Its metrics include 12 failed attempts recorded *before* the fix below, so it is not a clean measurement.
2. **Clean run, before the verifier fix**: all tasks succeeded and gates passed with 0 retries, but QA reported **BLOCKED** and the project ended `BLOCKED`: the QA agent was given the backend artifact clipped at the 30k-character upstream cap (README cut mid-sentence), and the Node gate printed no version string. Both were CompanySWAI defects.
3. **Clean run, after the fixes**: 5 of 5 tasks, 4 reviews PASS with no revisions, QA **PASS** (27 requirements traced to 27 tests), 4 gates passed, the backend gate-repair loop fixed 2 failed attempts by itself, no duplicate work, resume correct. Final status **`ACCEPTED_WITH_RISKS`** (not `ACCEPTED`): 2 requirements rest on unconfirmed assumptions and the architect listed 3 unresolved risks (error-formatting on exotic inputs, a `TypeError`-vs-`SyntaxError` guarantee, a placeholder package name). The status policy requires every one of those to be empty for `ACCEPTED`; it was not changed to reach that label. 155k input / 77k output tokens, 757 s.

Fixes made on the way: project-wide checks no longer gate incidental files of non-code tasks (the tech lead's `package.json` looped on the strict test gate, 12 failed attempts); verifiers see the whole upstream artifact; live Node gates print the exact `node --version` they ran under. QA FAIL → owner rework → re-verification is proven by the deterministic benchmark (1 round, 2 requests) and `test/qa-rework.test.ts`; none of the live runs happened to produce a QA FAIL, so the loop has not fired against a real model.

## Commerce benchmark (`benchmarks/commerce-brief.json`, MAX_QUALITY, no-op gates) — 2414 s
- Research, product plan, requirements, architecture (double independent review, genuine design defects found and fixed) and UX design all completed. Backend and frontend code passed gates and integrated, but two independent HIGH_RISK reviewers refused it for four rounds because the benchmark's gates were `node -e process.exit(0)` — "a workflow that has never run is configuration, not evidence". Final status `FAILED`. 1.40M input / 0.37M output tokens.
- This run motivated: whole-artifact review context, section handling, reviewer verdict discipline, policy-driven round limits, gate-failure repair, worktree base capture, QA evidence, and the real-gate library benchmark.

## Earlier runs
Four earlier live runs failed on defects in CompanySWAI itself (reviewers shown a truncated or section-filtered artifact; overly literal requirement formats; round limits too low). Each is fixed and has a regression test.

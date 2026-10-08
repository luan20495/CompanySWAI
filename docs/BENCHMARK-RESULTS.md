# Live benchmark results (claude-code, Claude Code Team subscription)

These are real runs through the local `claude -p` provider, recorded as they happened. The deterministic benchmark (`npm run benchmark`) is the CI gate; the live ones are evidence of behaviour with a real model and are expected to vary.

## Library benchmark (`benchmarks/library-brief.json`, BALANCED, real gates) — 495 s
- 5 of 5 tasks completed (product-lead, business-analyst, tech-lead, backend-engineer, qa-engineer), 9 model calls, all on `claude-code`, 135k input / 61k output tokens (subscription, no price).
- The backend task delivered a working semver library: 10 files, **64 tests passing in an isolated worktree**, typecheck/unit-test/project gates PASS, integrated into main as one commit and re-verified on the merged tree.
- One gate retry: `tech-lead` emitted a file block that failed the strict test gate and the gate-repair loop fixed it on the next attempt.
- QA traced 20 requirements to the runtime's executed test output (22 tests) and reported **FAIL**: one low-severity requirement deviation (a test file imports `node:fs`, against REQ-015) and one criterion BLOCKED (Node 18 execution). Final status: `FAILED_QA`.
- Not claimed as a pass: the project verdict is whatever QA found. There is no automatic QA → rework loop yet (listed in the scorecard).

## Commerce benchmark (`benchmarks/commerce-brief.json`, MAX_QUALITY, no-op gates) — 2414 s
- Research, product plan, requirements, architecture (double independent review, genuine design defects found and fixed) and UX design all completed. Backend and frontend code passed gates and integrated, but two independent HIGH_RISK reviewers refused it for four rounds because the benchmark's gates were `node -e process.exit(0)` — "a workflow that has never run is configuration, not evidence". Final status `FAILED`. 1.40M input / 0.37M output tokens.
- This run motivated: whole-artifact review context, section handling, reviewer verdict discipline, policy-driven round limits, gate-failure repair, worktree base capture, QA evidence, and the real-gate library benchmark.

## Earlier runs
Four earlier live runs failed on defects in CompanySWAI itself (reviewers shown a truncated or section-filtered artifact; overly literal requirement formats; round limits too low). Each is fixed and has a regression test.

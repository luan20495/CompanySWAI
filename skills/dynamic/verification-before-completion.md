---
name: verification-before-completion
version: 1.0.0
description: No completion claim without fresh evidence: name the proof, read the result, report exactly what ran and what did not.
appliesTo: ["backend-engineer", "frontend-engineer", "mobile-engineer", "devops-sre", "qa-engineer", "reviewer", "tech-lead"]
capabilities: []
keywords: []
tags: ["delivers-code", "reviews-code", "risk-high", "risk-critical"]
source: companyswai
license: LicenseRef-CompanySWAI
decision: NATIVE
reviewMethod: true
riskLevel: low
requiresNetwork: false
requiresBrowser: false
requiresExternalBinary: []
requiresCredentials: false
outputContract: ["Evidence"]
---
# Verification before completion

Do not say work is done, fixed, passing or safe unless you hold fresh evidence for that exact claim. Confidence is not evidence.

**Before any completion claim**
1. State the claim in one sentence ("the migration applies cleanly", "login rejects an expired token").
2. Name what would prove it: a gate result, a test, a command output, an artifact, a diff. The proof must be able to fail.
3. Read the actual result. Quote the command or gate and its outcome; do not paraphrase a green summary you did not see.
4. Compare result to claim. If it covers less than the claim, narrow the claim.

**You have no shell.** You cannot run anything. Evidence comes only from the gates, test results, upstream artifacts and execution records the runtime shows you. If none exist for a claim, write "NOT RUN" or "NOT VERIFIED" next to it. Never write "should pass", "looks correct" or "tests would pass".

**Status words.** DONE only when every acceptance criterion has evidence. PARTIAL when some do: list which. BLOCKED when something outside the task stops it: name it. UNKNOWN when nothing is checkable. A required gate that did not run is a failure, not a pass.

**Common false completions.** Compiles but never exercised; happy path only; test passes because it asserts nothing; fix verified on a different input than the bug; earlier result reused after the code changed; green on a partial run.

**Defects and regressions.** A fixed defect needs the failing case reproduced before and passing after, plus a regression test. If you cannot show both, say so.

**Reviewers and QA.** Re-check the evidence itself, not the author's summary. A claim without evidence is CHANGES_REQUIRED or FAIL, however plausible.

Output a short table: claim | evidence (gate/test/artifact) | result | status.

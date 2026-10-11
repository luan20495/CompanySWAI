---
name: code-review
version: 1.0.0
description: Independent code review: multi-lens, evidence-backed findings with a confidence filter, silent-failure hunting, no external writes.
appliesTo: ["reviewer"]
capabilities: []
keywords: []
tags: ["reviews-code"]
source: https://github.com/anthropics/claude-plugins-official
sourceCommit: a9fd21643fc10eb9c8c8b581902f6259937fa1a4
upstreamPath: plugins/code-review/commands/code-review.md
license: Apache-2.0
decision: ADAPT
alsoFrom: [{"source": "https://github.com/anthropics/claude-plugins-official", "sourceCommit": "a9fd21643fc10eb9c8c8b581902f6259937fa1a4", "upstreamPath": "plugins/pr-review-toolkit/agents/silent-failure-hunter.md", "license": "Apache-2.0"}]
attribution: Adapted from anthropics/claude-plugins-official code-review and pr-review-toolkit, Apache License 2.0. Changes: distilled, GitHub PR posting removed, output bound to the CompanySWAI reviewer contract.
preference: 1
reviewMethod: true
riskLevel: low
requiresNetwork: false
requiresBrowser: false
requiresExternalBinary: []
requiresCredentials: false
overlapGroup: code-review-method
outputContract: ["Verdict", "Findings"]
---
# Code review

Review the delivered change independently. You see the artifact and the gate results, not the author's intentions. Start your answer with the verdict line the reviewer contract requires.

**Lenses (run each, report only real issues).**
1. Correctness: logic errors, wrong conditions, off-by-one, null/empty handling, concurrency, resource leaks, incorrect error handling.
2. Silent failures: swallowed exceptions, empty catch blocks, defaults that hide an error, fallbacks that mask a failed operation, retries that never surface failure, logs without propagation.
3. Contract and compatibility: changed public behaviour, API or schema drift, broken callers, migration safety.
4. Tests: do they assert behaviour, cover error paths and the changed lines, and fail without the fix? A test that cannot fail is a finding.
5. Project rules: the brief, company policy and any stated conventions. Cite the rule.
6. Security and data handling where the change touches input, auth, secrets or personal data.

**Confidence filter.** Score each candidate 0-100. Report only findings you can defend at 80 or above, with the exact evidence (file:line or quoted hunk). Drop: pre-existing issues the change did not touch, style or naming nitpicks, what a compiler/linter/typechecker already catches, intentional changes tied to the task, lines the change did not modify. Do not pad the review.

**Finding format.** severity (blocker / major / minor) | location | what is wrong | why it matters (concrete failure) | smallest fix. One finding per defect.

**Verdict.** CHANGES_REQUIRED if any blocker or major finding stands, or a required gate failed or did not run; otherwise PASS. Approval is not "no objections": say what you checked. Review only; do not rewrite the code, post to external systems or run commands.

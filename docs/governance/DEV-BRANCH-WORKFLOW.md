# CompanySWAI development branch contract — dev integration, owner-controlled main

**Owner directive: 2026-10-14. Effective immediately for new CompanySWAI work.** `main` remains the stable branch and **is not modified** merely because engineering work is done. `dev` is the integration branch and target for feature work. Note: this document describes governance; GitHub ruleset/branch protection is NOT implied to exist until configured and verified by a repository administrator.

## Branch and PR model

```text
main (stable; owner-only final merge)
  |
  +--> dev (long-lived development integration)
          |
          +--> feature/<topic>     --> PR to dev --> code/document review --> CI --> QA --> merge to dev
          +--> fix/<topic>         --> PR to dev --> review            --> CI --> regression --> merge to dev
          +--> audit/<topic>       --> PR to dev --> factual review --> link evidence --> merge to dev
          +--> docs/<topic>        --> PR to dev --> documentation review --> merge to dev

After a complete, reviewed DEV release candidate:
dev --> PR to main --> owner manually clicks Merge (or rejects)
```

1. **Branch source:** new feature/fix/audit branch starts from the *current exact SHA* of `dev` (unless a deliberately documented stacked PR requires another approved base). Work happens in a dedicated worktree, never the currently running stable checkout.
2. **Before PR:** report purpose, source base SHA, changed files, affected existing sessions/worktrees, acceptance criteria, rollback, and security/privacy impact. Preserve uncommitted work; no force push or history rewrite.
3. **PR to dev:** default required for every material new feature, repair or capability/policy change. Review evidence must correspond to the exact PR HEAD. For a theory-only documentation PR, check reference validity, accuracy and contradictions; do not run irrelevant expensive model or product benchmarks solely to make a green badge.
4. **Independent review:** every production-code PR needs reviewer different from the implementing agent/context and deterministic tests appropriate to affected behavior. Risk-based quality means no skipping required checks for security, QA, auth/data/publish, UI or performance. If GitHub is accessed using the same identity for different AI agents, a self-APPROVE is NOT independent; record substantive sign-off with inspected SHA/evidence and escalate missing independent reviewers.
5. **Merge into dev:** permitted only after actual review + applicable checks PASS, no blockers, no non-interference violations and target dev has not moved unexpectedly. Record the merge SHA and update the issue. Use normal merge mechanisms; no force-push.
6. **DEV validation:** run applicable fast checks and genuine DEV integration/QA for code once the testing phase is scheduled. Preserve existing running apps and state. No automatic restart/redeploy on `main`.
7. **Promotion:** create a **separate `dev → main` PR only when the whole development tranche is done**, with exact SHA diff, dependency/migration audit, full QA evidence, owner-facing changes and known risks, rollback and recovery. **The owner alone clicks final merge**; neither Claude nor ChatGPT auto-merges this PR. Nothing auto-deploys PROD/Windows.
8. **Branch protection:** intended rules are no direct push to `main`, no bypass of review/required CI and no auto-merge into `main`. GitHub branch ruleset requires explicit admin configuration; until then this is a procedural restriction, not a technically enforced rule.

## Current migration bookkeeping

At initiation the GitHub `main` SHA was `3ecdab1361b86e3604f6822301d29ad3b78a625d`. `dev` was created from exactly that SHA; it did **not** incorporate open PRs automatically. Existing PR #11 (P0 observational scorecard @ a0fcb91) and PR #7 (git branch lifecycle) were retargeted from `main` to `dev` without merging or rewriting their commits. They remain independently reviewable. No PR `dev → main` should be raised while `dev` has no ready integrated deliverable.

## Phase and release policy

- The P0 delegated evidence review can say PASS for its **specific SHA and synthetic/available evidence**; it is not proof all native AI roles meet Senior criteria, or permission for production merge.
- Separate Evolution phases continue to have explicit phase-entry/owner gates in Issue #9. Having a `dev` branch does **not** silently authorize implementation of unapproved P1–P8 work.
- Current instruction for Issue #15 is **THEORETICAL_AUDIT_ONLY**. No 33-task provider benchmark, token-intensive repeated real UAT, unbounded agents, or API subscriptions without the owner later requesting it. Static reading and cited public research are permitted.
- For future runnable changes, quality-first means appropriate tests, security, reproducibility and QA remain mandatory; the owner is deferring **expensive role-competence benchmarking**, not authorizing defective code merges.

## One orchestration owner

CompanySWAI's registered 11 roles are the sole **new-assignment** taxonomy. Retire numbered C0–C7 *as a live coordination policy immediately*: do not dispatch, create new C-lane worktrees, or revive C-lane runbooks. Actual local HBLXWeb worktree/process/branch cleanup requires the non-destructive dependency classification in Issue #13 and verification that code/history/active work is preserved. Do not delete by matching names or modify customer projects as a shortcut.

**Owner status report format:** BRANCH / SOURCE_SHA / PR / CHANGES / REVIEW / TEST_SCOPE / DEV_STATE / MERGE_MAIN=PENDING_OWNER / RISKS / NEXT_ALLOWED_ACTION. Prefer concise Vietnamese.

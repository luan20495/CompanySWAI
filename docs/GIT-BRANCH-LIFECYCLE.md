# Git branch lifecycle

Owner rule for CompanySWAI and HBLXWeb work: Phase 1, Phase 2 and all future work. It is applied at **every merge gate**. The tool is `npm run branches` (`src/branch-lifecycle.ts`, `src/branches-cli.ts`).

## The rule (owner text, verbatim in substance)

1. **MUST protect permanent branches.** `main`, `dev`, integration branches still designated active/protected by repository policy, and any other protected/release branch are NEVER auto-deleted.
2. **MUST give each new feature/fix a fresh, uniquely named branch** from the latest appropriate integration baseline (normally `origin/dev`). A previously merged branch is never recycled.
3. **MUST delete the merged feature/fix branch from remote and local when safe**, after PR/review/QA passes and the merge is VERIFIED on the target. For squash/rebase/cherry-pick, verify the integrated patch/PR and the exact intended commits; do not rely only on `git merge-base` ancestry.
4. **MUST NOT delete** unmerged branches, branches with uncommitted changes, branches checked out in any worktree or in use by an agent, branches containing unique commits, or branches with pending review/QA. Force deletion is never an automatic cleanup shortcut.
5. **MUST, before cleanup,** fetch/prune references safely and verify: PR merge state and target SHA, branch protection, worktrees, dirty state, unique commits. Remove only confirmed disposable branches. If uncertain, report BLOCKED and request operator review.
6. **MUST, after merge and cleanup, report:** source branch, target, merge commit/PR, remote deletion status, local deletion status, exceptions, next fresh branch name.
7. **MUST NOT** change main/PROD or destructively remove worktrees as part of cleanup. Phase 2 implementation starts only after the Phase 1 acceptance gates.

Agents never delete or force anything themselves; the operator runs the cleanup after a verified merge.

## Merge-gate checklist

**Before the merge**
- [ ] The branch is fresh and uniquely named, created from the latest integration baseline (`git fetch` first; normally `origin/dev`), and was not used by an earlier merged task.
- [ ] Review, QA and the project gates (`npm run check` or the project's equivalent) passed; no review/QA is pending on the branch.

**Merge**
- [ ] Record the PR and the target ref, and the target SHA after the merge.
- [ ] Ancestry merge: the branch tip is an ancestor of the target SHA.
- [ ] Squash / rebase / cherry-pick: verify the PR is merged and that the exact intended commits (or their patch) are in the target SHA. `audit` reports `MERGED_PATCH`, which is a hint only: the operator confirms the PR and commits.

**Cleanup** (operator)
- [ ] `git fetch --prune <remote>` (or pass `--fetch` to the tool).
- [ ] Not protected (`main`, `dev`, active `integration/*`, `release/*`, `prod*`, the remote HEAD target, the main worktree's branch, `--protect` patterns).
- [ ] Not checked out in any worktree and no agent is using it; its worktree is clean.
- [ ] No unique commits (`git cherry <target> <branch>` shows no `+`), and the remote tip equals the verified merged tip.
- [ ] `npm run branches -- cleanup ...` dry run reads as expected, then `--apply`. If anything is uncertain: BLOCKED, ask the operator.

**Report** (exactly these fields)
```
source branch:
target:                   <ref> (<sha>)
merge commit/PR:
remote deletion status:
local deletion status:
exceptions:
next fresh branch name:
```
`cleanup` prints this block; pass `--pr <text>` and `--next <name>` to fill the PR and next-branch lines.

## The tool

```bash
npm run branches -- audit <repoPath> --target <ref> [--remote <name>] [--protect <glob> ...] [--fetch] [--json]
npm run branches -- cleanup <repoPath> <branch> --target <ref> [--remote <name>] [--protect <glob> ...] [--fetch] [--pr <text>] [--next <name>] [--apply]
```

`audit` is read-only. It classifies every local branch and, with `--remote`, every branch of that remote:

| Status | Meaning |
|---|---|
| `PROTECTED` | `main`, `master`, `dev`, `develop`, `integration/*`, `release/*`, `prod*`, the remote HEAD target, the merge target, the main worktree's branch, or a `--protect` glob. (`hotfix/*` is an ordinary fix branch.) |
| `IN_WORKTREE` | Checked out in a worktree (path and dirty state shown). A remote branch whose local twin is in a worktree is also in use. |
| `UNMERGED` | `git cherry <target> <branch>` has a `+` line: unique commits. |
| `REMOTE_DIVERGED` | Local and remote tips differ and the other tip is not merged. |
| `MERGED_PATCH` | Not an ancestor, but every commit is patch-equivalent in the target (all `-`). Needs operator review. A multi-commit squash is not patch-equivalent per commit and shows as `UNMERGED`. |
| `DISPOSABLE` | Tip is an ancestor of the target, not protected, not in a worktree, and the other tip (if any) is merged too. |

`MERGED_ANCESTRY` and the other merge facts are listed as tags next to the primary status. Exit code is 0.

`cleanup` re-runs the same checks for the one branch you name. It is a **dry run unless `--apply`**. With `--apply` it acts only if the branch is `DISPOSABLE`:

1. confirms the live remote tip (`git ls-remote`) still equals the verified merged tip (a stale tracking ref blocks);
2. `git branch -d <branch>` (lower-case; if git refuses: BLOCKED, never retried with `-D`);
3. `git push <remote> --delete <branch>`.

Exit codes: `0` done or dry run, `3` BLOCKED (nothing deleted), `2` usage error (unknown branch, ref, remote or bad arguments).

**Guarantees.** The tool never force-deletes (no `-D`, no `--force`), never removes or prunes a worktree, never touches a protected branch even with `--apply`, never changes your checkout, never acts on a branch you did not name, and defaults to a dry run. A `MERGED_PATCH` branch is reported `BLOCKED: patch-merged: needs operator review`; deleting it is a deliberate manual decision after verifying the PR and commits. `main`/PROD are never modified.

# Brownfield takeover

CompanySWAI agents are text-in/text-out: they never read a workspace. A takeover therefore has two halves — the engine reads the
repository read-only and builds an evidence pack, and the company's roles reason over that pack through the normal runtime.
The engine, not the model, decides what the evidence supports.

```
npm run takeover -- run <workspace> --project <id> [--focus "topic"]... [--runtime file] [--max-parallel N]
npm run takeover -- run <workspace> --project <id> --dry-run     # snapshot + plan only; no model call, no state written
npm run takeover -- status [id]   |   report <id>   |   approve <id> [--by name]
npm run operator -- takeover [id]                                 # read-only view, no engine needed
```

## Pipeline
1. **Snapshot** (`src/takeover-probe.ts`). Fixed read-only git subcommands only (`rev-parse ls-files ls-tree log rev-list remote -v
   for-each-ref worktree list cat-file merge-base --is-ancestor`); anything else, `--output`, `--filters`, `-m` and `--show-signature`
   are refused. There is deliberately no `status`/`diff`: they run `filter.*.clean` drivers (and LFS) from the repository. Global and
   system git config are ignored; fsmonitor, hooks, attributes files and signature verification are switched off, and
   `GIT_OPTIONAL_LOCKS=0` keeps git from refreshing the index. Dirtiness is computed here from raw file bytes. The audited files are the
   **HEAD tree** (staged-only files are not evidence), read as committed blobs (uncommitted edits are listed, never read). Sensitive paths
   (`.env*`, keys, `*secret*`, `*credential*`) are never read; excerpts are sanitised, then scrubbed of token shapes and
   `password/secret/token/api_key = value` assignments. The workspace must be the repository root.
2. **Fingerprint before**: HEAD, branch, refs, index bytes, staged changes, raw hash of every tracked file, untracked file contents,
   ignored files (name, size, mtime; the inside of ignored directories such as `node_modules` is not hashed), `.git` layout, config, hooks
   and `info/` (also the common dir of a linked worktree; `FETCH_HEAD` is ignored as volatile), worktrees.
3. **Analysis** through `ProjectOrchestrator` with a plan that has **no workspace**: `takeover-architecture` (tech-lead),
   `takeover-claims` (business-analyst), `takeover-verification` (qa-engineer), then `takeover-classification` (product-lead) reviewed by
   the independent reviewer. Skills are injected by the normal resolver and traced; every execution record keeps its `skillTrace`.
   Finished roles are not re-run on resume; a repository that moved while parked cannot continue on its stale snapshot.
4. **Evidence rules** (`src/takeover-evidence.ts`). Agents cite paths; the engine resolves each citation against the snapshot (tracked
   path, directory of at most 80 files, or a commit in the log), derives the evidence class from the path, and applies:
   - `DONE` needs implementation source **and** test source, cited separately (one broad directory cannot vouch for both); with only one of them it becomes `PARTIAL`; with documents/history/config alone, `UNKNOWN`. Test source means test code: fixtures, snapshots, mocks and spec documents are not tests.
   - `PARTIAL` needs source, test or configuration/migration evidence; `NOT_DONE`/`BLOCKED` need at least one valid citation (documents suffice, flagged CLAIMED).
   - Discarded citations are listed on the item. Requested `--focus` areas nobody covered are added as `UNKNOWN`.
   - Evidence priority: executed results > source > git history > CI > config/migrations > documents > status prose. An audit executes nothing, so without recorded runs no item is `EXECUTED` and a `DONE` is a **static** finding (see "Executed evidence" to record runs of the exact commit).
5. **Fingerprint after** and comparison. Any difference makes the audit `TARGET_CHANGED` (the cause may be external — the audit only runs
   read-only commands and gives agents no access) and it can never be approved.
6. `AUDIT_COMPLETE_WAITING_APPROVAL`, with `TAKEOVER-REPORT.md` (proof table, limits, counts, remaining work by P0–P3, critical path).

## Executed evidence (verified audit)

An audit executes nothing. To get a classification that rests on runs, run the gates yourself, **record them before `run`**, then audit under a new project id:

```
npm run takeover -- evidence junit  <project> --dir <workspace>/backend/build/test-results/test --module backend/ --commit <40-hex audited HEAD>
npm run takeover -- evidence add    <project> --name "frontend gate" --commit <sha> --outcome PASS|FAIL|NOT_RUN --command "npm run gate:frontend" --summary "GATE GREEN" --log gate.log
npm run takeover -- evidence list   <project>
npm run takeover -- run <workspace> --project <project> --focus ...
```

- Records are the **operator's**, not the engine's: the engine does not re-run them and does not keep the logs; it keeps each log's sha256 (for JUnit, of the XML), binds every record to one commit, and ignores records for any other commit (the report counts them). Results produced by the audited repository's own build are only as trustworthy as that repository. Commits are 40-hex (SHA-1) ids.
- A record is identified by commit and id. Recording the same id for the same commit again with a different result is refused unless `--replace`; a run for another commit never replaces this one. A record cannot contradict its counts (PASS with failures, or with no test run).
- `junit` reads `TEST-*.xml` itself, one record per suite and `--module` (the test module prefix; the same class name in two modules is two results): `FAIL` on any failure/error (attribute or element; comments and CDATA ignored), `PASS` only when tests ran and nothing failed, `NOT_RUN` when everything was skipped or the counts cannot be read. A cited test file counts when the class its path declares passed in its module (`backend/src/test/kotlin/a/b/FooTests.kt` -> module `backend/`, class `a.b.FooTests`); a cited test **directory** counts only when every JUnit test file under it ran and passed (failed -> FAIL, otherwise NOT_RUN with "k of N").
- Gates are cited by the agents as `exec:<id>` (`exec:gate:frontend-gate`); an unknown id is discarded like an unknown path. A `NOT_RUN` gate is a valid citation for `BLOCKED` / `NOT_DONE`, never for `DONE`.
- With any record for the audited commit the audit is *verified*: a `DONE` needs a cited **test** file or directory with an executed PASS (a gate alone says nothing about one item), and a cited FAIL forbids `DONE`. The engine does not look up failing classes the agent did not cite; the pack lists the failed classes so the agents and the reviewer can see them. Items then carry `STATIC` or `EXECUTED`.
- The pack also lists every implementation file (`SOURCE FILES`), so an agent can cite source for a `DONE`.
- The set is frozen with the snapshot (`executed-evidence.json`, its hash is in the record). A resumed audit whose frozen set is missing or edited becomes `AUDIT_INVALID`. It is shown in the report under "Executed evidence".

## Approval and the write gate
`approve` is the user's explicit go-ahead; it also requires the target to still be at the audited commit. `runAutonomous` runs the
takeover gate by default (so `company`, operator `resume` and the benchmark are all covered): a plan whose workspace has a takeover
(symlinks resolved; a subdirectory or parent counts as the same workspace) parks at EXECUTE with no model call until that takeover is
`APPROVED_FOR_EXECUTION`; an approved takeover also requires the workspace to still descend from the audited commit; and a plan tagged
`brownfield` with no takeover at all is refused. Anything else is not affected.

## State
`.companyswai/takeover/<id>/`: `record.json`, `snapshot.json`, `plan.json`, `fingerprint-before.json`, `fingerprint-after.json`,
`classification.json`, `TAKEOVER-REPORT.md`. Statuses: `AUDITING`, `AUDIT_COMPLETE_WAITING_APPROVAL`, `APPROVED_FOR_EXECUTION`,
`AUDIT_INVALID`, `TARGET_CHANGED`. A finished, invalid or changed audit is final: audit again under a new project id.

## Limits
- No test, build, migration or script of the target runs, so runtime behaviour is not verified.
- The classification quality is that of the model reading the pack; the engine bounds it (citations, downgrades, reviewer) but cannot make it complete. Large repositories are represented by bounded lists and excerpts.
- Git history is limited to the last 200 commits.
- The takeover records live in the state directory (`--state-dir`, default `.companyswai` in the current directory). A plan run with a different state directory does not see them, so use one state directory per operator.
- The newest takeover of a workspace decides the gate: a newer unfinished or invalid audit blocks an older approved one until it is resolved.
- "Differs from the index" compares raw bytes, so a repository that relies on line-ending conversion or clean filters lists such files as modified; this only affects the report, not safety.

# Static capability audit — 11 native CompanySWAI roles (theory only)

**Stacked on PR #16.** This document extends `docs/audits/SENIOR-ROLE-CAPABILITY-FRAMEWORK.md` (PR #16, branch `docs/senior-capability-dev-governance`) and must be reviewed/merged after it. All `file:line` citations are at source SHA **`f71b8b4f5a5dc91e7284fd745ba7386539ddcf72`** (PR #16 head when this audit was written); `SRC` below means that SHA. PR #16 is merged into `dev` (`92075aa`); `src/`, `agents/`, `skills/`, `company/` and `config/` are byte-identical at `SRC` and `dev` `92075aa`, so every citation also holds on `dev`. Audit date 2026-10-14. Issue: #15.

**Method and limits.** Static reading of the repository plus a handful of deterministic calls of pure functions (`computeFinalStatus`, `SkillCatalog.load`, `ProjectPlan.parse`) through `tsx`. NO provider/model call, NO benchmark, NO run of the company CLI, NO browser, NO network use except reading the public standards pages listed in section 6. Nothing here certifies any role. **All 11 roles remain `CONFIGURED` + `EXECUTION_UNTESTED`.**

**Skill status ladder (never skip a rung without evidence):** `REGISTERED` (file loads and passes `validateSkill`) → `ELIGIBLE` (role is in `appliesTo`) → `MATCHED` (a task signal fired, policy allowed) → `INJECTED` (text reached the system prompt; this is what `skillTrace.used` records) → `EXECUTED` (the agent demonstrably followed it, or a gate/tool the skill describes actually ran) → `MEASURED_VALUE` (a controlled comparison shows benefit). Evidence available today: REGISTERED and ELIGIBLE (static). MATCHED/INJECTED are plan-dependent and UNKNOWN without a concrete brief. No role/skill pair has EXECUTED or MEASURED_VALUE evidence.

**Document map.** 1 Factual findings (cited) · 2 Role matrix (11 blocks) · 3 Inferred gaps · 4 Future proposals (separate dev PRs, nothing implemented here) · 5 Required-outcome contract · 6 Standards and verification status · 7 UNVERIFIED / UNKNOWN list.

---

## 1. FACTUAL FINDINGS (each cited at SRC)

**F-01 — QA false acceptance under a supplied plan (P0, verified by deterministic call).**
- `computeFinalStatus` derives `qaTask` only from `t.contract.validators.includes("qa-traceability")` and `highRisk` only from `t.review?.level==="HIGH_RISK"` (`src/final-status.ts:13`). QA status comes from the persisted trace (`:14`), and the only path that fails an unrecognised QA is `highRisk&&(NOT_RUN||!qaTask)` (`:25`).
- The verdict is parsed and stored only when the task's contract carries the validator (`src/runner.ts:132-136`); contract validators are copied from the plan (`src/orchestrator.ts:205`). A plan supplied whole (`runAutonomous({plan})`, `src/autonomous.ts:51,73`; CLI `src/company-cli.ts:38`) is validated only by `ProjectPlan.parse` (structure) and `ProjectOrchestrator.validate` (ids, deps, acyclic, reviewer role ≠ maker role; `src/orchestrator.ts:133-147`). Nothing requires a QA task, the validator, a review, or even a known role name (`src/project.ts:45,65`; probe H below).
- Deterministic results (script in the audit session, `computeFinalStatus` with an empty trace):
  - A: supplied plan, `qa-engineer` task WITHOUT `qa-traceability`, no HIGH_RISK review → **`ACCEPTED`, risks `[]`, qa `NOT_RUN`**.
  - B: same plan shape WITH the validator and a stored FAIL → `FAILED_QA` (planner-style plans are safe; confirms PR #16 wording).
  - C: supplied plan with no QA task, code task, no workspace → `ACCEPTED_WITH_RISKS` only because of the "no workspace" risk line (`src/final-status.ts:30`).
  - D: HIGH_RISK review present but QA lacks the validator → `INCOMPLETE` (safe only because HIGH_RISK was declared by the plan author).
  - E: validator removed on `--replan` but a FAIL already stored → still `FAILED_QA` (stored trace wins; `:14,23`).
  - G: `mode:"MAX_QUALITY"` supplied plan with one maker, no review, no QA, no gates → **`ACCEPTED`** with reason text "every task completed and reviewed" (`src/final-status.ts:38`, the string is unconditional).
  - H: `review.role:"any-string"` parses (no check that the reviewer is a registered `mode: reviewer` agent).
- **Observed historically, not only possible (aggregate, public):** the Phase 0 baseline replay on `dev` (`docs/evolution/phase-0/BASELINE.md`, claims C1/C3 and finding 2) reports 340/341 runs with a plan supplied whole, 113 of 114 QA-role tasks without `qa-traceability`, and 20/20 runs whose QA task reported FAIL or BLOCKED ending `ACCEPTED`. No private run data is used here.
- **Other paths checked for the same hole:**
  - *Operator resume* (`src/operator-commands.ts:121`) runs the stored plan with `resumeStored:true`, which also skips the input-hash guard (`src/autonomous.ts:65`); a hand-edited stored `plan.json` therefore gets the same weak validation.
  - *Operator priority change* (`src/operator-commands.ts:147-152`) cannot weaken QA (shape check covers id/role/deps only, validators untouched). Safe.
  - *`--replan` with a supplied plan* (`src/autonomous.ts:66,73`) replaces the stored plan; finished tasks stay finished by task id (`src/orchestrator.ts:94-117`, no spec hash), so a changed prompt/system for a completed task is not re-run (see I-03).
  - *Takeover* (`src/takeover-plan.ts:59-81`) is a different flow: no workspace, `qa-engineer` task has `validators:[]` (`:62`), final verdict is the engine-assessed classification (`src/takeover.ts:70`) not `computeFinalStatus`; it is not a QA-acceptance path. Only the last task is reviewed (`:73-77`).
  - *Planner-compiled plans*: `qa-engineer` has `activation: always` and carries the validator (`agents/qa-engineer/IDENTITY.md:6`, `RULES.md:7`), so brief-compiled plans always contain a QA gate.

**F-02 — Reviewer independence is a role label plus a fresh prompt, nothing more (P0/P1).**
- Enforced: `task.review.role !== task.agentRole` (`src/orchestrator.ts:138`). Each call is a fresh `{system,prompt}` request (`src/runner.ts:58-63,90`); the reviewer prompt omits the maker's reasoning/preamble (`src/context.ts:62-66`) but **does include every section the maker wrote, including its own `## Evidence`, `## Decisions`, `## Handoff`** (`:64-66`, comment says so deliberately).
- Not enforced: different provider/model/profile. A review's model request is built by `requestFor(review, tried)` and `tried` only lists failed profiles (`src/orchestrator.ts:148-150,246,428`); `ReviewSlot` has no `provider/model` field (`src/project.ts:24`) and the planner sets none (`src/work-planner.ts:105`). Under `QUALITY_FIRST` the ranking is tier→health→cost→context (`src/capacity.ts:79`), so maker, reviewer and both CRITICAL slots will normally resolve to the same top-tier profile.
- The only reviewer is the single `reviewer` role for every maker (`reviewedBy: reviewer` in 8 RULES files; `researcher` and `qa-engineer` have `reviewedBy: none`: `agents/researcher/RULES.md:5`, `agents/qa-engineer/RULES.md:5`).
- Positives: unparseable verdict → `CHANGES_REQUIRED` (fail closed, `src/orchestrator.ts:105,414`); per-slot parallel fresh contexts (`:422-430`, `src/context.ts:69`).

**F-03 — Integration happens BEFORE review (P0 for governance).**
- `TaskRunner.finalize` applies `parseFilePatches` output and runs gates/integration inside the maker step (`src/runner.ts:168-174`); `applyCode` either writes+commits in the workspace (`:161`) or cherry-picks a worktree commit into the main workspace (`:159`, `src/worktrees.ts:85-92`). Review starts only afterwards (`src/orchestrator.ts:407-430`). A `CHANGES_REQUIRED` produces a further patch on top; `ReviewExhaustedError` (`:411`) fails the task but the first commit is not reverted (only a failed integration gate reverts: `src/worktrees.ts:98-100`).
- Mitigation that DOES exist: downstream tasks (including QA) wait until the task is `complete`, which requires all review slots PASS (`src/orchestrator.ts:114`). So *review-before-downstream* holds; *review-before-integration* does not. Architecture (`tech-lead`) review does precede implementation start (non-code, no patch step).

**F-04 — Six non-code roles can write files with no gate; two of them with no review either (P1).**
- Mechanism: `finalize` parses and applies ```` ```file ```` blocks for **every** maker whenever `patches.length` and a workspace exist (`src/runner.ts:168-173`). `resolveGates` returns `{gates:[],integration:[]}` when `deliversCode===false` and no required gates (`:148`): no gate and not even the `project-checks` integration run. `requiredGates` and the `code-delivery` validator are set only for `deliversCode` agents (`src/work-planner.ts:79,110`). The blocks are path-confined (`src/repo-workspace.ts:49-61`).
- `deliversCode` defaults to `false` (`src/md-agent-loader.ts:22`) and is `true` only for backend-engineer, frontend-engineer, mobile-engineer and devops-sre (`agents/<role>/RULES.md:6`). So the **ungated** set is six makers: `product-lead`, `business-analyst`, `researcher`, `tech-lead`, `ux-ui-designer`, `qa-engineer`.
- The **ungated and unreviewed** subset is `researcher` and `qa-engineer` (`reviewedBy: none`). The other four are reviewed, but their files are applied (and committed when `autoCommit` or worktree isolation is on) before the review runs (F-03), so review cannot stop them landing; a later `CHANGES_REQUIRED` only adds another patch.

**F-05 — Who runs gates/scanners (answer to (d)).**
- Native agents have no tools: `claude-code` provider launches `claude -p ... --tools ""` in an empty scratch dir (`src/providers/claude-code.ts:35,60`); `docs/SKILLS-AUDIT.md` §0 states "text-in / text-out model calls with no tools".
- Gates are commands declared by the project brief/plan (`workspace.gates`, `src/project.ts:68-80`), executed by the engine with `execFile` on the host: executable name must match `^[A-Za-z0-9._-]+$` and contain no path separator (`src/project.ts:68`, `src/repo-workspace.ts:92`), env stripped of secret-named variables (`:95`, `src/secrets.ts:37-44`), 5-min default timeout, no container/OS sandbox. They execute model-authored code and tests (`npm test` etc.) on the operator machine.
- The gate catalogue is `typecheck, unit-tests, integration-tests, lint, build, security, project-checks` (`company/GATES.md:2-9`). There is **no e2e, accessibility, visual, load, migration-dry-run or deploy-smoke gate**. `security` applies only with capability `security-critical` (`:7`) and is required only in MAX_QUALITY (`company/POLICY.md:26`). A required gate with an empty command list is "declared not applicable" (`src/repo-workspace.ts:78`).
- Scanner/browser skills only *describe* tools: `tool-probe.ts` detects binaries on PATH and never runs them (`src/tool-probe.ts:3-6`); `e2e-browser-testing` has `requiresBrowser: false` while listing `playwright-cli` as an external binary (`skills/dynamic/e2e-browser-testing.md:18-19`), so it can be injected into a web-ui QA/frontend prompt with no tool able to execute it. Browser skills are skipped only when `requiresBrowser: true` and the brief lacks `browser-operation` (`src/skill-selector.ts:78`) — no registered skill sets that flag.
- Operator-recorded executed evidence exists only for takeover (`src/takeover-exec.ts:16-39`, frozen with `execHash`, bound to a commit); there is no equivalent for QA/DEV deploy/browser evidence in normal projects.

**F-06 — QA evidence strength.**
- `qa-traceability` checks structure: IDs known, `| evidence:` text present for PASS/FAIL, status line agrees with test results, `minTests` per depth, FAIL names an upstream owner (`src/validators.ts:79-102`). It does **not** check that the cited evidence exists in the runtime evidence the engine showed QA (`:90`: presence only). QA "cannot run code" and relies on `RUNTIME TEST EVIDENCE` (`agents/qa-engineer/RULES.md:40-41`, `src/context.ts:50`), which exists only for code tasks with a workspace.
- Gate PASS is also weaker than it looks: a gate runs the test commands the brief configures over whatever tests the workspace holds (`src/runner.ts:144-152`). Nothing requires tests written or reviewed independently of the maker, and test authorship is not recorded, so the audit cannot say who wrote them (UNKNOWN per run). When the only tests are ones the maker emitted, a gate PASS is self-verification. There is no seeded-defect, mutation or coverage-threshold gate in `company/GATES.md`.

**F-07 — Quality-shortfall routing is not reflected in the final status (P1).**
- When no profile meets `minQualityTier` the selector drops the floor and flags `qualityShortfall` (`src/provider-selector.ts:73-74,90`); the orchestrator emits an event and a memory status (`src/orchestrator.ts:280`). `computeFinalStatus` is meant to turn this into a risk by scanning `record.evidence` for "quality tier" (`src/final-status.ts:35-36`), but record evidence is populated only from workspace gate output (`src/runner.ts:173`); a grep of `src/` finds no writer of that string into records. Static conclusion: the risk line is very likely unreachable, so a MAX_QUALITY run can silently execute on a lower tier and still end `ACCEPTED`. (Not executed; marked "static".)
- `config/providers.json` is git-ignored (`.gitignore:5`); the repo ships only `config/providers.example.json`, where only `claude-code-team` declares `qualityTier: 4`. Three profiles advertise the same eight capabilities; `local-compatible` omits `deployment` (`config/providers.example.json:64,69-77`). Eligibility requires every requested capability (`src/capacity.ts:37`), so in the example a `devops-sre` task (`reasoning, deployment`) cannot route to `local-compatible`, while the other roles' `modelCapabilities` do not discriminate between profiles. The real production routing table is **UNKNOWN**.
- Quality floor is per mode, not per role: FAST 1 / BALANCED 3 / MAX_QUALITY 4 (`company/POLICY.md:16,21,26`); a documentation task and a security review get the same tier.

**F-08 — Skill selection facts (cross-checked, the PR #16 table is correct).**
- 25 dynamic skills load and validate; per-role eligible counts re-derived with `SkillCatalog.load`: product-lead 3, business-analyst 3, researcher 3, tech-lead 15, backend 11, frontend 8, mobile 9, ux-ui-designer 4, reviewer 20, qa-engineer 16, devops-sre 10 — identical to the PR #16 table.
- Maker cap 4 (`src/skill-selector.ts:20`); reviewer cap 5 / 9000 chars (`src/work-planner.ts:44,91`). **The reviewer's ELIGIBLE set (20) is not its candidate set**: the planner only passes skills the maker already carries, `reviewMethod` skills, or reviewer-only skills (`src/work-planner.ts:90`), so reviewer MATCHED ⊆ maker skills ∪ {code-review, verification-before-completion, security-review}.
- Permanent skills are single short paragraphs of 203–295 characters each (`skills/*.md`, total 2,628 chars for 11 files). No permanent or dynamic skill file mentions ASVS, ISTQB, IREB, SRE, DORA or ISO 25010; only `accessibility.md` names WCAG 2.2 AA and `security.md` names "OWASP Top 10 classes" (grep over `skills/`, `company/`).
- `minComplexity` gates `distributed-systems` at 5 (`skills/dynamic/distributed-systems.md:8`).

**F-09 — Learning loop facts (answer to (e)).**
- Candidates are produced from a closed set of fixed template strings (`src/retrospective.ts:36-45,69-78`): failures, capacity, cost estimate, contract violations, per-role / per-skill / per-domain "repeated CHANGES_REQUIRED". No model-authored free text enters company experience. The generic "clean" lesson is never injected (`src/plan-compiler.ts:7,15`).
- Promotion: ≥2 distinct project ids, confidence ≥0.6, evidence present, passes `rejectionReason` (temporary-provider, weakening-intent, project id/URL/path/secret filters; `src/company-experience.ts:36-54,94-98`, `company/LEARNING.md:11-18`); protected-topic patterns wait for a person (`src/company-experience.ts:97`); a human decision is never overturned by later observations (`:90`).
- Injection: all `VALIDATED` lessons whose scope matches the role/skill/domain are appended to maker and reviewer system prompts **only for brief-compiled plans** (`src/plan-compiler.ts:46,50-51`, `src/autonomous.ts:70-72`); supplied plans get none (`src/plan-provenance.ts:3-8`). There is no cap on the number of lessons injected.
- No input from QA FAIL, defect escape, final status or reviewer-found defects (only counts of `CHANGES_REQUIRED`). There is no command to revoke a `VALIDATED` item (`decide` works only on `PENDING_APPROVAL`, `src/company-experience.ts:105-111`; CLI `src/experience-cli.ts`).

**F-10 — Structured-contract validators that DO exist** (the strongest current safeguards): `research-evidence` (`src/validators.ts:18-64`), `requirements-ids` (`:66-77`), `qa-traceability` (`:79-102`), `architecture-review` (`:104-117`), `code-delivery` (`:119-122`). No validator exists for `product-plan`, `design-spec`, `implementation` content, `deployment`, `review`, or `technical-plan`.

---

## 2. ROLE MATRIX (11 roles)

Legend. *Files*: `agents/<role>/IDENTITY.md` + `RULES.md`. *Perm.* = permanent skills (`skills/<id>.md`, always in the system prompt via `systemPromptFor`, `src/md-agent-loader.ts:87-89`). *Elig.* = dynamic skills by `appliesTo` (full list in the PR #16 table; counts re-verified in F-08). *Senior standard* = SFIA 9 Level 5 (autonomy, influence, complexity, knowledge, business skills — attribute headings verified) plus the domain source. *Outcomes* = artifacts a Senior would be accountable for; **bold** = not currently enforced by any validator/gate (see section 5). *Priority* = P0 governance integrity … P3 optimisation. State for every row: **CONFIGURED + EXECUTION_UNTESTED**.

### 2.1 product-lead
- **Files:** dept `product`, mode maker, activation `always`, stage 10, `requires: []`, produces `product-plan`, `reviewedBy: reviewer`, no validators, no extra sections, `deliversCode` false. Model capabilities `reasoning, product`.
- **Perm.:** `requirements-analysis`, `research-evidence`. **Elig. (3):** knowledge-matrix, ux-research, web-research (web-research needs a connector: `requiresNetwork: true`, `skills/dynamic/web-research.md:16`).
- **Senior standard:** SFIA 9 L5 + REQM (scope, specification, prioritisation for large initiatives; verified). SFIA product-management skill mapping not fetched → UNVERIFIED.
- **Outcomes:** `product-plan` with **problem/value statement, in/out-of-scope, outcome metrics with owner, prioritised backlog with rationale, open questions list, decision log, "UNKNOWN" labelling for unsourced facts**.
- **Actual vs missing:** text-only; no user data, no discovery loop; the contract enforces common sections only. Review is policy-dependent (FAST skips medium-risk, `company/POLICY.md:14`). Can write files with no gate; they land before review (F-03/F-04).
- **Severity:** P2 (upstream of everything, but failure is caught later by BA/QA if those gates hold).
- **Recommend:** `product-plan` validator mirroring `requirements-ids` (stable `OUT-n` outcome ids, non-goals present, every FACT carries `(basis: brief|S#)`); BA must cite `OUT-n` so scope drift becomes mechanically visible.

### 2.2 business-analyst
- **Files:** dept `product`, maker, `always`, stage 20, `requires: product-plan`, optional `research`, produces `requirements`, `reviewedBy: reviewer`, validators `requirements-ids`, extra section `Requirements`.
- **Perm.:** `requirements-analysis`. **Elig. (3):** knowledge-matrix, ux-research, web-research (not `api-quality`, not `verification-before-completion`).
- **Senior standard:** SFIA 9 REQM L5 + IREB CPRE (syllabus/handbook pages listed on the IREB download page; **content not read → mapping UNVERIFIED**).
- **Outcomes:** `requirements` with stable `REQ-`/`AC-` ids (enforced), basis labels (enforced), plus **separate NFR set (security, privacy, performance, availability, accessibility, multi-tenant permission matrix), measurable thresholds, edge/negative cases per REQ, a requirements→source trace, change log without renumbering**.
- **Actual vs missing:** validator checks ids, ≥1 AC, FACT has a basis (`src/validators.ts:66-77`) but not that ACs are testable (Given/When/Then is only suggested in the message), that NFRs exist, or that thresholds are numeric. QA coverage is defined by this artifact (`src/orchestrator.ts:180`), so a thin requirement set makes QA PASS easy. Can write files with no gate; they land before review (F-03/F-04).
- **Severity:** P1.
- **Recommend:** extend `requirements-ids` (new validator, not a silent change): AC regex for Given/When/Then, `NFR-` namespace with a minimum category checklist driven by brief capabilities, numeric-threshold lint; add a `requirements` review lens in `company/GATES.md`.

### 2.3 researcher
- **Files:** dept `product`, maker, `complexity>=3`, stage 15, produces `research`, **`reviewedBy: none`**, validators `research-evidence`, sections `Sources, Claims, Conflicts`.
- **Perm.:** `research-evidence`. **Elig. (3):** knowledge-matrix, ux-research, web-research.
- **Senior standard:** SFIA 9 L5; research method is source-dependent (no SFIA skill verified).
- **Outcomes:** `research` with cited FACTs, ASSUMPTION/INFERENCE/RECOMMENDATION labels, listed conflicts (all enforced), plus **verification that `brief:`/`repo:` references point to real content**.
- **Actual vs missing:** strongest contract in the company. External URLs must be among connector-retrieved documents (`src/validators.ts:27-28`, `src/orchestrator.ts:183-200`) so an offline agent cannot invent web sources. Gap: a `brief:`/`repo:` source is accepted by regex only (`:25-26`) — a fabricated repo reference passes. Unreviewed (F-04: may also write files if a workspace exists).
- **Severity:** P2.
- **Recommend:** validate internal references against a manifest the engine builds from the brief/repo; add a review for high-risk research; set `deliversCode:false` enforcement (see P-05).

### 2.4 tech-lead
- **Files:** dept `architecture`, maker, `always`, stage 30, `requires: requirements`, optional `research`, produces `architecture, technical-plan`, `reviewedBy: reviewer`, `reviewLens: architecture`.
- **Perm.:** `architecture-system-design`, `engineering-fundamentals`, `independent-review` (author holds the review-method skill; harmless but blurs the role boundary). **Elig. (15):** api-quality, backend-reliability, database, devops, distributed-systems(minComplexity 5), knowledge-matrix, migration-review, mobile-native, observability, performance, security-review, security, skill-development, verification-before-completion, web-research.
- **Senior standard:** SFIA 9 L5 (complexity/influence) + PROG (technical direction, verified); ISO/IEC 25010:2023 for quality attributes (the page confirms "nine characteristics"; **the characteristic names were not retrievable → UNVERIFIED**); Google SRE book part II (Embracing Risk, SLOs, Release Engineering; chapter titles verified).
- **Outcomes:** `architecture` + `technical-plan` with enforced per-category review (`architecture-review`, `src/validators.ts:104-117`) and **ADR list with ids traced to REQ ids, interface/data contracts, threat model table, failure-mode and rollback table, SLO/capacity numbers, migration plan, acyclic task decomposition with owners**.
- **Actual vs missing:** the only role with a structured review lens; the lens verdict is still one model reading prose. The review does precede implementation (non-code step, F-03 note). No required artifact for threat model/ADR/rollback. Can write files with no gate; they land before its review (F-03/F-04).
- **Severity:** P1 (gates every code task).
- **Recommend:** extend the architecture contract with machine-checkable sections (`## ADRs` with `ADR-n -> REQ-n`, `## Failure Modes`, `## Rollback`, `## SLOs` numeric) and persist them in the trace store beside `addArchitectureReview`.

### 2.5 backend-engineer
- **Files:** dept `engineering`, maker, `capability:backend`, stage 50, `requires: requirements, architecture`, produces `implementation`, `reviewedBy: reviewer`, **`deliversCode: true`**, `code-delivery` added when a workspace exists (`src/work-planner.ts:79`).
- **Perm.:** `engineering-fundamentals`, `backend-engineering`. **Elig. (11):** api-quality, backend-reliability, database, distributed-systems, fuzz-property-testing, migration-review, observability, performance, security, testing, verification-before-completion.
- **Senior standard:** SFIA 9 PROG L5 (verified); OWASP ASVS 5.0 (repository path confirmed, version 5.0.0 PDF present; **requirement chapters not read → control mapping UNVERIFIED**).
- **Outcomes:** compiling code + tests that pass required gates (enforced when a workspace is configured, `src/runner.ts:144-153`), plus **authz/tenant-isolation tests, migration forward/rollback evidence, concurrency/idempotency tests, dependency/secret scan output, API contract test, load/latency evidence**.
- **Actual vs missing:** no tools; gates are only as strong as the configured commands; independent tests are not required and authorship is not recorded (F-06); gates run unsandboxed on the host (F-05); `security` gate only for security-critical projects. Review sees emitted patches, not the surrounding repo (I-02). Code lands before review (F-03).
- **Severity:** P0 (F-03 ordering), P1 (gate sandbox / no independent-test requirement).
- **Recommend:** see P-02, P-03, P-06; add `migration-dry-run` and `sast`/`dependency-scan` gates selectable by capability.

### 2.6 frontend-engineer
- **Files:** dept `engineering`, maker, `capability:web-ui`, stage 50, `requires: requirements, architecture, design-spec`, produces `implementation`, reviewed, `deliversCode: true`.
- **Perm.:** `engineering-fundamentals`, `frontend-engineering`, `ux-ui-quality`. **Elig. (8):** accessibility, e2e-browser-testing, frontend-performance, fuzz-property-testing, performance, security, testing, verification-before-completion.
- **Senior standard:** SFIA PROG L5; WCAG 2.2 (**W3C page returned HTTP 403 to the fetch tool → content UNVERIFIED here; `skills/dynamic/accessibility.md` already targets "WCAG 2.2 AA"**); Apple HIG applies to Apple-platform web views only.
- **Outcomes:** built UI plus **Playwright report, axe/Lighthouse JSON, screenshots at breakpoints (hash-bound), keyboard-only walkthrough record, bundle/INP budget numbers**.
- **Actual vs missing:** the catalogue has no e2e/a11y/visual gate (F-05); `e2e-browser-testing` is injectable without any tool to run it (F-05); QA can only read gate output. Native agents cannot look at a rendered page.
- **Severity:** P1.
- **Recommend:** P-04 (executable evidence harness) + two optional catalogue gates `e2e` and `a11y` for `capability:web-ui` in MAX_QUALITY.

### 2.7 mobile-engineer
- **Files:** dept `engineering`, maker, `capability:mobile`, stage 50, requires requirements/architecture/design-spec, produces `implementation`, reviewed, `deliversCode: true`.
- **Perm.:** `engineering-fundamentals`, `mobile-engineering`, `ux-ui-quality`. **Elig. (9):** accessibility, android, flutter, ios, mobile-native, performance, security, testing, verification-before-completion.
- **Senior standard:** SFIA PROG L5; Android core app quality (verified categories: User experience, Functionality, Performance and stability, Privacy and security, Google Play; it also publishes a test catalog mapping guidelines to procedures); Apple HIG (**page body not retrievable → UNVERIFIED**).
- **Outcomes:** buildable app + **instrumented/emulator test results, startup/frame/ANR measurements, permission/privacy manifest review, offline/reconnect test, release-build evidence**.
- **Actual vs missing:** `build` gate applies to mobile (`company/GATES.md:5`) but needs the toolchain on the host; no device/emulator or store-readiness gate; text agent cannot observe lifecycle behaviour.
- **Severity:** P1 (blocked on harness, P-04).
- **Recommend:** operator-run device/emulator harness ingested as hash-bound evidence (P-04); add the Android test-catalog procedure ids as QA trace targets.

### 2.8 ux-ui-designer
- **Files:** dept `design`, maker, `capability:web-ui|mobile`, stage 40, requires requirements + architecture, produces `design-spec`, reviewed, no validators, `deliversCode` false.
- **Perm.:** `ux-ui-quality`, `requirements-analysis`. **Elig. (4):** accessibility, frontend-performance, mobile-native, ux-research (not knowledge-matrix).
- **Senior standard:** SFIA UX design (HCEV) L5 (verified: plan/lead UX design, rapid iterative cycles); WCAG 2.2 (UNVERIFIED here); Apple HIG/Android guidelines for platform conventions.
- **Outcomes:** `design-spec` with **screen/state matrix (default, empty, loading, error, offline, permission-denied) per REQ, token table, component inventory, responsive breakpoints, WCAG success-criterion list per screen, prototype or screenshot evidence**.
- **Actual vs missing:** pure text; no canvas, no vision loop, no validator (F-10). A Markdown spec is not visual evidence. Can write files with no gate; they land before its review (F-03/F-04).
- **Severity:** P2 (P1 if UI quality is a headline claim).
- **Recommend:** `design-spec` validator for the state matrix and `REQ`-trace; screenshot evidence from an operator/harness path only; do not claim visual QA from native output.

### 2.9 reviewer
- **Files:** dept `quality`, mode **reviewer**, `always`, stage 60, produces `review`, `reviewedBy: none`, verdict discipline in RULES (blockers = defects, complete first round, re-review verifies own findings).
- **Perm.:** `independent-review`, `engineering-fundamentals`. **Elig. (20)** (see F-08: candidate set is narrower).
- **Senior standard:** SFIA 9 L5 + PROG/TEST review; ASVS for security lens (UNVERIFIED mapping).
- **Outcomes:** `review` with PASS/CHANGES_REQUIRED first line (enforced `contract.verdict`), **cited blockers** (not enforced: `contractViolations` checks only the verdict line and non-empty sections, `src/output-parser.ts:27-32`; no validator checks blocker citations, `src/validators.ts:124-125`), **independent evidence: own re-derivation of at least one acceptance criterion, a diff-level read of the actual repo change, a list of files/areas NOT reviewed, risk acceptance owner**.
- **Actual vs missing:** F-02 (same model by default, sees author's self-assessment), F-03 (reviews after integration), I-02 (sees only emitted patches). A same-model reviewer reproduces the maker's blind spots.
- **Severity:** P0.
- **Recommend:** P-01 (independence policy), P-02 (review before integrate), review context includes real repo diff (`git diff base..worktree`) as engine-produced text.

### 2.10 qa-engineer
- **Files:** dept `quality`, maker, `always`, stage 70, requires requirements + implementation, optional deployment/design-spec, produces `qa-report`, **`reviewedBy: none`**, `consumesTestEvidence: true`, validators `qa-traceability`, sections `QA Status, Traceability`.
- **Perm.:** `qa-risk-testing`, `requirements-analysis`. **Elig. (16):** accessibility, android, api-quality, backend-reliability, database, e2e-browser-testing, flutter, fuzz-property-testing, ios, mobile-native, observability, performance, security-review, security, testing, verification-before-completion.
- **Senior standard:** SFIA TEST (functional testing L5: guide testing through every phase, risk-ranked; verified) + ISTQB CTAL-TA v4.0 (page confirms scope: risk-based testing, test techniques, defect prevention; **syllabus body not read**).
- **Outcomes:** `qa-report` with REQ→test trace (enforced), reproducible FAIL with owner (enforced), plus **evidence cross-checked against runtime evidence, seeded-defect/negative cases, a11y/perf/security test results from real tools, regression suite id, an unoverridable verdict**.
- **Actual vs missing:** F-01 (verdict silently ignored under supplied plans), F-06 (evidence text not verified), skill/role mismatch: `e2e-browser-testing` tells the agent to compile Playwright specs that "must pass `npx playwright test`", but `qa-engineer` is not a code deliverer (F-04) and cannot run anything. QA output is unreviewed.
- **Severity:** P0 (F-01), P1 (F-06).
- **Recommend:** P-01 plan lint; P-07 evidence cross-check; fix the success message at `final-status.ts:38`.

### 2.11 devops-sre
- **Files:** dept `platform`, maker, `capability:deployment`, stage 50, requires `architecture`, optional implementation, produces `deployment`, reviewed, **`deliversCode: true`**, no validators.
- **Perm.:** `platform-reliability`, `engineering-fundamentals`. **Elig. (10):** backend-reliability, database, devops, distributed-systems, migration-review, observability, security-review, security, skill-development, verification-before-completion.
- **Senior standard:** SFIA 9 L5 + Google SRE book Part II (Embracing Risk, Service Level Objectives, Eliminating Toil, Monitoring Distributed Systems, Release Engineering; chapter titles verified) and DORA metrics (verified: change lead time, deployment frequency, failed deployment recovery time, change fail rate, deployment rework rate).
- **Outcomes:** IaC/pipeline code through gates (enforced if configured) plus **deployment runbook, rollback procedure with a tested rollback, SLI/SLO table with numeric targets and alert rules, secret-by-reference list, backup/restore or DR evidence, injected-failure result, DORA-style delivery metrics**.
- **Actual vs missing:** nothing in the engine deploys or probes health; `deployment` is a text artifact; no deploy/health/rollback gate; no DORA-style telemetry (CompanySWAI records model runs, not deploys).
- **Severity:** P1.
- **Recommend:** `deployment` validator (rollback + SLO + health-check sections), operator-recorded DEV deploy/rollback evidence using the takeover-exec pattern (P-04), explicit "NOT_DEPLOYED" status when no evidence.

---

## 3. INFERRED GAPS (reasoned from the code, not executed)

- **I-01 Correlated failure.** Same profile for maker, reviewer slots, and QA (F-02) makes independent review mostly an exercise in re-prompting one model. A policy that forces a different profile or family for reviewer/QA, and a different one for the second CRITICAL slot, is needed before "independent" is a safe word. Severity P0 for HIGH_RISK/security-critical, P1 otherwise.
- **I-02 Review blind spots on code.** The reviewer prompt contains the artifact text, changed-file *names* and gate output (`src/context.ts:78-83`), not the post-change repository or a git diff, so regressions in code the maker did not re-emit are invisible. P1.
- **I-03 Stale acceptance after replan.** `taskHistory` ignores the task spec: a replanned task with the same id and a completed record is not re-run even if its prompt/system/validators changed; a stored QA PASS can outlive an implementation change made through replan. P1 (confirm with a test before fixing).
- **I-04 No independent-test requirement.** A gate PASS can rest on maker-emitted tests over maker-emitted code (F-06): the runtime neither requires independent tests nor records authorship, and mutation/seeded-defect/coverage-threshold checks do not exist. P1.
- **I-05 Host-code-execution exposure.** Gate commands run model-authored code on the host with the operator's file permissions and network (F-05). Prompt-injected content in a brief could aim at this. P1 until a container/VM gate runner exists.
- **I-06 Learning loop weaknesses (P3).** (a) "Distinct projects" is the caller's `projectId`; re-running the same brief under two ids, or live benchmark ids, counts twice. (b) `lessonsFor`/`validatedLessons` read the JSON file without re-running `rejectionReason` (`src/company-experience.ts:116-124`), so a hand-edited `VALIDATED` entry is injected unchecked. (c) No expiry, no revoke, no A/B measurement, unbounded injection count. (d) Template lessons from `CHANGES_REQUIRED` counts can be pushed by an over-strict or same-model reviewer; no outcome signal (QA FAIL, escaped defect) balances them. A bad lesson cannot weaken review/gates (protected topics + forbidden intents), but a low-value lesson can persist and bloat prompts.
- **I-07 Per-role capability routing barely discriminates in the example config** (F-07): three of four profiles advertise identical capabilities; `local-compatible` lacks `deployment`, so only `devops-sre` routing is constrained by capability there, and tier/cost decide the rest. The production `config/providers.json` is out of scope and UNKNOWN.
- **I-08 `qualityShortfall` silent downgrade** (F-07) combined with I-07 means "QUALITY FIRST" is not enforced for high-risk work.
- **I-09 Unreviewed outputs with downstream authority.** `qa-report` and `research` have `reviewedBy: none` yet feed the final verdict and requirements.
- **I-10 Skill/role mismatches that inflate perceived capability:** `e2e-browser-testing`→qa-engineer (cannot deliver code), `security-review` scanner references for roles with no scanner gate, `web-research` without a connector is skipped (good) but `knowledge-matrix`/`ux-research` imply user research no native role can do. Presence in `skillTrace.used` ≠ capability.

---

## 4. FUTURE PROPOSALS (none implemented here; each its own feature branch off `dev` with tests)

| ID | Proposal | Closes | Pri |
| --- | --- | --- | --- |
| P-01 | **Plan lint at every entry** (`runAutonomous` supplied plan, resume, replan): required invariants per mode — a `qa-traceability` task depth-matched to the mode whenever any `deliversCode` task exists; every `qa-engineer`-role task carries the validator; reviewer role must be a registered `mode: reviewer` agent; mode ≥ BALANCED requires reviews on code tasks; unknown role ids rejected. `computeFinalStatus`: no QA gate for a code deliverer ⇒ `INCOMPLETE` (not `ACCEPTED`), and make the success reason state what actually happened (no "reviewed" when nothing was reviewed). Add regression tests for cases A, C, G, H above. | F-01, I-09 | **P0** |
| P-02 | **Review-before-integrate**: for code tasks with isolation `worktree`, run gates in the worktree, hold the commit, run reviewers against the engine-produced diff, integrate only on all-PASS (or revert on exhausted review). Keep resume determinism via the execution log. | F-03, I-02 | **P0** |
| P-03 | **Independence policy**: per-slot profile selection with `excludeProfiles` = maker's profile(s) and, when ≥2 slots, mutual exclusion; record `reviewer.profile != maker.profile` as a plan invariant and a scorecard metric; fail (not warn) in MAX_QUALITY when impossible. Strip the maker's self-assessment sections (`Evidence`/`Decisions`/`Handoff`) from the first-pass reviewer view, or give them as a separate clearly labelled block. | F-02, I-01 | **P0/P1** |
| P-04 | **Evidence harness contract (read-only first):** operator- or sandbox-run executors produce hash-bound, commit-bound evidence records (same pattern as `src/takeover-exec.ts`) for browser E2E/screenshots, a11y scans, SAST/dependency/secret scans, device/emulator runs, DEV deploy/rollback. The engine ingests, redacts and shows them to reviewer/QA; native agents stay text-only and no credential enters a prompt. Native claims of browser/scanner results without an evidence record are rejected by validators. | F-05, F-06, roles 2.6–2.8, 2.11 | P1 |
| P-05 | **Non-code roles may not write files**: for the six `deliversCode:false` makers, if patches exist either fail the task or apply them under the same gates as code tasks (and, with P-02, only after review). | F-04 | P1 |
| P-06 | **Gate runner sandbox** (container/VM, no host secrets, resource and network limits) and new optional catalogue gates (`e2e`, `a11y`, `sast`, `dependency-scan`, `migration-dry-run`, `deploy-smoke`) selectable by capability; a test-adequacy gate (mutation or coverage threshold) that does not depend on who wrote the tests. Change to `company/GATES.md` and `company/POLICY.md` requires an owner-approved phase entry. | F-05, F-06, I-04, I-05 | P1 |
| P-07 | **QA evidence cross-check**: every `| evidence:` on a PASS must quote a gate/test/check name present in the runtime evidence shown to QA, else a validator problem; NOT_APPLICABLE/BLOCKED reasons must name the missing evidence. | F-06 | P1 |
| P-08 | **Role contracts for outcomes** (new validators, each its own PR): `product-plan` outcomes, NFR/Given-When-Then in requirements, ADR/threat/rollback/SLO sections in architecture, `design-spec` state matrix, `deployment` runbook. Map each section to the standards in section 6 only after the standard's text is verified. | roles 2.1, 2.2, 2.4, 2.8, 2.11 | P1/P2 |
| P-09 | **Make quality-shortfall visible**: write the shortfall into the execution record (not only telemetry) and have `computeFinalStatus` return `INCOMPLETE`/`ACCEPTED_WITH_RISKS` accordingly; in MAX_QUALITY treat as `BLOCKED` unless the owner overrides. Test that the current `final-status.ts:35` path is reachable. | F-07, I-08 | P1 |
| P-10 | **Quality-first routing table (recommend, no comparison run now):** per-role/per-task-class floors and ceilings instead of one mode floor: `reviewer`, `qa-engineer`, security lens, `tech-lead` ≥ the highest tier available and never below the maker's tier; `product-lead`/`researcher`/docs may sit one tier lower in FAST/BALANCED; MAX_QUALITY has no economy fallback. Under capacity pressure, degrade in this order: parallelism → latency → park/queue → (never) review/QA tier. Real `qualityTier` values must be justified by a later, owner-approved, capped evaluation, not by price. Cost may only choose between options already shown quality-equivalent. | F-07, I-07 | P1/P3 |
| P-11 | **Safer learning loop:** de-duplicate "projects" by brief hash, not id; re-run `rejectionReason` at read time; add `revoke` and expiry; cap injected lessons (count and chars) with a trace of which lessons were injected per task; add an outcome signal (QA FAIL, escaped defect) so lessons are weighted by quality, not only by reviewer churn; promote only after a controlled holdout shows no regression. | I-06 | P3 |
| P-12 | **Skill honesty:** set `requiresBrowser: true` (or a new `requiresTool`) on skills whose method needs a tool the native agent lacks; render `INJECTED` vs `EXECUTED` separately in `skills` output; never print "capability" from `skillTrace.used`. | F-05, I-10 | P2 |
| P-13 | **Replan correctness:** hash each task's spec (prompt, system, validators, deps) into its completion record and re-run on change; invalidate stored QA when an upstream implementation version changes. | I-03 | P1 |

**Evaluation plan (deferred by the owner):** the later role exams must use unseen tasks, blinded graders and deterministic checks as in Issue #15; they must not rely on any `ACCEPTED` produced while F-01/F-03 are open.

---

## 5. Required-outcome contract (summary)

Today's enforced outcomes (validators): `requirements` (ids, AC, basis), `research` (sources, claims, conflicts), `qa-report` (trace, status, evidence text), `architecture` review categories, `code-delivery`. Everything marked **bold** in section 2 is *not* enforced. A role should reach `QUALIFIED_FOR_SCOPE` only when its outcomes exist as artifacts, are validated mechanically where possible, were reviewed independently, and are backed by executed evidence from the harness (P-04); text confidence is not evidence.

## 6. Standards and verification status (checked 2026-10-14 with the fetch tool)

| Standard | URL | Verified | UNVERIFIED |
| --- | --- | --- | --- |
| SFIA 9 Level 5 "Ensure, advise" | https://sfia-online.org/en/sfia-9/responsibilities/level-5 | Title; attribute headings Autonomy, Influence, Complexity, Knowledge, Business skills/Behavioural factors | Full attribute wording not reproduced here |
| SFIA 9 PROG, REQM, TEST, HCEV | https://sfia-online.org/en/sfia-9/skills/programming-software-development · …/requirements-definition-and-management · …/functional-testing · …/user-experience-design | Skill names/codes and level-5 summaries (as paraphrased by the fetch tool) | Non-functional testing and UX analysis pages not re-fetched |
| OWASP ASVS 5.0 | https://github.com/OWASP/ASVS/tree/master/5.0 | Directory exists; `OWASP_Application_Security_Verification_Standard_5.0.0_en.pdf` listed | Chapter/requirement content not read: no control-level mapping claimed |
| WCAG 2.2 | https://www.w3.org/TR/WCAG22/ | — | **HTTP 403 for both W3C URLs tried: status, date, success criteria not verified in this session** (repo skill `accessibility.md` states WCAG 2.2 AA) |
| ISO/IEC 25010:2023 | https://committee.iso.org/standard/78176.html | Edition 2, 2023, replaces 2011, "nine characteristics" | Names of the nine characteristics (page does not list them) |
| ISTQB CTAL-TA | https://www.istqb.org/certifications/certified-tester-advanced-level-test-analyst/ | v4.0 page; scope: risk-based testing, techniques, defect prevention | Syllabus body |
| IREB CPRE | https://cpre.ireb.org/en/downloads-and-resources/downloads | Download page lists Foundation, Elicitation, Management, Modeling, RE@Agile syllabi/handbooks | Syllabus content (some handbooks need login) |
| Google SRE book, Part II | https://sre.google/sre-book/part-II-principles/ | Chapters 3–9 titles (Embracing Risk, SLOs, Eliminating Toil, Monitoring Distributed Systems, Evolution of Automation, Release Engineering, Simplicity) | Chapter text |
| DORA metrics | https://dora.dev/guides/dora-metrics/ | Five metrics: change lead time, deployment frequency, failed deployment recovery time, change fail rate, deployment rework rate (page updated 2026-01-05) | — |
| Android core app quality | https://developer.android.com/docs/quality-guidelines/core-app-quality | Five categories listed in 2.7 and a test catalog | Individual criteria beyond examples the tool quoted |
| Apple HIG | https://developer.apple.com/design/human-interface-guidelines | — | **Only the page title was returned; content not verified** |

Rule used: a standard is cited as a *reference to interpret*, never as a certification; where content was not verified, no requirement text is paraphrased in this document.

## 7. UNVERIFIED / UNKNOWN

- Real `config/providers.json` (ignored by git): actual models, tiers and per-role routing are UNKNOWN. Only the example file was read.
- Per-run detail of historical supplied plans: only the aggregate Phase 0 counts are used (F-01); which individual runs and why stays out of this public document.
- Test authorship in any real workspace (F-06): not recorded by the runtime, therefore UNKNOWN.
- Whether `src/final-status.ts:35-36` is reachable (static inference F-07; needs a test).
- I-03 stale acceptance after replan (reasoned from `taskHistory`, not run).
- Standards content marked UNVERIFIED in section 6 (WCAG 2.2, ISO 25010 characteristic names, Apple HIG, ASVS/IREB/ISTQB syllabus bodies).
- Any real-world competence, output quality, model behaviour, or cost of any role: untested by design.
- SFIA mapping for product management and for SRE/DevOps roles was not fetched; the SFIA statements above are limited to the four skills listed in section 6.

## 8. Review round 1 (PR #19) — corrections

| Thread | Correction |
| --- | --- |
| Codex 4269515551 | F-04 split into *ungated* (all six `deliversCode:false` makers) and *ungated and unreviewed* (`researcher`, `qa-engineer`); reviewed roles land before review (F-03). Roles 2.1, 2.2, 2.4 and 2.8 updated; P-05 scoped to the six. |
| Codex 4269515558 | F-06, 2.5, I-04: no categorical "tests written by the maker"; the finding is that independent tests are not required and authorship is not recorded. P-06 gate wording made authorship-neutral. |
| Codex 4269515566 | F-07 and I-07: `local-compatible` lacks `deployment`, so capabilities constrain `devops-sre` routing in the example; the "role differences reduce to tier/cost" conclusion withdrawn. |
| Codex 4269515573 | 2.9: "cited blockers" bolded (not enforced) with the code reason. |
| Review 6166876525 | Repeated overstatements fixed consistently (2.5 severity line, I-04, I-07, 2.8). F-01 gains the public aggregate Phase 0 evidence; header notes `SRC` = `dev` for all cited directories. |

Cross-check run for this revision (deterministic, no model call): the 11 agents loaded from `agents/` give `deliversCode` true only for backend/frontend/mobile/devops-sre, `reviewedBy: none` for researcher, reviewer and qa-engineer, and dynamic-skill eligibility 3/3/3/15/11/8/9/4/20/16/10, matching F-08.

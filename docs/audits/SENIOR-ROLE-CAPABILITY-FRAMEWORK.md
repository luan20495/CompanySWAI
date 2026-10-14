# Senior capability framework — CompanySWAI 11 native roles (theoretical audit)

**Audit mode:** repository and published standards only; NO model benchmark runs, paid provider calls, executable E2E, production access or role certification. Reviewed 2026-10-14 against `main` @ `3ecdab1361b86e3604f6822301d29ad3b78a625d`. This document is a design baseline; exact runtime configuration may evolve on `dev`.

## What "Senior" means here

Use **SFIA 9 responsibility Level 5** as a *reference* for accountable, autonomous, high-complexity work; it is not a universal title-to-grade equivalence. A senior role must: identify ambiguities; take end-to-end ownership in its domain; make and explain trade-offs; anticipate failure/security/performance/accessibility; prepare independently reviewable artifacts; verify outcomes; maintain/operate deliverables; communicate risks and handoffs. For organization-wide policy and strategic influence, map selective Level 6 capabilities separately.

**Certification states:** CONFIGURED (role exists) / THEORY_GAP_IDENTIFIED (known tool/process mismatch) / EXECUTION_UNTESTED / QUALIFIED_FOR_SCOPE (future reproducible evidence) / VERIFIED_REPEATABLE (future multi-case cross-domain evidence). **All 11 are currently CONFIGURED + EXECUTION_UNTESTED**, not junior or senior based on output alone. Audit should not silently use `test/benchmark.test.ts` to certify human-level expertise.

**Actual skill model:** 11 role entries in `agents/AGENTS.md`; each role includes permanent skill IDs in `IDENTITY.md`. Dynamic skill registry scans `skills/dynamic/`; `resolveSkills` requires eligible role, task capabilities/tags/keywords, declared project network/browser policy, context limit and at most four specialist skills per task. `skillTrace.used` presently denotes prompt injection, **not proof the model obeyed it** or its advice improved quality. Native CompanySWAI agent calls are text-in/text-out: code/tool/browser execution happens in external runtime gates or the human-facing Claude Code layer, not inside the native maker's tool loop (see `docs/SKILLS-AUDIT.md`).

## Senior responsibility matrix and skill mapping

*The dynamic skill names below are candidate pairings for matching tasks, not a claim they are automatically injected; verify each skill's `appliesTo` and task signals before selecting it.*

| Role | Minimum Senior-level decisions/deliverable | Current permanent skills | Candidate dynamic skills / trustworthy tooling | Theory gap to resolve |
| --- | --- | --- | --- | --- |
| `product-lead` | Problem/value statement, customer segments, measurable outcomes, prioritised roadmap, commercial trade-offs, scope boundaries, stop/continue decisions; accountable stakeholder sign-off | `requirements-analysis`, `research-evidence` | `ux-research`, `web-research`, `knowledge-matrix`; versioned PRD/decision log | No proven discovery interview loop, validated user data or business-outcome feedback; external research access depends on connector |
| `business-analyst` | Elicit ambiguous requirements, split functional/NFR/privacy/security/performance, edge cases and process flows, unambiguous testable AC, traceability, negotiate changes | `requirements-analysis` | `api-quality`, `knowledge-matrix`, `web-research`, `verification-before-completion`; IREB/SFIA REQM | Plans can omit critical QA validator; requirements acceptance is not yet an independently enforced source of truth |
| `researcher` | Test competing hypotheses, validate currency/provenance of sources, distinguish verified facts from estimates, report gaps, research reproducibility | `research-evidence` | `web-research`, `knowledge-matrix`; allowlisted retrieval connector and citations | Native model cannot itself browse; quoted research without actual verified connector evidence is UNVERIFIED |
| `tech-lead` | Architecture boundaries, ADRs, public contracts, threat model, scalability, migration plan, SLO/capacity, failure/recovery model, trade-off/rollback and implementation decomposition | `architecture-system-design`, `engineering-fundamentals`, `independent-review` | `distributed-systems`, `database`, `security-review`, `migration-review`, `verification-before-completion`; SFIA SWDN | Actual system stress/perf or architecture validation not proved by prose, and integration can occur before review in current baseline |
| `backend-engineer` | Maintained API/data transactions, authz and tenant isolation, concurrency/idempotency, migrations and rollback, logs, load and contract test strategy, incident root cause | `engineering-fundamentals`, `backend-engineering` | `api-quality`, `database`, `migration-review`, `backend-reliability`, `fuzz-property-testing`, `security`; OWASP ASVS 5 | Native model has no direct terminal/db tools; source changes and gate logs are not sufficient security/operational evidence |
| `frontend-engineer` | Complete accessible responsive UI, state/loading/error/empty/offline flows, real browser behavior, incremental list updates, perf/a11y budgets, design-system correctness | `engineering-fundamentals`, `frontend-engineering`, `ux-ui-quality` | `accessibility`, `frontend-performance`, `e2e-browser-testing`, `verification-before-completion`; WCAG/HIG | Browser visual and interaction verification not available to native agents; need allowlisted executable browser harness with screenshots |
| `mobile-engineer` | End-to-end Android/iOS/Flutter implementation, lifecycle/reconnect/offline, app startup & memory/frame smoothness, permissions/privacy, native interop, crash-free release | `engineering-fundamentals`, `mobile-engineering`, `ux-ui-quality` | `flutter`, `android`, `ios`, `mobile-native`, `performance`, `security`; official Android/Apple app-quality guidance | Simulator/device build, profiles, platform compatibility, crash and store review are not certified through text prompts |
| `ux-ui-designer` | Research-backed IA and user journeys, design system/token specification, interaction prototypes, empty/loading/error flows, accessibility, visual QA and developer handoff | `ux-ui-quality`, `requirements-analysis` | `ux-research`, `accessibility`, `frontend-performance`, `knowledge-matrix`; Figma/browser evidence when connected | No native design-canvas or screenshot/vision approval loop; an implementation-ready Markdown spec is not visual evidence |
| `reviewer` | Independently detect correctness/security/data/privacy/perf regressions; inspect actual diff, AC and test evidence; unbiased PASS/CHANGES_REQUIRED, prove fixes and residual risk | `independent-review`, `engineering-fundamentals` | `code-review`, `security-review`, `migration-review`, `verification-before-completion` | Lack of real code execution/browsing and known review-before-integration gap. Reviewer must not see maker reasoning or self-approve |
| `qa-engineer` | Risk-based negative/boundary/E2E and accessibility/performance test plans; requirement-to-test trace, seeded defect reproduction, independent BLOCKED/FAIL with severity and re-verification | `qa-risk-testing`, `requirements-analysis` | `testing`, `e2e-browser-testing`, `fuzz-property-testing`, `api-quality`, `security-review`; ISTQB CTAL-TA | Native QA cannot run its own tests; requires trustworthy external gate evidence and Phase 1 QA-veto contract so FAIL cannot be ACCEPTED |
| `devops-sre` | Reproducible build/release, immutable artifacts, rollout/rollback, SLO/SLI, logging/tracing, least-privilege secrets, backup/DR, incident investigation and blameless postmortems | `platform-reliability`, `engineering-fundamentals` | `devops`, `observability`, `backend-reliability`, `distributed-systems`, `security-review`, `verification-before-completion`; Google SRE & DORA | Deployment role must not infer a successful or safe deploy from a text report; requires isolated DEV runbook, real health checks and rollback evidence |

## Required artifact contract (paper/design phase, no test execution today)

Each role's eventual assignment must declare:
1. **Inputs and trust:** approved requirements, upstream artifacts and source links; ambiguity/open questions explicitly listed.
2. **Decision authority:** what it may decide; owner-only gates; dependency and handoff owner.
3. **Definition of done:** specific artifact files, acceptance IDs, security/scale/perf/a11y attributes, negative cases and maintenance/support implications.
4. **Tools and limitations:** `AVAILABLE / SELECTED / INJECTED / EXECUTED / VERIFIED_EFFECTIVE` per skill and external tool, never collapsing these statuses.
5. **Reviewer contract:** independent challenger; code/security/UX/test evidence required to claim PASS later.
6. **Risk and rollback:** assumptions, data migration, incident recovery, operational observability and safe failure mode.

**No expensive model trials now.** The next permitted step is static gap analysis of each `IDENTITY.md`, `RULES.md`, permanent skills, dynamic `appliesTo`, project policy, model/provider selection and current engine contracts. Record source SHA and `UNKNOWN` instead of guessing. Benchmark specification may be written as a future plan but not executed without a new instruction and explicit resource cap.

## Quality criteria (standards to interpret, not certificates)

- SFIA 9 Level 5 (responsibility): https://sfia-online.org/en/sfia-9/responsibilities/level-5
- SFIA 9 software development (PROG): https://sfia-online.org/en/sfia-9/skills/programming-software-development
- SFIA 9 requirements (REQM): https://sfia-online.org/en/sfia-9/skills/requirements-definition-and-management
- SFIA 9 UX analysis/design: https://sfia-online.org/en/sfia-9/skills/user-experience-analysis and https://sfia-online.org/en/sfia-9/skills/user-experience-design
- SFIA 9 functional/nonfunctional testing: https://sfia-online.org/en/sfia-9/skills/functional-testing and https://sfia-online.org/en/sfia-9/skills/non-functional-testing
- OWASP ASVS 5.0: https://github.com/OWASP/ASVS/tree/master/5.0
- ISO/IEC 25010:2023 product quality model (nine characteristics): https://committee.iso.org/standard/78176.html
- ISTQB CTAL-TA: https://www.istqb.org/certifications/certified-tester-advanced-level-test-analyst/
- IREB CPRE: https://cpre.ireb.org/en/downloads-and-resources/downloads
- Google SRE Book: https://sre.google/sre-book/part-II-principles/
- DORA software delivery performance metrics: https://dora.dev/guides/dora-metrics/
- Apple HIG: https://developer.apple.com/design/human-interface-guidelines
- Android core app quality: https://developer.android.com/docs/quality-guidelines/core-app-quality

## Priority from the theoretical audit

**P0 governance integrity:** first make future completion signals trustworthy (QA verdict, review-before-integration, required gates, approval trust boundaries, concurrency fencing); review architecture without running provider-heavy tests now.

**P1 native agent/tool gap:** design least-privilege, audited, sandboxed harness for read-only code/browser/CI/scanner evidence while retaining independent reviewer/QA and no credentials in agent prompt.

**P2 capability completeness:** improve skill instructions/output contracts by role; measure later against fixed independent criteria, not rubric drift.

**P3 learning/model/staffing:** only after trustworthy validation baseline, compare skill/model/role allocation and promote changes with controlled rollback. QUALITY FIRST; lower cost only between demonstrably quality-equivalent options.

Cross-project legacy C0–C7 migration belongs to Issue #13 and must not be mistaken for role competence certification. All engineering changes target `dev` via feature PRs; `main` is owner-controlled.

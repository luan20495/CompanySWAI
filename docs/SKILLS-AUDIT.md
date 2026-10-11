# Skills audit — curated skill layer for CompanySWAI

Audit date: 2026-10-11. Method: every source repository was shallow-cloned into a scratch directory and **read, never executed** (no install script, hook or skill script was run). Repository content was treated as untrusted data. Findings were checked against the licence files, `SKILL.md` text, scripts, `allowed-tools`, hooks and dependency declarations. Per-path commit dates are **UNKNOWN** for shallow clones; the date shown is the repository HEAD date. Behavioural claims about third-party tools (for example scanner telemetry flags) come from reading, not from running them.

## 0. Preflight result

| Question | Finding |
|---|---|
| `main` before this work | `557a9b9` == `origin/main` (operator layer), clean tree |
| Existing skills | 11 permanent role skills (`skills/*.md`, tiny, no frontmatter) + 15 dynamic specialist skills (`skills/dynamic/*.md`, 0.7–1.2 KB each, activation by capability / tag / whole-word keyword, role list in `appliesTo`, cap of 4) |
| "web-operation" skill | **Does not exist** anywhere (repository, git history, `~/.claude/skills`). Nothing to reinstall or duplicate. |
| "knowledge-matrix" skill | **Does not exist** anywhere. Created natively (see §3). |
| Operator level vs agent runtime level | Neither of the two existed at either level. The only browser capability present is the user-level `playwright-cli` Claude Code skill (**operator level only**: it lets the human-facing Claude session drive a browser; CompanySWAI agents never see it). The closest runtime-level equivalents were `skills/research-evidence.md` (role skill) and the research connectors (retrieved sources are the only citable web evidence). |
| What a "skill" can be at runtime | CompanySWAI agents are text-in / text-out model calls with **no tools**: a skill is guidance injected into the system prompt. A skill cannot browse, run a scanner or execute a script. Anything executable runs as a **project gate** (commands in the brief), never as an agent action. This shaped every decision below: scripts, MCP servers, hooks and installers of external skills are not used. |

## 1. Selection rules applied

1. Licence first. No licence ⇒ no copying (REJECT; ideas may inform native text only if nothing is reproduced). Proprietary terms ⇒ REJECT.
2. Safety next. Hooks, installers, global installs, telemetry, credential/cookie persistence, kill-by-name/port, force push, `curl | sh` ⇒ REJECT or strip.
3. Context cost. Hard limit 3,200 characters for a skill core and 4,000 per reference; 7,000 characters of skills per maker task (9,000 for a reviewer). Large upstream cores (10–48 KB) are **distilled (ADAPT)**, not vendored.
4. Overlap. One skill per job; where the existing native skills already cover a capability no second skill was added.
5. Decisions use: **USE-AS-IS** (copy unchanged), **VENDOR-PIN** (copy, pin commit), **ADAPT** (rewrite/distil, pin the source commit, keep attribution), **REJECT**. No candidate qualified for USE-AS-IS or VENDOR-PIN: every selected upstream is either too large for prompt injection, assumes an interactive tool-using Claude, or needs safety changes, so all selected external skills are ADAPT.

## 2. Final selected set

**10 new skills** (7 adapted from pinned MIT / Apache-2.0 sources, 3 native) on top of the 15 existing native specialist skills and the 11 permanent role skills. 25 dynamic skills in total; the curated additions are the 10 below.

| Skill | Decision | Source @ commit (path) | Licence | Roles | Activates on | Core chars | Needs |
|---|---|---|---|---|---|---|---|
| `web-research` | ADAPT | johnqtcg/awesome-skills @ `ac0614056cde` (`skills/deep-research`) | MIT | researcher, product-lead, business-analyst, tech-lead | tag `external-evidence` (project has a configured research connector) or research keywords | 1,977 | network policy (connector) |
| `knowledge-matrix` | NATIVE | — (concept only; written from scratch) | LicenseRef-CompanySWAI | researcher, tech-lead, business-analyst, product-lead | keywords (knowledge matrix/map, landscape, discovery, legacy, existing system…), tag `brownfield` | 1,623 | — |
| `verification-before-completion` | NATIVE | — | LicenseRef-CompanySWAI | all makers that deliver or hold risk, reviewer, qa, tech-lead | tags `delivers-code`, `reviews-code`, `risk-high`, `risk-critical` | 1,817 | — |
| `code-review` | ADAPT | anthropics/claude-plugins-official @ `a9fd21643fc1` (`plugins/code-review`, `plugins/pr-review-toolkit/agents/silent-failure-hunter.md`) | Apache-2.0 | reviewer | review of delivered code | 1,816 | — |
| `api-quality` | ADAPT | johnqtcg/awesome-skills @ `ac0614056cde` (`skills/api-design`, `skills/api-integration-test`) | MIT | tech-lead, backend-engineer, qa-engineer, reviewer | keywords api / rest / endpoint / openapi / graphql / grpc / webhook / contract test | 2,025 | — |
| `migration-review` | ADAPT | johnqtcg/awesome-skills @ `ac0614056cde` (`skills/pg-migration`) | MIT | backend-engineer, reviewer, devops-sre, tech-lead | keywords migration / flyway / ddl / backfill; tags `postgres`, `schema-migration` | 2,131 | — |
| `security-review` | ADAPT | secureIO-GmbH/security-skills @ `49f63fb87a4a` (`skills/security-scan`, `skills/security-arch-review`) + johnqtcg/awesome-skills @ `ac0614056cde` (`skills/security-review`) | MIT | reviewer, tech-lead, devops-sre, qa-engineer | tag `security-review` (security-critical project, any non-product role) or scan keywords; scanner reference loads on dependency/secret/SAST keywords | 1,720 + 1,576 ref | optional: gitleaks, semgrep, trufflehog, trivy, grype |
| `e2e-browser-testing` | ADAPT | Autodesk/claude-browser-test-skills @ `f11f48f49768` (author, compiler, runner) + microsoft/playwright-cli @ `b85c7a736bb4` (`skills/playwright-cli`) | Apache-2.0 | qa-engineer, frontend-engineer | capability `web-ui`, keywords e2e / playwright / user journey; references `playwright-cli.md`, `triage.md` on demand | 1,853 + 1,185 + 955 ref | optional: playwright-cli |
| `fuzz-property-testing` | NATIVE | — | LicenseRef-CompanySWAI | backend-engineer, frontend-engineer, qa-engineer, reviewer | keywords fuzz / property-based / parser / round-trip / invariant | 1,787 | — |
| `skill-development` | ADAPT | anthropics/claude-plugins-official @ `a9fd21643fc1` (`plugins/plugin-dev/skills/skill-development`) | Apache-2.0 | tech-lead, devops-sre | keywords agent skill / SKILL.md / skill registry | 2,367 | — |

Every adapted skill carries `attribution`, `sourceCommit` (40-hex), `upstreamPath` and `alsoFrom` in its frontmatter; the loader refuses an external skill without them. NOTICE obligations: Apache-2.0 sources are modified (distilled), attribution lines state the changes.

### Capability matrix coverage

| Capability | Covered by | Notes |
|---|---|---|
| Web research / browser operation | `web-research` (research evidence, untrusted web data) + research connectors + `e2e-browser-testing` (browser mechanics for tests) | Agents do not browse; retrieved sources are fenced as untrusted data (see §5). Operator-level browsing stays with the `playwright-cli` Claude Code skill. |
| Knowledge matrix / mapping | `knowledge-matrix` | native |
| Verification before completion | `verification-before-completion` | native |
| Code review | `code-review` (+ core `independent-review`) | confidence-filtered, reviewer only |
| Secure coding / security review | `security` (existing, build rules) + `security-review` (review workflow) | complementary: builders get rules, reviewers get the workflow |
| Testing strategy | `testing` (existing) | covered |
| Architecture review | core `architecture-system-design` + review lens `architecture` + `architecture-review` validator (existing) | no new skill: nothing external was better than the existing lens; cesarbqz architecture skills are stubs |
| API review / testing | `api-quality` | one skill for design review and integration tests |
| Database / schema / query | `database` (existing) + `migration-review` | |
| Frontend / UI, accessibility | `accessibility`, `frontend-performance`, `ux-research`, core `ux-ui-quality` (existing) + `e2e-browser-testing` | no external UI-review skill met the licence/safety bar |
| Mobile | `mobile-native`, `android`, `ios`, `flutter` (existing) | |
| Performance | `performance`, `frontend-performance` (existing) | johnqtcg `load-test` considered: covered by the native skill, not added |
| SRE / resilience | `backend-reliability`, `distributed-systems`, `observability` (existing) | johnqtcg monitoring/incident skills considered: duplicates, not added |
| DevOps / CI-CD | `devops` (existing) | cesarbqz `ci-cd` rejected (provenance, stub-level layout) |
| Dependency / secret scanning | `security-review` + `scanners.md` reference + project gates | tools optional |
| E2E / browser testing | `e2e-browser-testing` | |
| Fuzz / property testing | `fuzz-property-testing` | native; Go-only upstream skills not reusable |
| Skill development / validation | `skill-development` + `npm run skills -- validate` | |
| CompanySWAI-native skills | registry schema, loader scan, validator, tests | §4 |

## 3. Source-by-source audit

Each row: SOURCE · LICENSE · DECISION · WHY · SECURITY NOTES · DEPENDENCIES · ROLE MAPPING.

### 3.1 anthropics/skills — HEAD `dbd4588f9e10` (2026-10-09)

Repo-level licence: none at root; **per skill**: Apache-2.0 for most, **proprietary** for docx/pdf/pptx/xlsx, doc-coauthoring unlicensed (UNKNOWN).

| Skill | Decision | Why | Security notes | Dependencies | Roles |
|---|---|---|---|---|---|
| skill-creator | ADAPT (ideas only, not selected as a source: no licence field in its frontmatter) | best skill-authoring/validation material, but 33 KB core; `plugin-dev` provides an Apache-licensed equivalent | `generate_review.py::_kill_port` SIGTERMs every listener on a port (violates our no-kill-by-port rule); `run_eval.py` writes into `.claude/commands/` and spawns nested `claude -p` with the full env | python | tech-lead |
| webapp-testing | REJECT as a skill; pattern only | weaker than playwright-cli; `with_server.py` uses `shell=True`, does not drain pipes, undeclared deps, `/mnt` paths | shell=True with caller args | python, playwright | qa, frontend |
| frontend-design | REJECT | aesthetic direction, not review; 9 KB | none | — | ux, frontend |
| mcp-builder | REJECT | builds MCP servers; WebFetches docs; needs `ANTHROPIC_API_KEY` | network, API key | python, node | backend |
| claude-api | REJECT | 105 KB core, 2 MB tree; already built into Claude Code | context cost | — | — |
| discernment-nudge | REJECT | end-user coaching, not verification | none | — | — |
| doc-coauthoring | REJECT | licence UNKNOWN | — | — | product-lead |
| docx, pdf, pptx, xlsx | REJECT | **proprietary** (no copy, no derivatives) | — | — | — |
| academy-guide, algorithmic-art, brand-guidelines, canvas-design, internal-comms, slack-gif-creator, theme-factory, web-artifacts-builder | REJECT | no software-company value | — | — | — |

### 3.2 anthropics/claude-plugins-official — HEAD `a9fd21643fc1` (2026-10-10)

Repo licence Apache-2.0 (39 of 44 plugin LICENSE files identical); `claude-security` proprietary; external MCP stub plugins ship no LICENSE (UNKNOWN).

| Plugin / skill | Decision | Why | Security notes | Dependencies | Roles |
|---|---|---|---|---|---|
| code-review (command) + pr-review-toolkit (silent-failure-hunter, pr-test-analyzer, code-reviewer) | **ADAPT → `code-review`** | multi-lens review with 0–100 confidence filter (≥80) and silent-failure hunting is the best small review method found | upstream posts PR comments through `gh` (dropped); agents declare no tools (inherit all) | none after adaptation | reviewer |
| plugin-dev / skill-development | **ADAPT → `skill-development`** | Apache-2.0 authoring guidance | bash validators not executed | none | tech-lead, devops |
| feature-dev (code-explorer, code-architect, code-reviewer) | ADAPT concept only | informed `knowledge-matrix` and the architecture material; not copied, so `knowledge-matrix` is NATIVE | agents expose WebFetch/WebSearch/KillShell (never reuse) | — | tech-lead |
| code-modernization (8 agents, 8.3 MB) | REJECT as a package | plugin has UI-pane and usage-count telemetry hooks, huge fan-out; individual agents partly useful but large | telemetry hooks | — | — |
| security-guidance | REJECT | pip-installs an SDK into `~/.claude` at SessionStart; sends diffs/files to a model endpoint on every Stop/commit; metrics emission | egress, install, cost | python | — |
| claude-security | REJECT | **proprietary**; broad `Bash(git *)` | licence | — | — |
| hookify | REJECT | writes rule files into the repo, runs Python on every tool call | hook on every call | python | — |
| ralph-loop | REJECT | unbounded Stop-hook loop | runaway cost | — | — |
| claude-code-setup, code-simplifier, mcp-server-dev | REJECT | not on the matrix (code-simplifier edits code) | — | — | — |
| External MCP stubs (playwright, serena, github, firebase, terraform, context7) | REJECT as skills | unpinned `@latest`/git installs, no LICENSE; not skills | supply chain | node | — |
| playwright.dev (microsoft) | reference only | docs site, no skill; its docs state `allowedOrigins`/secret redaction are "not a security boundary" — informed our origin allow-list + no-credentials rules | — | — | qa |

### 3.3 microsoft/playwright-cli — HEAD `b85c7a736bb4` (2026-09-28); microsoft/playwright.dev — HEAD `92ce20b80c8c`

Licence Apache-2.0 (docs CC-BY-4.0, site MIT). `skills/playwright-cli`: 15.4 KB core + 53 KB references.

| Item | Decision | Why | Security notes | Dependencies | Roles |
|---|---|---|---|---|---|
| skills/playwright-cli | **ADAPT** (folded into `e2e-browser-testing` + `playwright-cli.md` reference) | official, high quality, but 68 KB and pre-approves `Bash(playwright-cli:*)` | pre-approved `run-code`, `eval`, `kill-all`, cookie/state commands; `state-save` writes auth.json in cwd; `attach --cdp/--extension` reaches the user's real browser; daily npm version check; only the WebMCP section calls page content untrusted; `kill-all`/`close-all` conflict with the no-kill-by-name rule | Node 18+, `@playwright/cli` (unpinned upstream) | qa, frontend |
| playwright.dev | reference | no skill/llms.txt | — | — | — |

Question asked: *official skill vs Autodesk?* The official skill is sufficient for browser mechanics but is not a QA workflow (no case format, stability criterion, environment gate, triage). Autodesk adds exactly that. They do not duplicate; both were distilled into **one** skill rather than installing two.

### 3.4 Autodesk/claude-browser-test-skills — HEAD `f11f48f49768` (2026-07-16), Apache-2.0 + NOTICE

| Skill | Size | Decision | Why | Security notes |
|---|---|---|---|---|
| author | 18.9 KB | ADAPT → pipeline step 1 | markdown test cases (Before / Steps / After) tied to requirements | Jira MCP, Auth0/Svelte specifics (dropped); reads `E2E_*`/`TEST_USER_*` env vars (kept as environment-only credentials) |
| refiner | 7.9 KB | ADAPT → step 2 | N consecutive passes before a case counts | — |
| compiler | 55 KB | ADAPT → step 3 (heavily distilled) | compile to deterministic `.spec.ts`, no LLM in CI | needs `@playwright/mcp@latest` (unpinned) — dropped; 21 project-specific rules not carried |
| runner | 5 KB | ADAPT → `triage.md` | product bug vs test drift triage | — |

No injection guard upstream (added). Maintainer CI scripts are benign. One visible commit, no tests (UNKNOWN real-world quality).

### 3.5 johnqtcg/awesome-skills — HEAD `ac0614056cde` (2026-10-09), MIT "Copyright (c) 2026 john.q.tcg"

52 skills; not individually licensed (repo MIT covers them); high quality (references, golden fixtures, evals; suites not run by us — UNKNOWN pass state); **cores 20–48 KB** and many are Go-centric, so none is injectable as-is. No hooks, telemetry or injection strings.

| Skill | Decision | Why | Security notes | Roles |
|---|---|---|---|---|
| deep-research | **ADAPT → `web-research`** | evidence gates, claim-to-excerpt, honest degradation | upstream fetcher uses DuckDuckGo lite with a random browser User-Agent (anti-bot spoofing) — not used; our version works only from runtime-retrieved sources | researcher |
| api-design, api-integration-test | **ADAPT → `api-quality`** | language-agnostic design scorecard; integration test taxonomy and skip-vs-fail integrity | integration test is Go-only (generalised) | tech-lead, backend, qa |
| pg-migration | **ADAPT → `migration-review`** | PostgreSQL DDL lock analysis, expand/contract; fits Flyway | no eval dir | backend, reviewer |
| security-review | **ADAPT → `security-review`** (with secureIO) | severity × confidence contract, default-deny live systems | read-only tools upstream | reviewer |
| fuzzing-test, tdd-workflow, unit-test | concept only (`fuzz-property-testing` is native) | Go-only | — | qa, backend |
| load-test, monitoring-alerting, log-analyzer, incident-postmortem, redis-cache-strategy | REJECT (covered by native skills) | duplicates `performance`, `observability`, `backend-reliability` | `systematic-debugging` allows `curl*`, `strace*` | devops |
| e2e-test | REJECT | depends on an external `agent-browser`; replaced by playwright-cli-based pipeline | — | qa |
| go-* (10), mysql/oracle/mongo/oceanbase migration, kafka-event-driven-design, stock-* (7), yt-dlp-downloader, local-transcript, create-pr, git-commit, go-makefile-writer | REJECT | stack mismatch (XWeb is Kotlin/Spring, PostgreSQL, RabbitMQ) or off-domain; `create-pr` / `git-commit` conflict with the no-push/no-merge rules | `*_EVAL_CMD` dev scripts run `shell=True` (never invoked) | — |
| readme-generator, tech-doc-writer, update-doc, writing-plans, google-search, constructive-thinking, systematic-debugging | REJECT | not on the matrix / covered | broad allowed-tools globs | — |

### 3.6 secureIO-GmbH/security-skills — HEAD `49f63fb87a4a` (2026-03-27), MIT

| Skill | Decision | Why | Security notes | Dependencies |
|---|---|---|---|---|
| security-scan | **ADAPT → `security-review` + `scanners.md`** | real per-binary degradation (semgrep→opengrep, trufflehog, trivy→grype) | `--config=auto` without `--metrics=off`; trufflehog `--only-verified` sends candidates to third parties; raw JSON dumped in repo root; `2>/dev/null` hides failures; staged-secret command likely misses uncommitted changes (unverified) — all corrected in our reference | semgrep, trufflehog, trivy, grype (optional) |
| security-arch-review | ADAPT (checklist ideas folded in) | OWASP Proactive Controls review | none (prose) | — |
| security-audit, threat-model | REJECT | thin orchestrator / 156 KB of pytm data to trim | — | — |

### 3.7 Security-Phoenix-demo/security-skills-claude-code — HEAD `40ace4aa7101` (2026-09-11), MIT

A vendor-branded "open-source companion" marketplace (27 skills). No phone-home found; keys only for cti-search and the docs-research pipeline. Several skills are written against a Phoenix-internal MCP/REST backend with fabricated example transcripts.

| Skill | Decision | Why / security notes |
|---|---|---|
| security-reviewer (+ language packs) | ADAPT concept (8-point check, "confirm before flagging") → folded into `security-review` wording; not vendored (large, packs unused for Kotlin) |
| production-readiness-review | REJECT for now | useful but 29 KB with a script whose output echoes secret candidates into context |
| tm-security-review, tm-quick-security-assessment | REJECT | compose rejected skills; demand runnable PoCs; name collides with the built-in `/security-review` |
| opengrep-rule-generator (+ near-duplicate -research) | REJECT | prose + WebFetch of cwe/owasp; custom SAST rules not needed yet |
| 0day-scanner, security-assessment, threat-modeling | REJECT | dead MCP/REST surface, "Status: Planned" |
| notebooklm, phoenix-research-pipeline, cti-domain-research (installer) | REJECT | auto-created venv + pip/Chromium download, anti-detection automation with persisted cookies; `--break-system-packages`; API keys written in plaintext |
| prd-pipeline (13 skills), project-documenter, plan-readiness-review | REJECT | Phoenix trust boundaries and a hard-coded Confluence page id; mandatory external pushes; not needed beyond existing product roles |
| session hooks (osv-scanner, npm audit, registry guard, quick scan) | REJECT | auto-run on every session/tool call, network, fail-open on bash < 4 (macOS default) |

### 3.8 cesarbqz/platform-skills — HEAD `7880126e48ed` (2026-05-03), MIT "Copyright 2026 Cesar"

18 skills: 12 are 2–3 KB **stubs** (golden-rules, adr-writer, system-design, api-design, resiliency-patterns "References: None yet"…); 6 real (iac-terraform, aws-cost-optimization, gitops-workflows, monitoring-observability, ci-cd, k8s-troubleshooter). The six devops skills derive from `ahmedasmar/devops-claude-skills`, whose upstream has **no LICENSE file** (README MIT claim only): provenance risk. Docs/templates contain `terraform apply -auto-approve`, `rm -rf .terraform`, `curl | sh`, global installs (text, not auto-run). A checked-in `.skill` zip drifted from the sources. **Decision: REJECT all** (stubs add nothing; real ones are provenance-risky and stack-mismatched; `devops` and `observability` already exist).

### 3.9 jojojobring/claude-skills — HEAD `ff6978997b09` (2026-03-22) — **no licence**

18 skills. **REJECT for copying**: no LICENSE and no README claim. 14 of 18 are an unlicensed copy of obra/superpowers (upstream believed MIT — unverified); `webapp-testing` is byte-identical to Anthropic's; `writing-skills` includes a copied Anthropic document of unknown licence. `finishing-a-development-branch` merges/pushes/`git branch -D`, `using-git-worktrees` auto-commits, `using-superpowers` overrides the system prompt: all conflict with company rules. `front-end-test` ships Python scripts with `shell=True` and no URL allow-list. Observed good ideas (confidence levels, do-not-flag lists, two-phase authorisation testing, evidence-before-claims) are general engineering practice and were written natively; **no text was reproduced**.

### 3.10 carlgra/claude-skills — HEAD `db60b4f342c1` (2026-03-14) — **no licence**

11 reviewer skills (9–24 KB). **REJECT**: no LICENSE; hard-codes a specific product's stack despite claiming not to; all set `disable-model-invocation: true`; `review` Step 0b **executes shell strings read from a repo history file** (command-injection surface); `infosec-review` fires injection probes with a hard-coded dev token. Idea noted, not copied: findings → measurable objective + baseline (the project's own retrospective mechanism already covers it).

### 3.11 Not on the matrix

No source covered mobile review, accessibility checklists, knowledge mapping, fuzz/property testing, verification-before-completion or web-research under a usable licence and size; those are native (`knowledge-matrix`, `verification-before-completion`, `fuzz-property-testing`) or already provided by the 15 existing native skills.

## 4. Registry, resolver and safety (what the code enforces)

`src/skill-registry.ts` (schema, scanner, validators), `src/skill-selector.ts` (catalog loader + resolver), `src/skills-view.ts` / `src/tool-probe.ts` (read-only visibility), `src/skills-cli.ts` (`npm run skills`).

- **Registry metadata** (frontmatter, validated by zod): `name, version (semver), description, appliesTo (allowed roles), capabilities, keywords, tags, minComplexity, source, sourceCommit, upstreamPath, alsoFrom[], license (allow-list), decision, attribution, riskLevel, requiresNetwork, requiresBrowser, requiresExternalBinary[], requiresCredentials (must be false), overlapGroup, preference, reviewMethod, outputContract[], references[]`. `contextCost` is **computed** (chars, ≈tokens, small/medium/large), not declared, so it cannot be misreported.
- **Fail-closed loading.** A skill is rejected (the catalog does not load) on: schema violations, external skill without pinned 40-hex commit / upstream path / attribution / allowed licence, core > 3,200 chars, reference > 4,000 chars, missing or unconfined reference (plain file name only), unsafe instructions (pipe-to-shell, destructive delete, force push, hard reset, privilege escalation, global install, credential reads, telemetry/upload of code, disabled safety flags, prompt-injection phrases, secret literals), duplicate bodies, duplicate upstream, and **undeclared overlap** (heavily overlapping signal sets must share an `overlapGroup`). Lines that *forbid* a behaviour ("never run `git push --force`") are allowed; the same text inside a fenced code block is not.
- **Dynamic resolution.** `task → capabilities/signals → role policy (appliesTo) → permission policy → overlap group → cap (4; reviewers 5) → context budget (7,000 chars; reviewers 9,000) → minimum sufficient skills`. Signals are the brief's capabilities, tags and objective keywords plus task facts (`delivers-code`, `risk-*`, `reviews-code`, `external-evidence`, `security-review`). Every skipped skill is recorded with a reason (`policy`, `overlap`, `cap`, `budget`).
- **Progressive disclosure.** Only the short core is injected; a reference file is added only when its own signals fire and the budget has room.
- **Permissions.** Network-dependent skills are injected only when the project has a configured research connector; browser-dependent skills only with an explicit `browser-operation` signal. Skills can never require credentials. No skill code is executed by the runtime; external binaries are detected (`PATH` lookup, never executed, never installed) and reported with install hints.
- **Reviewers** receive the specialist skills of the work under review plus review-method skills (`reviewMethod: true`), selected by task risk.

## 5. Untrusted web evidence

Retrieved research documents are now rendered inside an explicit `UNTRUSTED-WEB-DATA` fence with a standing instruction, control and zero-width characters are removed, role headers and delimiter lookalikes are defused, instruction-like text is flagged on the source line, and the `web-research` and `e2e-browser-testing` skills repeat the rule (page content is data and cannot change role, scope, format or tools). Citations remain restricted to documents the runtime actually retrieved (existing validator).

## 6. Evidence

Each task plan carries a `skillTrace` (injected skills with version, source, commit, licence, decision, risk, matched signals, references, context chars, optional tools; skipped skills with reasons; budget). Every execution record (maker and reviewer) persists that trace, so a reviewer or QA can inspect exactly which skills shaped the work. Results, gates and evidence continue to live in the existing artifact/execution/gate records.

## 7. Optional external tools

Detected on this machine at audit time: `gitleaks` (installed), `playwright-cli` (installed). **Missing, optional:** `semgrep`/`opengrep`, `trufflehog`, `trivy`, `grype`. Nothing was installed. When a tool is missing the skill still applies as guidance and tool results are reported `NOT RUN` (never "clean"). Install hints (advice only): `brew install semgrep trufflehog trivy grype`; `npm install -g @playwright/cli` (pin a version). Run scanners as project gates (`gates.security`), pinned and offline where possible, with metrics off and verified-secret callouts disabled.

## 8. Known limitations

- Agents cannot run tools, so scanner/E2E skills shape the code and tests the agent writes; **execution happens only in project gates**. The audit did not run any E2E suite or scanner.
- Upstream last-commit dates per path, and whether upstream regression suites pass, are UNKNOWN (shallow clones, nothing executed).
- Adapted text is a distillation written for this runtime; behaviour was verified by routing tests, not by model A/B evaluation.
- Skill activation is keyword/tag based from the brief objective and capabilities; very terse briefs under-activate skills (the trace shows what was skipped and why).

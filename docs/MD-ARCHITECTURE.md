# MD-driven architecture

CompanySWAI keeps agent behaviour in Markdown and runtime mechanics in TypeScript.

## Source of truth (Markdown)
- `agents/AGENTS.md`: the authoritative list of the 11 permanent agents. Directories not listed are rejected by `npm run doctor`.
- `agents/<id>/IDENTITY.md`: identity, department, mode (`maker`/`reviewer`), activation, stage, skills, `modelCapabilities`.
- `agents/<id>/RULES.md`: `requires` / `optionalRequires` / `produces`, `reviewedBy`, `reviewLens`, `validators`, `extraSections`, `deliversCode`, DONE conditions and the exact output formats the validators enforce.
- `skills/*.md` (permanent) and `skills/dynamic/*.md` (specialist; `appliesTo`, `capabilities`, `keywords`, `tags`, `minComplexity` signals).
- `company/OUTPUT-CONTRACT.md`, `MEMORY.md`, `POLICY.md`, `GATES.md`, `LEARNING.md`, `COMPANY.md`, `WORKFLOW.md`, `QUALITY-GATES.md`.

## Runtime (TypeScript)
Parses and validates the Markdown, resolves artifact dependencies, activates agents, selects dynamic skills deterministically, builds isolated contexts, routes providers, schedules the DAG, runs maker → independent review(s) → revision loops, validates outputs, applies workspace patches (optionally in isolated worktrees), persists everything, resumes, and runs the learning loop. No role persona or role-specific rule lives in TypeScript; a test enforces that no agent id is branched on in `src/`.

## Dependency model
The planner connects a consumer task to the active producers of each artifact it `requires`. A required artifact without an active producer is a planning error, as is a dependency cycle. Architecture tasks are reviewed (architecture lens) before the implementation tasks that require them can start.

## Extension points (no orchestrator changes)
New provider kind: `ProviderRegistry.register`. New research source: `ConnectorRegistry.register`. New agent behaviour, skills, gates, review levels, modes and learning rules: Markdown. New deterministic output check: add a validator to `src/validators.ts` and name it in an agent's `RULES.md` (doctor fails on unknown names).

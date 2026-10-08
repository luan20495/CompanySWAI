# MD-driven architecture

CompanySWAI keeps agent behaviour in Markdown and runtime mechanics in TypeScript.

## Source of truth (Markdown)
- `agents/AGENTS.md`: the authoritative list of the 11 agents. Directories not listed are rejected by `npm run doctor`.
- `agents/<id>/IDENTITY.md`: identity, department, mode (`maker`/`reviewer`), activation rule, stage, skills, `modelCapabilities` needed from a provider.
- `agents/<id>/RULES.md`: `requires` / `optionalRequires` / `produces` artifacts, `reviewedBy`, DONE conditions.
- `skills/*.md`: reusable context, loaded only into agents that declare the skill.
- `company/COMPANY.md`, `WORKFLOW.md`, `QUALITY-GATES.md`: operating principles and gates.
- `company/OUTPUT-CONTRACT.md`: the structured output contract (`## Deliverables`, `## Decisions`, `## Evidence`, `## Blockers`, `## Handoff`; reviewers start with `PASS` or `CHANGES_REQUIRED`).
- `company/MEMORY.md`: which project memory file receives which produced artifact.

## Runtime (TypeScript)
Parses and validates the Markdown, resolves artifact dependencies, activates agents, routes providers, enforces budget/approval/concurrency, runs maker → review → revision loops, validates the output contract, applies workspace patches transactionally, persists everything, resumes, and runs the learning loop. No role persona or role-specific rule lives in TypeScript.

## Dependency model
The planner connects a consumer task to the active producers of each artifact it `requires`. A required artifact without an active producer is a planning error, as is a dependency cycle.

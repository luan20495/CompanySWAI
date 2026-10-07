# CompanySWAI

CompanySWAI is a lightweight, local, **MD-driven AI software company**. Markdown defines the company, 11 core agents, their rules, skills, dependencies and quality gates. TypeScript is the small execution engine.

## Why MD-first
- Human-readable in GitHub and local editors.
- Easy to version, review and change without modifying runtime code.
- Loads only the active agents and only the skills each agent needs.
- Keeps role prompts out of TypeScript.
- Makes dependencies explicit through produced/required artifacts.
- No web UI is required to operate or inspect the company.

## Source of truth
- `company/COMPANY.md` — global operating principles.
- `company/WORKFLOW.md` — company flow.
- `company/QUALITY-GATES.md` — universal quality gates.
- `agents/<agent>/IDENTITY.md` — identity, activation and relevant skills.
- `agents/<agent>/RULES.md` — dependencies, outputs, reviewer and DONE rules.
- `skills/*.md` — reusable skills loaded only when referenced.

The 11 core agents are Product Lead, Business Analyst, Researcher, Tech Lead, Backend Engineer, Frontend Engineer, Mobile Engineer, UX/UI Designer, Independent Reviewer, QA Engineer and DevOps/SRE.

## Runtime responsibilities
The TypeScript core parses/validates Markdown, activates agents by project capability/complexity, resolves artifact dependencies, builds executable plans, routes providers, controls budget/approval/concurrency, handles failover/checkpointing, runs independent review and stores execution/retrospective evidence.

## Run
```bash
npm install
npm run check
npm run company -- examples/project-brief.json --runtime config/providers.json
```

See `docs/MD-ARCHITECTURE.md` for the contract.

Provider credentials must never be committed.

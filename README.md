# CompanySWAI

CompanySWAI is a lightweight local **MD-driven AI software company**. Markdown defines the company, 11 core agents, rules, skills, dependencies and quality gates; TypeScript is the execution engine.

## Core model
- `company/*.md`: company principles, workflow and quality gates.
- `agents/<agent>/IDENTITY.md`: role, activation and skills.
- `agents/<agent>/RULES.md`: required/produced artifacts, reviewer and DONE rules.
- `skills/*.md`: reusable context loaded only when referenced.
- `.companyswai/projects/<project>/`: readable project memory: PLAN, REQUIREMENTS, ARCHITECTURE, DECISIONS, HANDOFFS, REVIEWS, QA and STATUS.

The 11 core agents are Product Lead, Business Analyst, Researcher, Tech Lead, Backend Engineer, Frontend Engineer, Mobile Engineer, UX/UI Designer, Independent Reviewer, QA Engineer and DevOps/SRE. Only relevant agents are activated.

## Runtime
The runtime parses/validates Markdown, resolves artifact dependencies, routes providers, enforces budget/approval/concurrency, persists checkpoints, resumes completed work safely, performs review/revision, records artifacts/decisions/handoffs, can apply confined ```file` patches to an explicitly configured local workspace, run deterministic checks, optionally commit successful changes, and reuse retrospective lessons on later runs.

## Verify
```bash
npm install
npm run check
```

## Deterministic end-to-end demo
No API key is required:
```bash
npm run company -- examples/project-brief.json --dry-run
```

## Live run
Create `config/providers.json` from the example, set credentials in environment variables, then:
```bash
npm run company -- examples/project-brief.json --runtime config/providers.json
```

## Optional real code workspace
Add these fields to a project brief:
```json
{
  "workspacePath": "/absolute/path/to/your/local/repo",
  "checks": [
    {"cmd": "npm", "args": ["test"]},
    {"cmd": "npm", "args": ["run", "typecheck"]}
  ],
  "autoCommit": false
}
```
The model may emit ```file relative/path` blocks. Paths are confined to `workspacePath`; configured checks must pass before the task is accepted. Set `autoCommit` only when you explicitly want CompanySWAI to commit successful task changes.

See `docs/MD-ARCHITECTURE.md`. Provider credentials must never be committed.

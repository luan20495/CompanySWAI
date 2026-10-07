# MD-driven architecture

CompanySWAI keeps agent behaviour in Markdown and runtime mechanics in TypeScript.

## Source of truth
- `company/*.md`: global operating model and quality gates.
- `agents/<id>/IDENTITY.md`: identity, department, activation rule, stage and relevant skills.
- `agents/<id>/RULES.md`: required/optional upstream artifacts, produced artifacts, reviewer and DONE conditions.
- `skills/*.md`: reusable skill context injected only for agents that declare the skill.

## Runtime
TypeScript only parses/validates Markdown, resolves artifact dependencies, chooses active agents, selects providers, enforces budget/concurrency, executes, reviews, checkpoints and records evidence.

No role persona or detailed role rules should be hard-coded in TypeScript.

## Eleven core agents
Product Lead, Business Analyst, Researcher, Tech Lead, Backend Engineer, Frontend Engineer, Mobile Engineer, UX/UI Designer, Independent Reviewer, QA Engineer and DevOps/SRE.

Agents are capability-activated. A backend-only project does not load Frontend or Mobile agent context. Skill files are loaded only when declared by the active agent.

## Dependency model
`RULES.md` declares `requires`, `optionalRequires` and `produces`. The planner connects a consumer task to active producers of the required artifact. Reviewer assignment is also declared in Markdown.

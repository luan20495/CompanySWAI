# Elastic organization

CompanySWAI has **11 core agent definitions** in Markdown (`agents/AGENTS.md` is the authoritative list) and activates only the ones a project needs.

Activation, dependencies, reviewers and model capabilities are declared in each agent's `IDENTITY.md` / `RULES.md`; they are deliberately not repeated here so there is one source of truth. The runtime must not recreate role rules in TypeScript (a test enforces this).

Scale because of capability, complexity, risk or independent-review need — not because more model calls are available. A producer is never its own independent reviewer; the planner and the orchestrator both refuse such a plan.

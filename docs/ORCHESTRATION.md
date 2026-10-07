# Orchestration principles

The company definition is Markdown-first. Runtime orchestration reads `company/*.md`, the active agents' `IDENTITY.md` and `RULES.md`, and only the skills referenced by those active agents.

- Give each agent minimum sufficient context, not the whole project history.
- Resolve work ordering from produced/required artifacts.
- Parallelize only tasks whose dependencies are satisfied.
- Keep reviewer independence.
- Scale review depth with risk.
- Prefer deterministic build/test/lint/profiler evidence over model opinion.
- Route by capability/cost/capacity instead of locking tasks to one provider.
- Persist checkpoints and execution records outside model context.
- Pause safely on capacity exhaustion.
- Compare estimate with actual usage and feed validated lessons into retrospective learning.

TypeScript owns execution mechanics; Markdown owns company behaviour.

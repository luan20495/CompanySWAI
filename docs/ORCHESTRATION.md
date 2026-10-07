# Orchestration principles

- Give each agent minimum sufficient context through references, not the whole conversation.
- Exchange structured Task, Artifact, Decision, Review, Blocker and Handoff records.
- Build a dependency graph and parallelize only independent work.
- Scale review depth with risk. A producer is never the sole approver of critical work.
- Route reasoning-heavy and critical review to stronger models; use cheaper capable models for routine work.
- Prefer deterministic tests, compilers, linters and profilers over model calls when possible.
- Estimate provider capacity and cost before execution. Owner approval is required when configured budget thresholds would be exceeded.
- Persist checkpoints outside model context. Provider failure or quota exhaustion pauses work; it does not erase progress.
- Re-plan against whichever providers are currently available. Tasks specify capability requirements, not a hard-coded provider.
- Compare estimate with actual usage and feed validated lessons into Company Experience.

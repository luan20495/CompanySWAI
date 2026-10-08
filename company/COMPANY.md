# CompanySWAI

CompanySWAI is an MD-driven software company. Markdown is the source of truth for roles, responsibilities, constraints, skills, handoffs and quality gates.

## Operating principles
- Activate only the agents needed by the project.
- Give each agent only the relevant identity, rules, skills and upstream artifacts.
- Do not duplicate work across agents.
- Every output must be reviewable and attributable to a task.
- High-risk work requires stronger review and deterministic evidence.
- Persist progress outside model context so work can resume safely.
- Prefer compiler, test, linter, profiler and benchmark evidence over model opinion.
- Never mark work done while a blocking dependency or required quality gate is unresolved.

## Required output format
Every output follows `company/OUTPUT-CONTRACT.md` (Deliverables, Decisions, Evidence, Blockers, Handoff). That file is the only definition of the contract.

## Code changes
When implementation requires creating or replacing a source file and a project workspace is configured, emit an exact file block:

\`\`\`file relative/path/to/file.ext
<complete file content>
\`\`\`

Never use absolute paths or parent traversal. The runtime applies patches only inside the configured workspace and may run deterministic checks before accepting them.

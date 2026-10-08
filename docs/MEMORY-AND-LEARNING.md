# Memory and organizational learning

## Project memory
Readable Markdown under `.companyswai/projects/<project>/`, written automatically and idempotently: `PLAN.md` (task checklist with state), `REQUIREMENTS.md`, `ARCHITECTURE.md`, `DECISIONS.md`, `HANDOFFS.md`, `REVIEWS.md`, `BLOCKERS.md`, `QA.md`, `STATUS.md`, `RETROSPECTIVE.md`. Routing of outputs to files is declared in `company/MEMORY.md`. Structured JSON records (artifacts, decisions, handoffs, reviews, blockers) sit beside them and the execution log stays the resume source of truth.

Project memory is project scoped. Project-specific facts are never promoted globally.

## Learning loop
1. **Retrospective** (every run end): the run produces project-local lessons (fed back only to the same project) and generic *candidates* with evidence — failures, capacity pauses, cost drift, repeated revisions of one role, contract violations.
2. **Candidate**: stored in `.companyswai/company-experience.json` with the projects that observed it.
3. **Validation**: a candidate is rejected if it looks project-specific (mentions a project id, URL, email, file path, specific figures, a credential, or an unknown role). Otherwise it is `VALIDATED` only after independent observation in two distinct projects.
4. **Reuse**: validated lessons are injected into later plans — company-scoped ones into every agent, `role:<id>` ones only into that role. Rejected and candidate items are never injected. Dry runs never contribute.

Validated lessons carry their evidence and can be removed by editing the experience file; nothing rewrites agent Markdown automatically.

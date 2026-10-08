---
routes: {"product-plan":"REQUIREMENTS.md","research":"REQUIREMENTS.md","requirements":"REQUIREMENTS.md","architecture":"ARCHITECTURE.md","technical-plan":"ARCHITECTURE.md","design-spec":"ARCHITECTURE.md","qa-report":"QA.md","review":"REVIEWS.md"}
fallback: HANDOFFS.md
---
# Project memory

Each project keeps readable Markdown memory under `.companyswai/projects/<project>/`:

PLAN.md, REQUIREMENTS.md, ARCHITECTURE.md, DECISIONS.md, HANDOFFS.md, REVIEWS.md, BLOCKERS.md, QA.md, STATUS.md, RETROSPECTIVE.md.

The runtime appends agent output automatically. The `routes` above map an artifact an agent `produces` (declared in its RULES.md) to the memory file that receives its full output. Artifacts without a route (for example `implementation`, `deployment`) are summarised in HANDOFFS.md. Decisions, blockers, handoffs and reviews are always extracted into DECISIONS.md, BLOCKERS.md, HANDOFFS.md and REVIEWS.md.

Memory is project scoped. Nothing here is promoted to company-wide experience except through the validated learning loop.

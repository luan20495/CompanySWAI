# Elastic organization

CompanySWAI has **11 core agent definitions** in Markdown, but only activates the roles a project actually needs.

## Source of truth
Activation is declared in each `agents/<id>/IDENTITY.md`.
Dependencies and handoffs are declared in `agents/<id>/RULES.md`.
The runtime must not recreate these role rules in TypeScript.

## Scaling
- Product Lead, Business Analyst, Tech Lead, Reviewer and QA are core control/quality roles.
- Researcher activates for higher-complexity work.
- Backend Engineer activates only for backend capability.
- Frontend Engineer activates only for web UI capability.
- Mobile Engineer activates only for mobile capability.
- UX/UI Designer activates only when web or mobile UI exists.
- DevOps/SRE activates only when deployment responsibility exists.

Scale because of capability, complexity, risk or independent-review need — not because more model calls are available.

## Collaboration
Artifact dependencies define the graph. For example:
Product Plan → Requirements → Architecture → Design/Implementation → Review → QA.

A producer cannot be its own independent reviewer.

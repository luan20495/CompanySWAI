---
requires: ["product-plan"]
optionalRequires: ["research"]
produces: ["requirements"]
reviewedBy: reviewer
---
# Business Analyst rules

## Cannot start
- Required artifact `product-plan` is unavailable.

## Done only when
- Acceptance criteria are testable
- Functional and non-functional requirements are separated
- Edge cases and unresolved ambiguities are explicit

## Handoff
- Name produced artifacts: `requirements`.
- Include blockers, decisions, evidence and next-owner information.

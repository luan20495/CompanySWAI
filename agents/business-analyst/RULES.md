---
requires: ["product-plan"]
optionalRequires: ["research"]
produces: ["requirements"]
reviewedBy: reviewer
validators: ["requirements-ids"]
extraSections: ["Requirements"]
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

## Output format (enforced)
Besides the standard sections, emit `## Requirements`: one entry per requirement with a stable ID, a basis label and testable acceptance criteria:

```
- [REQ-001] FACT: Users can pay by card at checkout. (basis: product-plan)
  - [AC-001.1] Given a cart with items, when the user pays with a valid card, then an order is created and a receipt is shown.
  - [AC-001.2] Given an expired card, when the user pays, then payment is declined with a clear message.
- [REQ-002] ASSUMPTION: Guest checkout is allowed.
  - [AC-002.1] …
```
Basis labels: FACT (stated in the brief, product plan or cited research — name it in `(basis: …)`), ASSUMPTION (not yet confirmed), INFERENCE (derived from other requirements), RECOMMENDATION (your proposal). Every requirement needs at least one acceptance criterion. Do not renumber IDs between revisions.

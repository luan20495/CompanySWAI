---
requires: ["requirements","implementation"]
optionalRequires: ["deployment","design-spec"]
produces: ["qa-report"]
reviewedBy: none
---
# QA Engineer rules

## Cannot start
- Required artifact `requirements` is unavailable.
- Required artifact `implementation` is unavailable.

## Done only when
- Acceptance criteria are covered
- Integration and regression risks are tested
- Failures include reproducible evidence
- PASS is blocked by unresolved critical defects

## Handoff
- Name produced artifacts: `qa-report`.
- Include blockers, decisions, evidence and next-owner information.

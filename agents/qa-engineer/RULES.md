---
requires: ["requirements","implementation"]
optionalRequires: ["deployment","design-spec"]
produces: ["qa-report"]
reviewedBy: none
validators: ["qa-traceability"]
extraSections: ["QA Status","Traceability"]
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

## Output format (enforced)
Derive tests from the requirements and their acceptance criteria (REQ-/AC- IDs in the requirements artifact) and from risk.

`## QA Status` — first line is the overall result: `PASS`, `FAIL`, `BLOCKED` or `NOT_APPLICABLE`, then a short reason. It must agree with the individual results (any FAIL → FAIL, else any BLOCKED → BLOCKED, else all NOT_APPLICABLE → NOT_APPLICABLE, else PASS). These are QA outcomes, not reviewer verdicts.

`## Traceability` — every requirement ID appears at least once:
```
- [REQ-001] -> [T-001] PASS: card payment creates an order | evidence: command and result
- [REQ-001] -> [T-002] FAIL: expired card message missing | evidence: reproduction steps
- [REQ-002] -> [T-003] BLOCKED: staging payment sandbox unavailable
- [REQ-003] -> NOT_APPLICABLE: covered by deployment, not by product behaviour
```
PASS and FAIL need `| evidence:`; BLOCKED and NOT_APPLICABLE need a reason. Test IDs are unique (`T-001`…).

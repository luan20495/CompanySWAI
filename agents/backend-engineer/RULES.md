---
requires: ["requirements","architecture"]
optionalRequires: []
produces: ["implementation"]
reviewedBy: reviewer
---
# Backend Engineer rules

## Cannot start
- Required artifact `requirements` is unavailable.
- Required artifact `architecture` is unavailable.

## Done only when
- Implementation matches contracts
- Tests cover critical behavior
- Errors/security/data consistency are handled
- Changed artifacts are enumerated

## Handoff
- Name produced artifacts: `implementation`.
- Include blockers, decisions, evidence and next-owner information.

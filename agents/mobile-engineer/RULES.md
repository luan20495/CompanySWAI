---
requires: ["requirements","architecture","design-spec"]
optionalRequires: []
produces: ["implementation"]
reviewedBy: reviewer
deliversCode: true
---
# Mobile Engineer rules

## Cannot start
- Required artifact `requirements` is unavailable.
- Required artifact `architecture` is unavailable.
- Required artifact `design-spec` is unavailable.

## Done only when
- Lifecycle/offline/network/platform behavior is handled
- Native-specific risk is identified where relevant
- Tests cover critical behavior
- Changed artifacts are enumerated

## Handoff
- Name produced artifacts: `implementation`.
- Include blockers, decisions, evidence and next-owner information.

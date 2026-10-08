---
requires: ["requirements"]
optionalRequires: ["research"]
produces: ["architecture","technical-plan"]
reviewedBy: reviewer
reviewLens: architecture
---
# Tech Lead rules

## Cannot start
- Required artifact `requirements` is unavailable.

## Done only when
- Boundaries and contracts are explicit
- Dependencies are acyclic and actionable
- Security/performance risks are identified
- Rollback or migration concerns are noted when relevant

## Handoff
- Name produced artifacts: `architecture`, `technical-plan`.
- Include blockers, decisions, evidence and next-owner information.

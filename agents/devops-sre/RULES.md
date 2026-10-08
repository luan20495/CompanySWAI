---
requires: ["architecture"]
optionalRequires: ["implementation"]
produces: ["deployment"]
reviewedBy: reviewer
deliversCode: true
---
# DevOps / SRE rules

## Cannot start
- Required artifact `architecture` is unavailable.

## Done only when
- Build/deploy path is reproducible
- Health/observability and rollback are defined
- Secrets/config are externalized
- Failure recovery is documented

## Handoff
- Name produced artifacts: `deployment`.
- Include blockers, decisions, evidence and next-owner information.

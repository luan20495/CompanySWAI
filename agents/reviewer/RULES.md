---
requires: []
optionalRequires: []
produces: ["review"]
reviewedBy: none
---
# Independent Reviewer rules

## Cannot start
- No internal artifact dependency blocks initial work.

## Done only when
- Verdict begins PASS or CHANGES_REQUIRED
- Findings cite concrete evidence
- Missing required evidence causes CHANGES_REQUIRED

## Handoff
- Name produced artifacts: `review`.
- Include blockers, decisions, evidence and next-owner information.

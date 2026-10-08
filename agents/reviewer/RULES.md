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

## Verdict discipline (so reviews converge)
- `CHANGES_REQUIRED` is for defects: behaviour that would be wrong, a security/data-integrity/availability failure, a violated requirement or contract, a contradiction inside the artifact, or evidence the work needs and does not have. List each one under `## Blockers`, with where it is and what would fix it.
- Improvements, preferences, nice-to-have hardening and open questions that do not make the work wrong are not blockers: give `PASS` and list them under `## Evidence` as notes. A risk the author states honestly, names an owner for and gates is not a defect.
- Be complete in the first round: raise every blocking defect you can find now, so the author can fix them together. Do not hold findings back for later rounds.
- In a re-review, first verify each of your own previous findings against the revised artifact (resolved / not resolved, with evidence). Then raise a new blocker only if it is a real defect that the revision introduced or that you missed earlier and that would cause failure; do not widen the scope of your demands round after round.
- Never ask for something that is already in the artifact: read the whole artifact before saying a section is missing.

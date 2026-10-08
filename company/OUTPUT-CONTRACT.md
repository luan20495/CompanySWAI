---
sections: ["Deliverables","Decisions","Evidence","Blockers","Handoff"]
reviewerSections: ["Evidence","Blockers"]
verdicts: ["PASS","CHANGES_REQUIRED"]
---
# Output contract

Every maker output uses these level-2 headings, in this order, each with content:

## Deliverables
What was produced, by name. For code changes, exact file blocks (see Code changes in COMPANY.md).

## Decisions
Decisions taken and why. Write `None.` when there are none.

## Evidence
Concrete proof: test/build/lint output, benchmarks, citations, upstream artifact references. Never opinion alone.

## Blockers
Anything that prevents DONE or needs a human/another agent. Write `None.` when clear.

## Handoff
What the next owner needs: produced artifact names, open questions, constraints.

## Reviewer outputs
The first non-empty line is the verdict: `PASS` or `CHANGES_REQUIRED`. Then `## Evidence` (what was checked) and `## Blockers` (required changes, or `None.`). `PASS` is forbidden when required evidence is missing.

The runtime validates this contract. A response missing a required section is sent back once for repair; if it is still incomplete the attempt fails and is recorded.

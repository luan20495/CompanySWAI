# Elastic organization

CompanySWAI does not have a fixed headcount. It has stable departments, role contracts and quality gates.

## Composition
A project declares capabilities and complexity. The orchestrator activates only departments that add value.
- No UI: no Design or Frontend department.
- No deployment responsibility: Platform can be omitted.
- Security-critical: add security specialists and an extra review layer.
- High complexity: add makers/reviewers, not redundant managers.

## Scaling rule
Scale because of workload, risk, domain breadth or independent-review need — never just because more agents are available.

## Collaboration patterns
Implementation: Maker → Reviewer → Approver.
Research: Researcher → Analyst → Critic.
UI: UX/UI specification → Frontend implementation → Designer inspection of running product → QA.
Architecture: Proposal → adversarial review → Tech Lead decision → ADR.

A producing agent cannot be the sole approver of its own work.

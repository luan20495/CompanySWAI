---
codeGates: {
 "typecheck":{"appliesWhen":"always"},
 "unit-tests":{"appliesWhen":"always"},
 "integration-tests":{"appliesWhen":"capability:backend|mobile"},
 "lint":{"appliesWhen":"always"},
 "build":{"appliesWhen":"capability:web-ui|mobile|deployment"},
 "security":{"appliesWhen":"capability:security-critical"},
 "project-checks":{"appliesWhen":"always"}
}
architectureCategories: {
 "modularity":{"appliesWhen":"always"},
 "maintainability":{"appliesWhen":"always"},
 "scalability":{"appliesWhen":"complexity>=3|capability:performance-critical"},
 "security":{"appliesWhen":"capability:security-critical|backend|web-ui|mobile"},
 "observability":{"appliesWhen":"capability:backend|deployment"},
 "portability":{"appliesWhen":"capability:deployment|mobile"},
 "cost":{"appliesWhen":"capability:deployment|backend"},
 "failure-modes":{"appliesWhen":"capability:backend|deployment|mobile"},
 "data-integrity":{"appliesWhen":"capability:backend"},
 "backward-compatibility":{"appliesWhen":"signal:brownfield|migration|legacy"}
}
lenses: {
 "architecture":{"validator":"architecture-review","instruction":"Review this architecture against the applicable categories listed below before any implementation starts. Use the exact section format required by the architecture-review contract."},
 "security":{"skill":"security","instruction":"Apply the security lens: threat model, input validation, authorization, secrets handling, dependency risk. Missing evidence is CHANGES_REQUIRED."}
}
qaStatuses: ["PASS","FAIL","BLOCKED","NOT_APPLICABLE"]
---
# Quality gates catalogue

Machine-readable catalogue used by the runtime; the prose rules live in `QUALITY-GATES.md`.

## Code gates
A coding task is not DONE because code was generated. Gates apply when a workspace is configured; each applicable, required gate must be configured and pass (typecheck, unit tests, integration tests, lint, build, security checks, deterministic project checks). A required gate that is not configured fails the task with an explicit "gate not configured" reason instead of passing silently.

## Architecture review categories
Architecture is reviewed before implementation tasks start. Only the categories whose `appliesWhen` matches the project are reviewed; the review records an explicit verdict per category, the decisions taken and the unresolved risks.

## QA statuses
QA classifies each requirement-linked test as `PASS`, `FAIL`, `BLOCKED` or `NOT_APPLICABLE`. These are QA outcomes, never reviewer verdicts (reviewers say `PASS` or `CHANGES_REQUIRED`).

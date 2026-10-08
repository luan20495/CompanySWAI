---
levels: {
 "NORMAL":{"reviewers":1,"gates":[]},
 "CRITICAL":{"reviewers":2,"gates":[]},
 "HIGH_RISK":{"reviewers":2,"gates":["checks","qa","security"]}
}
qaDepth: {
 "light":{"minTests":1,"guidance":"Light QA: cover each requirement with at least one test of its main acceptance criterion."},
 "standard":{"minTests":1,"guidance":"Standard QA: cover every acceptance criterion of every requirement and the main regression risks."},
 "deep":{"minTests":2,"guidance":"Deep QA: at least two independent tests per requirement (a normal case and a failure/boundary case), integration boundaries, regression risks and security- and performance-relevant behaviour where the project signals them."}
}
modes: {
 "FAST":{
  "reviewRisks":["high","critical"],
  "levelByRisk":{"high":"NORMAL","critical":"NORMAL"},
  "routing":"COST_FIRST","minQualityTier":1,"requiredGates":["project-checks"],"qa":"light"
 },
 "BALANCED":{
  "reviewRisks":["low","medium","high","critical"],
  "levelByRisk":{"low":"NORMAL","medium":"NORMAL","high":"NORMAL","critical":"CRITICAL"},
  "routing":"BALANCED","minQualityTier":3,"requiredGates":["typecheck","unit-tests","project-checks"],"qa":"standard"
 },
 "MAX_QUALITY":{
  "reviewRisks":["low","medium","high","critical"],
  "levelByRisk":{"low":"NORMAL","medium":"NORMAL","high":"CRITICAL","critical":"HIGH_RISK"},
  "routing":"QUALITY_FIRST","minQualityTier":4,"requiredGates":["typecheck","unit-tests","integration-tests","lint","build","security","project-checks"],"qa":"deep"
 }
}
---
# Review and quality policy

Quality mode (`FAST`, `BALANCED`, `MAX_QUALITY`, chosen in the project brief) decides how much independent assurance a project gets. Risk comes from the brief (security-critical > performance-critical > high complexity).

## Review levels
- **NORMAL**: one independent reviewer.
- **CRITICAL**: two independent reviewers in separate contexts. Both must `PASS`; any `CHANGES_REQUIRED` sends the work back to its maker with every finding, and a PASS/CHANGES_REQUIRED split is recorded as a reviewer disagreement and reconciled by the revision.
- **HIGH_RISK**: two reviewers (the second applies the security lens where security applies), deterministic checks must have passed, and the project is only accepted when the QA gate passes.

## Modes
- **FAST**: reviews only high and critical risk work; cheapest eligible provider; light QA.
- **BALANCED**: every reviewable task is reviewed; critical work is double-reviewed; balanced routing.
- **MAX_QUALITY**: strongest eligible provider tier, critical work is HIGH_RISK, high-risk work is double-reviewed, all applicable code gates, deep QA, architecture/security/performance lenses wherever the project signals need them.

A reviewer receives only the task requirements, the artifact/diff, the architecture and decisions that apply, and test evidence. It never receives the maker's reasoning, conversation or unrelated project context.

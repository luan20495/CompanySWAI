# Quality gates

## Universal
- Requirement coverage is explicit.
- No unresolved critical blocker.
- Output names concrete artifacts or changed files when implementation work occurs.
- Assumptions and uncertainty are stated.
- Secrets are never committed.

## Engineering
- Build/typecheck/lint/test evidence when applicable.
- Error paths and edge cases covered.
- Concurrency, I/O, persistence and networking considered where relevant.
- Security-sensitive changes include threat/failure analysis.
- Performance-sensitive decisions require benchmark, profiler, trace or load-test evidence.

## Review
Reviewer must start with PASS or CHANGES_REQUIRED.
PASS is forbidden when required evidence is missing.

## QA
QA validates behavior against acceptance criteria, regression risk and integration boundaries, not only happy paths.

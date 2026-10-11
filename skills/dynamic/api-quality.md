---
name: api-quality
version: 1.0.0
description: API design review and integration testing: resource model, status/error contracts, authorization, idempotency, compatibility, real-boundary tests.
appliesTo: ["tech-lead", "backend-engineer", "qa-engineer", "reviewer"]
capabilities: []
keywords: ["api", "rest", "endpoint", "openapi", "graphql", "grpc", "webhook", "contract test", "integration test"]
tags: []
source: https://github.com/johnqtcg/awesome-skills
sourceCommit: ac0614056cde57640c73bf624dd2c8c34c638ae0
upstreamPath: skills/api-design/SKILL.md
license: MIT
decision: ADAPT
alsoFrom: [{"source": "https://github.com/johnqtcg/awesome-skills", "sourceCommit": "ac0614056cde57640c73bf624dd2c8c34c638ae0", "upstreamPath": "skills/api-integration-test/SKILL.md", "license": "MIT"}]
attribution: Adapted from johnqtcg/awesome-skills api-design and api-integration-test, Copyright (c) 2026 john.q.tcg, MIT License. Changes: distilled, Go-specific parts removed.
riskLevel: low
requiresNetwork: false
requiresBrowser: false
requiresExternalBinary: []
requiresCredentials: false
overlapGroup: api-method
outputContract: ["Findings", "Tests"]
---
# API quality (design review and integration tests)

**Design checklist**
- Resources are nouns; verbs live in methods. Stable identifiers, consistent naming, no leaking of internal schema.
- Status codes carry meaning (201 create, 204 empty, 400 vs 422 validation, 401 vs 403, 404, 409 conflict, 429). Never 200 for failure.
- One error model everywhere: machine code, human message, field details, correlation id. No stack traces or internals.
- Authorization on the server for every object (IDOR check: can user A read or change user B's id?). Tenant and workspace scoping on every query.
- Pagination, filtering and sorting bounded by default; maximum page size; stable ordering.
- Writes that move money or have side effects accept an idempotency key; retries are safe; concurrent updates use versions or ETags.
- Compatibility: additive changes only within a version; removal and meaning changes need a version and a deprecation path. Say who breaks.
- Operability: rate limits, timeouts, request size limits, correlation ids, audit of sensitive actions.

**Integration tests (against real boundaries)**
- Taxonomy: happy path, validation failures, auth failures (none / wrong role / wrong tenant), not-found, conflict, idempotent replay, pagination edges, error model shape, contract against the spec.
- Test through the real HTTP layer and real storage when practical; mocks only for third parties you do not own.
- Deterministic data created and cleaned up by the test; no dependence on order, clocks or a shared environment.
- Skip vs fail: a missing dependency or configuration FAILS the required suite in CI; a skip is only for a declared optional integration.
- Never point tests at production or real customer data. Secrets come from the environment, never from the repository.

**Review output.** Per finding: severity | endpoint | rule broken | concrete consumer impact | fix. Mark design issues as design issues, not implementation bugs. Evidence is a request/response example or a test name, not an opinion.

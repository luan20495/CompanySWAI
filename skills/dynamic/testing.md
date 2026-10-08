---
name: testing
appliesTo: ["backend-engineer","frontend-engineer","mobile-engineer","qa-engineer","reviewer"]
capabilities: []
keywords: ["test strategy","tdd","coverage","e2e","end-to-end","test automation","regression","integration test","contract test"]
---
# Testing

Derive tests from requirements and acceptance criteria, then from risk. Follow the pyramid: many fast deterministic unit tests, fewer integration/contract tests at real boundaries, a thin e2e layer for critical journeys. Cover error paths, boundaries, concurrency and idempotency, not only the happy path. Tests are deterministic (no wall-clock, network or ordering dependence), isolated, and fail for one clear reason; fix flaky tests, never retry-mask them. Use real dependencies (containers) for integration tests when mocks would hide behaviour. Every defect fix gets a regression test. Report results with exact commands and outcomes.

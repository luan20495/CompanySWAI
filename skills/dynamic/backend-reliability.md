---
name: backend-reliability
version: 1.0.0
description: Backend reliability rules: timeouts, retries, idempotency, backpressure and graceful degradation.
appliesTo: ["tech-lead","backend-engineer","devops-sre","reviewer","qa-engineer"]
capabilities: ["deployment"]
keywords: ["reliability","sla","slo","availability","retry","timeout","circuit breaker","fault tolerant","resilience","failover","uptime"]
source: companyswai
license: LicenseRef-CompanySWAI
decision: NATIVE
riskLevel: low
outputContract: ["Evidence"]
---
# Backend reliability

Every outbound call has a timeout, bounded retries with backoff+jitter and an idempotency story; apply rate limiting and load shedding at the edge; use health/readiness checks and graceful shutdown (drain in-flight work). Define SLOs and error budgets, then design degradation modes (what still works when a dependency is down). Make operations idempotent and recoverable (retry-safe writes, dead-letter queues, replayable jobs). Protect against resource exhaustion (bounded pools, queues, payload sizes). Document runbooks, rollback and the blast radius of each change. Evidence: failure-injection or chaos-style tests for the top failure modes.

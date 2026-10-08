---
name: distributed-systems
appliesTo: ["tech-lead","backend-engineer","devops-sre","reviewer"]
capabilities: []
keywords: ["distributed","microservice","microservices","queue","kafka","event-driven","saga","consensus","replication","sharding","idempotency","eventual consistency","message broker"]
minComplexity: 5
---
# Distributed systems

Assume partial failure, reordering, duplication and clock skew. Define consistency per operation (strong vs eventual) and the invariants that must survive. Make every cross-service call carry a timeout, bounded retries with jittered backoff and an idempotency key; use circuit breakers/bulkheads to contain failure; apply backpressure instead of unbounded queues. Prefer at-least-once delivery with idempotent consumers; use outbox/saga patterns instead of distributed transactions; version message schemas compatibly. Name the failure modes (partition, slow dependency, poison message, thundering herd) and the designed behaviour for each. Reviewers: reject designs without explicit failure behaviour or idempotency.

---
name: performance
appliesTo: ["tech-lead","backend-engineer","frontend-engineer","mobile-engineer","reviewer","qa-engineer"]
capabilities: ["performance-critical"]
keywords: ["latency","throughput","p99","p95","benchmark","high traffic","load","scale","concurrent users","response time"]
---
# Performance

State a measurable budget first (p95/p99 latency, throughput, memory, startup time) and the workload it applies to. Find the bottleneck by measuring (profiler, trace, benchmark) before optimising. Reason about complexity of hot paths, allocation and GC pressure, N+1 queries, missing indexes, lock contention, blocking I/O on request threads, cache hit rate and invalidation. Prefer algorithmic and data-layout wins over micro-tuning. Every performance claim needs repeatable evidence (benchmark or load-test command and result); every optimisation needs a regression guard. Reviewers: reject unmeasured performance claims and unbounded queries, loops over remote calls, or unbounded memory growth.

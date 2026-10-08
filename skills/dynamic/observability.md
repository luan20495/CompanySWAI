---
name: observability
appliesTo: ["tech-lead","backend-engineer","devops-sre","reviewer","qa-engineer"]
capabilities: ["deployment"]
keywords: ["logging","metrics","tracing","monitoring","alerting","telemetry","observability","dashboard","opentelemetry"]
---
# Observability

Emit structured logs (levels, correlation/trace IDs, no secrets or personal data), RED/USE metrics for every service and dependency, and distributed traces across boundaries (OpenTelemetry). Define SLIs/SLOs and alert on symptoms (user-visible error rate, latency) rather than causes; every alert links to a runbook. Make failures diagnosable: include enough context in errors, expose version/build info, add health endpoints. Keep cardinality and log volume bounded and budgeted. Evidence: show the dashboard/alert definitions and how a failure injected in a test becomes visible.

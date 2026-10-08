---
name: devops
appliesTo: ["tech-lead","devops-sre","reviewer"]
capabilities: ["deployment"]
keywords: ["ci/cd","pipeline","docker","kubernetes","terraform","infrastructure","helm","deployment","release","iac"]
---
# DevOps

Builds are reproducible (pinned dependencies and base images, lockfiles, no network at runtime build where avoidable); infrastructure is code (Terraform/Helm/compose) reviewed like application code; environments are promoted through the same artifact, with config and secrets injected from the environment/secret store. CI runs typecheck, tests, lint, build, dependency/secret scans and publishes provenance; CD supports canary/blue-green with automatic rollback on failed health checks. Containers run as non-root with minimal images and resource limits. Document the deploy, rollback and disaster-recovery procedure and test it.

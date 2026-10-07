# CompanySWAI

A reusable AI software-company runtime designed to run locally. Teams are composed from project capabilities and complexity instead of being hard-coded to one language or framework.

## Current architecture
- Product: Product Lead, BA, Researcher, Product Critic.
- Architecture: Tech Lead plus security/performance specialists when risk requires them.
- Backend and Frontend: elastic engineering teams with independent review.
- Mobile: platform-neutral Mobile Architect/Engineer with Android and iOS native specialists for deep platform work.
- Design: UX research, UX, UI and independent design review.
- Platform: DevOps/SRE and platform security as needed.
- QA: functional/API, automation/E2E and performance/security coverage.

All engineering roles follow the engineering fundamentals baseline in `docs/ENGINEERING-BASELINE.md`.

## Runtime core implemented
- Capability/complexity based team composition.
- Structured Task, Review and Checkpoint contracts.
- Dependency-aware scheduler.
- Provider capacity eligibility and cost-aware routing primitives.
- Provider-neutral model interface and registry.
- Persistent task checkpoints under `.companyswai/checkpoints/`.
- Persistent per-agent execution records under `.companyswai/executions/<project>/records.jsonl`.
- Task runner records STARTED/SUCCEEDED/FAILED output, token usage and writes a resumable checkpoint.
- Core automated tests.

## Execution visibility
Agent output is not allowed to exist only in chat context. Each execution is appended as a structured record containing project/task/agent, provider/model, input references, output, artifacts/decisions/reviews, token usage, cost fields, timestamps and status. This becomes the source for the future local dashboard and audit trail.

## Verification
```bash
npm install
npm run check
```

## Not finished yet
The repository is not yet a complete autonomous software company. Real provider adapters, live quota/credit discovery where providers permit it, multi-agent review/approval loop, project workspace tooling, CLI, and the local web dashboard still need to be connected and verified end-to-end.

Provider credentials must never be committed.

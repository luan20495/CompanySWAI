# CompanySWAI

An AI software company you can run locally: one Product Lead coordinates specialist agents through explicit tasks, artifacts, reviews, and quality gates.

## Team
- Product Lead — talks to the owner, discovers requirements, owns scope, plan and delivery.
- Tech Lead — architecture, technical contracts, integration and engineering quality.
- Designer — UX flows, UI constitution, design tokens, prototype and post-build UI review.
- Backend — domain, API, data, security implementation.
- Frontend — implements approved UX/UI and frontend behavior.
- Infra — environments, CI/CD, observability, reliability.
- QA — requirement traceability, automated coverage, regression and release evidence.

## Workflow
Owner → Product Lead → Tech Lead → specialists → review gates → QA → Product Lead → Owner.

Agents never hand off vague prose. Every handoff uses a Task Contract and produces named Artifacts with acceptance criteria and evidence.

## Local start
1. Clone this repository.
2. Copy `.env.example` to `.env`.
3. Configure an available model provider and model.
4. Install dependencies: `npm install`.
5. Run: `npm run dev -- "Describe the product you want to build"`.

> Provider credentials are intentionally not committed. Use a provider/API authentication method supported by your local environment.

## Status
v0.1 bootstrap: agent roles, orchestration protocol, Claude-compatible provider adapter, CLI runner, and quality gates.

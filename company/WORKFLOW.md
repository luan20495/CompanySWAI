# Company workflow

1. Product Lead turns the project brief into product intent, scope and constraints.
2. Researcher is activated only when complexity or uncertainty requires external/domain investigation.
3. Business Analyst converts product intent and available research into explicit requirements and acceptance criteria.
4. Tech Lead produces architecture, technical decomposition, dependency graph and implementation constraints.
5. UX/UI Designer is activated only for web or mobile UI work.
6. Backend, Frontend and Mobile engineers are activated only for relevant capabilities and may run in parallel when dependencies allow.
7. DevOps/SRE is activated only when deployment or infrastructure work is required.
8. Independent Reviewer reviews implementation or high-risk technical work and cannot review its own authored task.
9. QA Engineer validates the integrated result against requirements and risk.
10. Retrospective records reusable lessons without leaking project secrets.

The runtime resolves dependencies from required and produced artifacts declared in each agent RULES.md.

# Memory and organizational learning

## Project Memory
Project-specific facts remain isolated under `.companyswai/projects/<project>/` and project retrospective storage. They are not automatically treated as universal company rules.

## Company Experience
Only reusable execution lessons are eligible for cross-project promotion. CompanySWAI stores these in `.companyswai/company-experience.json`.

## Promotion
1. A retrospective emits generic execution lessons.
2. The lesson enters Company Experience as `CANDIDATE`.
3. The same lesson must be observed in at least two distinct projects before becoming `VALIDATED`.
4. Only validated lessons are injected into future plans across projects.
5. Project-specific requirements, product decisions, secrets and domain data are never promoted by this mechanism.

This is deliberately conservative: one successful or failed project is not enough to rewrite company behaviour.

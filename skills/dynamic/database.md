---
name: database
appliesTo: ["tech-lead","backend-engineer","devops-sre","reviewer","qa-engineer"]
capabilities: []
keywords: ["database","sql","postgres","postgresql","mysql","sqlite","mongodb","schema","migration","transaction","data model","persistence","ledger","inventory","orders"]
---
# Database

Model entities and invariants explicitly; enforce them in the database (constraints, foreign keys, unique indexes), not only in code. Choose isolation level per use case and keep transactions short; make writes idempotent where retries exist. Design indexes from actual query patterns and check plans (EXPLAIN); avoid N+1 and unbounded scans; paginate with stable keys. Migrations are versioned, forward-safe (expand/contract), tested on realistic data and reversible or backed up; never edit applied migrations. Plan backup/restore and data retention; protect personal data (encryption, minimisation). Reviewers: demand a migration plan, rollback story and evidence of query plans for hot paths.

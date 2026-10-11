---
name: migration-review
version: 1.0.0
description: PostgreSQL schema-migration safety: lock analysis, online-safe DDL, expand/contract, backfills, rollback, Flyway discipline.
appliesTo: ["backend-engineer", "reviewer", "devops-sre", "tech-lead"]
capabilities: []
keywords: ["migration", "flyway", "alter table", "ddl", "schema change", "backfill", "add column", "create index"]
tags: ["postgres", "schema-migration"]
source: https://github.com/johnqtcg/awesome-skills
sourceCommit: ac0614056cde57640c73bf624dd2c8c34c638ae0
upstreamPath: skills/pg-migration/SKILL.md
license: MIT
decision: ADAPT
attribution: Adapted from johnqtcg/awesome-skills pg-migration, Copyright (c) 2026 john.q.tcg, MIT License. Changes: distilled, Flyway-specific rules added.
riskLevel: low
requiresNetwork: false
requiresBrowser: false
requiresExternalBinary: []
requiresCredentials: false
overlapGroup: db-migration-method
outputContract: ["Findings", "Scorecard"]
---
# Migration safety review (PostgreSQL)

Review every schema change as if it will run on a large, busy production database with the old application version still serving traffic.

**Lock level first.** For each statement name the lock it takes and how long. Dangerous: ALTER TABLE that rewrites or scans (column type change, ADD COLUMN with a volatile default on old versions, SET NOT NULL without a validated check), CREATE INDEX without CONCURRENTLY, foreign keys added validated, long transactions around DDL.

**Online-safe patterns.**
- Indexes: CREATE INDEX CONCURRENTLY (outside a transaction block; tell the migration tool).
- Constraints: ADD CONSTRAINT ... NOT VALID, then VALIDATE CONSTRAINT separately. NOT NULL via a validated CHECK first.
- Set lock_timeout (and statement_timeout where right) before DDL so a blocked change fails fast instead of queueing every query behind it.
- Type changes and renames: expand, migrate, contract across releases; never rename or drop in the same release the code stops using it.
- Backfills: batched, resumable, throttled, outside the DDL transaction; no single UPDATE over millions of rows.

**Data integrity.** Constraints match the invariants; defaults and nullability agree with the application; tenant_id and composite keys preserved; destructive steps (DROP, TRUNCATE, narrowing a type) need a data-loss statement and a backup point.

**Compatibility and rollback.** Old and new application versions must both work against the intermediate schema. Provide an undo plan, or state plainly that the change is irreversible and why that is acceptable.

**Flyway discipline.** Never edit an applied migration; add a new version. Numbers are allocated by the project owner, never chosen by the author. Do not enable out-of-order. Repeatable migrations only for idempotent objects.

**Scorecard.** Critical (any FAIL fails): lock safety, data-loss handled, old/new compatibility, rollback stated. Standard (80% must pass): backfill batching, timeouts set, constraint validation split, index strategy, test on realistic volume. Report each failing item with the statement and the fix.

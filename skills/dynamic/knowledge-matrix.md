---
name: knowledge-matrix
version: 1.0.0
description: Build a knowledge matrix: what is known, how we know it, how confident, who needs it, and what is still unknown.
appliesTo: ["researcher", "tech-lead", "business-analyst", "product-lead"]
capabilities: []
keywords: ["knowledge matrix", "knowledge map", "landscape", "discovery", "unfamiliar", "legacy", "onboarding", "existing system", "system inventory", "as-is analysis"]
tags: ["brownfield", "knowledge-mapping"]
source: companyswai
license: LicenseRef-CompanySWAI
decision: NATIVE
riskLevel: low
requiresNetwork: false
requiresBrowser: false
requiresExternalBinary: []
requiresCredentials: false
outputContract: ["Matrix", "Unknowns"]
---
# Knowledge matrix

Turn an unfamiliar problem or system into a matrix others can act on. Use only the brief, upstream artifacts and retrieved sources; never fill a cell from memory and call it known.

**Matrix (one row per topic).**
| Topic | Claim | Basis | Evidence ref | Confidence | Needed by | Next step |
- Basis is exactly one of FACT (a cited artifact, source or repository fact), INFERENCE (derived from facts, say from which), ASSUMPTION (unverified, say what would verify it).
- Evidence ref is an artifact id, source id or `repo:` path. A FACT without a ref is an ASSUMPTION.
- Confidence is HIGH / MEDIUM / LOW and follows the weakest basis in the row.
- Needed by names the role or task that will consume the row, so nothing is mapped that nobody uses.

**Coverage view.** A second small table of requirement or question rows against evidence columns. Empty cells are the finding: list them under Unknowns, each with an owner and the cheapest way to close it.

**Mapping an existing system.** Capture: entry points, module boundaries, data stores and owners, external integrations, invariants that must not break, hot or shared files, existing tests and gates, known risks. Cite paths. Separate what the code does from what documents claim it does; where they disagree, record both.

**Discipline.** Prefer 15 verified rows to 60 guesses. Merge duplicates, date the matrix, and mark rows that decay (versions, prices, limits). Do not rank or recommend here; hand a clean matrix to the next role.

Output: Matrix, Coverage, Unknowns (owner + how to close), Handoff (which rows each downstream task must read).

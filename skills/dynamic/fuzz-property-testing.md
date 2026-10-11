---
name: fuzz-property-testing
version: 1.0.0
description: Property-based testing and fuzzing: where it applies, which properties to state, deterministic CI seeds, shrinking and corpus discipline.
appliesTo: ["backend-engineer", "frontend-engineer", "qa-engineer", "reviewer"]
capabilities: []
keywords: ["fuzz", "fuzzing", "property-based", "property test", "round-trip", "parser", "serializer", "deserialization", "invariant"]
tags: ["fuzzing"]
source: companyswai
license: LicenseRef-CompanySWAI
decision: NATIVE
riskLevel: low
requiresNetwork: false
requiresBrowser: false
requiresExternalBinary: []
requiresCredentials: false
outputContract: ["Properties", "Evidence"]
---
# Property-based testing and fuzzing

Example tests check the cases you thought of; properties check the cases you did not. Use them where input space is large and rules are crisp.

**Applicability gate.** Worth it for: parsers, serializers/deserializers, validators, normalisers, money and date arithmetic, state machines, encoders, permission rules, anything with an inverse or an oracle. Skip: code dominated by I/O or framework wiring, and one-off glue. If it does not apply, say so and use example tests.

**State properties, not examples.**
- Round trip: decode(encode(x)) == x.
- Idempotence: f(f(x)) == f(x) for normalisers.
- Invariants: totals balance, ordering preserved, no negative balance, output always valid against the schema.
- Oracle or model: compare with a simple slow reference.
- Metamorphic: changing the input in a known way changes the output in a known way.
- Robustness: arbitrary input never crashes, hangs or leaks; it returns a typed error.

**Generators.** Build them from the domain (valid values, boundary values, hostile values: empty, huge, unicode, nulls, negative, overflow), not from raw random bytes alone. Keep them small and composable.

**Determinism.** CI runs a fixed seed and a bounded number of cases so it never flakes; exploration runs with fresh seeds elsewhere. Every failure must print its seed and the shrunk minimal counterexample; commit that case as a permanent regression test.

**Tools by stack.** JVM: jqwik. TypeScript: fast-check. Python: Hypothesis. Go: native fuzzing. Coverage-guided fuzzers are optional extras; their absence is not a failure, say NOT RUN.

**Report.** Property | generator | cases run | seed | result. A property that never found anything is still valuable only if it could have failed: say why it could.

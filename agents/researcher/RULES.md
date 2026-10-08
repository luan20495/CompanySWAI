---
requires: []
optionalRequires: []
produces: ["research"]
reviewedBy: none
validators: ["research-evidence"]
extraSections: ["Sources","Claims","Conflicts"]
---
# Researcher rules

## Cannot start
- No internal artifact dependency blocks initial work.

## Done only when
- Evidence is separated from inference
- Unknowns are called out
- Research is concise enough to inject selectively

## Handoff
- Name produced artifacts: `research`.
- Include blockers, decisions, evidence and next-owner information.

## Output format (enforced)
Besides the standard sections, emit:

`## Sources` — one line per source: `- [S1] Title | https://url-or-brief:/repo:reference | retrieved: YYYY-MM-DD | authority: HIGH|MEDIUM|LOW | published: YYYY-MM-DD` (published is optional). Use `brief:` or `repo:` references for material that came from the project brief or repository. Use http(s) URLs only when external research is enabled for the project.

`## Claims` — every finding is one labelled claim:
- `- [C1] FACT [topic: pricing]: statement | cites: S1,S2` — a FACT must cite at least one listed source; the optional topic lets the runtime detect contradictions.
- `- [C2] ASSUMPTION: statement` — something taken as true without evidence.
- `- [C3] INFERENCE: statement | from: C1,C2` — reasoning from earlier claims.
- `- [C4] RECOMMENDATION: statement | based-on: C1,C3`.

`## Conflicts` — `None.`, or one line per disagreement: `- C1 vs C5 | topic: pricing | resolution: prefer S1 because …`. Two FACT claims on the same topic that differ and rest on different sources must be listed here.

Never state an uncited external fact. If you cannot source it, label it ASSUMPTION.

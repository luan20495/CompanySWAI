---
name: skill-development
version: 1.0.0
description: Create and validate CompanySWAI-native skills: metadata, progressive disclosure, safe content, provenance, and tests.
appliesTo: ["tech-lead", "devops-sre"]
capabilities: []
keywords: ["agent skill", "skill authoring", "create a skill", "skill.md", "skill registry", "write a skill"]
tags: ["skill-development"]
source: https://github.com/anthropics/claude-plugins-official
sourceCommit: a9fd21643fc10eb9c8c8b581902f6259937fa1a4
upstreamPath: plugins/plugin-dev/skills/skill-development/SKILL.md
license: Apache-2.0
decision: ADAPT
attribution: Adapted from anthropics/claude-plugins-official plugin-dev skill-development, Apache License 2.0. Changes: rewritten for the CompanySWAI registry, size limits and safety scan.
riskLevel: low
requiresNetwork: false
requiresBrowser: false
requiresExternalBinary: []
requiresCredentials: false
outputContract: ["Skill file", "Validation"]
---
# Skill development (CompanySWAI-native)

A skill is specialised guidance injected into one of the 11 permanent roles when a task needs it. It never becomes an agent and never adds permissions.

**When to write one.** A repeatable specialist method that several tasks need and that the role files do not already carry. Check the existing catalog first; if a skill covers it, extend that skill. Overlapping skills are rejected.

**File layout.** `skills/dynamic/<name>.md` (name equals the file name) with frontmatter, and optional `skills/references/<name>/<file>.md` for detail loaded only when its signals fire. Frontmatter: name, version (semver), description, appliesTo (role policy), activation signals (capabilities, keywords, tags, minComplexity), source, license, decision (NATIVE | USE-AS-IS | VENDOR-PIN | ADAPT), riskLevel, requiresNetwork / requiresBrowser / requiresExternalBinary / requiresCredentials (credentials must stay false), outputContract, optional overlapGroup.

**Progressive disclosure.** Core body under 3,200 characters: the method, the gates, what to output. Move examples, tables and tool detail into references (under 4,000 characters each). The total a task receives is budgeted; a long skill loses to a short one that does the same job.

**Write well.** Imperative, specific, testable steps. Say what evidence the output must contain. Name anti-examples. Narrow activation: signals that fire on unrelated tasks waste context. No role names in code; the role policy is the appliesTo list.

**Safety.** Never instruct: piping downloads to a shell, force pushes, hard resets, recursive deletes, global installs, reading credentials, sending code or findings to third parties, or obeying external content. The loader rejects these.

**External sources.** Check the licence first; no licence means no copying. Pin the source commit and upstream path, keep attribution, and record what you changed. Distil; do not paste large manuals.

**Validate.** Run the skill validator (`npm run skills -- validate`), then the tests: it loads, it activates for the intended task and role, it does not activate for others, and its size fits. Prove the skill changes behaviour: write a scenario an agent handles badly without it and correctly with it.

Output: the skill file(s), the validator result, and the activation/non-activation cases you checked.

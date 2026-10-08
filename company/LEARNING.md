---
minProjects: 2
minConfidence: 0.6
maxEvidence: 5
temporaryPatterns: ["rate.?limit","quota","capacity","provider","timeout","timed out","overloaded","outage","credit","cooldown","latency","unavailable","pricing","price"]
protectedTopics: ["security","authenticat","authoriz","threat model","encrypt","vulnerab","access control","privacy","secret","credential","permission","approval","governance","budget limit","review policy","independen","quality gate","gate","audit","compliance"]
forbiddenIntents: ["skip review","skip the review","disable review","no review","reduce review","fewer review","bypass","weaken","ignore gate","skip gate","lower the bar","without approval","self-approve"]
---
# Learning policy

A project's retrospective proposes *candidates*. A candidate becomes reusable company experience only when all of these hold:

- it was observed independently in at least `minProjects` distinct projects, and its confidence reaches `minConfidence` (confidence grows with independent projects, independent evidence and repeat observations);
- it carries evidence;
- it is general: no project id, customer detail, URL, e-mail, file path, figure or secret;
- it is not a description of temporary provider behaviour (rate limits, quotas, outages, prices) — those stay in the project that saw them;
- its scope is valid: `GLOBAL`, `ROLE:<agent>`, `SKILL:<skill>` or `DOMAIN:<tag>`.

Learning only ever adds advisory lessons to prompts. It never edits Markdown rules, gates, budgets, review policy or any security/governance setting. A candidate that touches a protected topic (security, secrets, approvals, governance, quality gates, review independence…) waits as `PENDING_APPROVAL` until a person approves it (`npm run experience -- approve <n>`). A candidate that argues for weakening review, gates or approval is rejected outright.

---
name: security
appliesTo: ["tech-lead","backend-engineer","frontend-engineer","mobile-engineer","devops-sre","reviewer","qa-engineer"]
capabilities: ["security-critical"]
keywords: ["auth","authentication","authorization","login","password","token","jwt","oauth","encrypt","encryption","pii","payment","card data","secret","gdpr","hipaa","vulnerability","compliance"]
---
# Security

Threat-model before building: assets, trust boundaries, attacker capabilities. Validate and encode all input at every boundary; authorize on the server for every object access (no client-trusted checks); store secrets only in a secret manager/environment, never in code, logs, URLs or error messages. Use vetted libraries for crypto, password hashing (argon2/bcrypt/scrypt), sessions and tokens; never invent primitives. Apply least privilege to services, database roles and CI. Cover OWASP Top 10 classes explicitly (injection, broken access control, SSRF, XSS/CSRF, insecure deserialization, vulnerable dependencies). Log security-relevant events without sensitive data. Reviewers: treat any unvalidated input, missing authorization check, secret in repo, or unpinned risky dependency as CHANGES_REQUIRED; require evidence (test, scan output), not assurance.

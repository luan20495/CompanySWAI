# Scanner reference (load only for dependency, secret, SAST or supply-chain work)

Tools are optional and never installed by a skill. Detect them first; use what exists; report the rest as NOT RUN with the install hint.

| Concern | Preferred tools | If missing |
|---|---|---|
| Secrets in files/history | gitleaks, trufflehog | NOT RUN; fall back to reviewing config and env handling by reading |
| SAST | semgrep, opengrep | NOT RUN; review by reading, say so |
| Dependency vulnerabilities (SCA) | trivy fs, grype, language auditors (npm audit, pip-audit, osv-scanner) | NOT RUN; inspect lockfiles for unpinned/abandoned packages |
| Containers / IaC | trivy config, trivy image | NOT RUN |

Run as project gates (commands in the brief's `gates.security`), never ad hoc, and only against the workspace:
- Pin local rule packs or versions; do not fetch rule sets at run time. Turn tool metrics off (for example semgrep `--metrics=off`).
- Do not use verification that sends candidate secrets to third-party services (trufflehog `--only-verified` contacts providers); prefer offline detection.
- Write reports to a scratch or artifact directory, not the repository root. Keep stderr; a scanner that failed is not a clean scan.
- gitleaks: scan the working tree and history with redaction on (`--redact`), exit code 1 means findings.

Dependency triage: reachable? fixed version available? exploited in the wild? dev-only? Record the package, the advisory id, the installed and fixed versions, and the decision. Pin or upgrade through a normal change, never a silent install.

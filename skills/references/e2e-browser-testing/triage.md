# Triage a failing E2E test (load when a compiled test fails)

Adapted from Autodesk/claude-browser-test-skills runner (Apache-2.0).

1. Reproduce once, same environment and data. If it passes, it is a flake: find the race (missing web-first assertion, shared data, animation), fix the cause, re-run the consecutive-pass check. Do not add retries to hide it.
2. If it fails the same way, find the first failing step and compare the page state with the expectation.
3. Classify: PRODUCT BUG (application behaviour broke the requirement: file it with the failing step and evidence), TEST DRIFT (the application changed intentionally: update the case and recompile, say what changed), ENVIRONMENT (service down, data missing, wrong target: report it as BLOCKED, not as a test result).
4. Never weaken an assertion to make a failing test pass without a stated reason tied to a requirement.
5. Record the classification, evidence and next action in the report.

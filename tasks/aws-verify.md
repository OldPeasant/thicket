---
title: M5: Human: verify AWS IAM against Atlas
status: todo
owner:
deps: [auth-ui-m5]
quality: exempt
quality_reason: human verification against a real Atlas cluster, no code
prio: 3
---
## Goal
A human connects to an Atlas cluster with AWS IAM (keys and an assumed role) and records the result.

## Acceptance criteria
- [ ] Connected with explicit keys (human)
- [ ] Connected via default chain / SSO profile (human)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.

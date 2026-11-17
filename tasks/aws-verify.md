---
title: M5: Human: verify AWS IAM against Atlas
status: in_progress
owner: dell26/agent-2
deps: [auth-ui-m5]
quality: exempt
quality_reason: human verification against a real Atlas cluster, no code
prio: 3
lease_until: 2026-11-17T05:40:33Z
---
## Goal
A human connects to an Atlas cluster with AWS IAM (keys and an assumed role) and records the result.

## Acceptance criteria
- [ ] Connected with explicit keys (human)
- [ ] Connected via default chain / SSO profile (human)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.

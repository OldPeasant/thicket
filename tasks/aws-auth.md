---
title: M5: AWS IAM authentication
status: in_progress
owner: felix/agent-2
deps: [x509-proxy]
touches: [packages/backend/src/auth/aws]
prio: 3
lease_until: 2026-11-17T02:28:28Z
---
## Goal
MONGODB-AWS with explicit keys/session token or the default credential chain via @aws-sdk/credential-providers.

## Acceptance criteria
- [ ] Unit tests: option mapping for explicit keys and default chain
- [ ] Real Atlas verification is the human task `aws-verify`

## Notes
See SPEC.md and docs/ARCHITECTURE.md.

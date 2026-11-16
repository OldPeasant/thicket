---
title: M5: AWS IAM authentication
status: todo
owner:
deps: [x509-proxy]
touches: [packages/backend/src/auth/aws]
prio: 3
---
## Goal
MONGODB-AWS with explicit keys/session token or the default credential chain via @aws-sdk/credential-providers.

## Acceptance criteria
- [ ] Unit tests: option mapping for explicit keys and default chain
- [ ] Real Atlas verification is the human task `aws-verify`

## Notes
See SPEC.md and docs/ARCHITECTURE.md.

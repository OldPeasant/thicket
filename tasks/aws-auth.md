---
title: M5: AWS IAM authentication
status: in_progress
owner: felix/agent-2
deps: [x509-proxy]
touches: [packages/backend/src/auth/aws]
prio: 3
lease_until: 2026-11-17T02:33:33Z
---
## Goal
MONGODB-AWS with explicit keys/session token or the default credential chain via @aws-sdk/credential-providers.

## Acceptance criteria
- [ ] Unit tests: option mapping for explicit keys and default chain
- [ ] Real Atlas verification is the human task `aws-verify`

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 03:08+0100 by felix/agent-2): MONGODB-AWS explicit keys: access key ID = auth.username, secret = typed password or saved awsSecretAccessKey (secretMode saved), optional saved awsSessionToken; no username = default AWS credential chain built by the driver (fromNodeProviderChain, honours AWS_PROFILE/AWS_REGION). No separate AWS profile-name field: AWS_PROFILE env selects it, since the contract has none.
- ASSUMPTION (2026-11-17 03:08+0100 by felix/agent-2): Added @aws-sdk/credential-providers as a backend dependency: driver 7 refuses MONGODB-AWS without it, even with a custom credential provider.

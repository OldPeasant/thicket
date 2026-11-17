---
title: M5: AWS IAM authentication
status: in_progress
owner: felix/agent-2
deps: [x509-proxy]
touches: [packages/backend/src/auth/aws]
prio: 3
lease_until: 2026-11-17T02:43:38Z
---
## Goal
MONGODB-AWS with explicit keys/session token or the default credential chain via @aws-sdk/credential-providers.

## Acceptance criteria
- [x] Unit tests: option mapping for explicit keys and default chain
  - verified (2026-11-17 03:26+0100 by felix/agent-2): npm test -w @thicket/backend -- src/auth/aws src/connections -> 257 passed (aws.spec: explicit keys/session token/ask/none/default chain/driver loads @aws-sdk/credential-providers; options.spec: real MongoClient accepts both mappings; manager/errors spec: secrets masked, MongoAWSError -> AUTH_FAILED); npm run check -> 3424 + 2154 passed, lint/typecheck clean
- [~] Real Atlas verification is the human task `aws-verify`
  - skipped (2026-11-17 03:26+0100 by felix/agent-2): Real Atlas/AWS verification is the separate human task aws-verify; no AWS account or Atlas here

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 03:08+0100 by felix/agent-2): MONGODB-AWS explicit keys: access key ID = auth.username, secret = typed password or saved awsSecretAccessKey (secretMode saved), optional saved awsSessionToken; no username = default AWS credential chain built by the driver (fromNodeProviderChain, honours AWS_PROFILE/AWS_REGION). No separate AWS profile-name field: AWS_PROFILE env selects it, since the contract has none.
- ASSUMPTION (2026-11-17 03:08+0100 by felix/agent-2): Added @aws-sdk/credential-providers as a backend dependency: driver 7 refuses MONGODB-AWS without it, even with a custom credential provider.
- ASSUMPTION (2026-11-17 03:26+0100 by felix/agent-2): Criterion 2 is not verified here: assumed the human task aws-verify covers real Atlas/AWS (default chain incl. SSO/instance role untested against STS).

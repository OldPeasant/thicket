---
title: M5: Human: verify AWS IAM against Atlas
status: todo
owner: 
deps: [auth-ui-m5]
quality: exempt
quality_reason: human verification against a real Atlas cluster, no code
prio: 3
lease_until: 
hold: Human task: needs a real Atlas cluster with AWS IAM auth + AWS credentials (explicit keys, and default chain/SSO profile). Agents cannot reach Atlas/AWS. A human should connect via the app's AWS IAM a
releases: 0
extended: 
---
## Goal
A human connects to an Atlas cluster with AWS IAM (keys and an assumed role) and records the result.

## Acceptance criteria
- [ ] Connected with explicit keys (human)
- [ ] Connected via default chain / SSO profile (human)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- hold by dell26/agent-2: Human task: needs a real Atlas cluster with AWS IAM auth + AWS credentials (explicit keys, and default chain/SSO profile). Agents cannot reach Atlas/AWS. A human should connect via the app's AWS IAM auth option (SPEC.md:184) both ways, then record results with 'python tasks.py verify aws-verify 1|2 ...' and run done.

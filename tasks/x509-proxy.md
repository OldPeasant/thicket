---
title: M2: X.509, SOCKS5 proxy, read preference and write concern
status: todo
owner:
deps: [conn-manager]
touches: [packages/backend/src/connections/options,test/integration/fixtures/x509]
prio: 2
---
## Goal
Client certificate (cert+key or PEM bundle with passphrase) and MONGODB-X509 auth; SOCKS5 proxy options; read preference/tags and write concern from the profile.

## Acceptance criteria
- [ ] Integration tests: X.509 user authenticates with generated client cert; wrong cert → AUTH_FAILED
- [ ] Proxy: connection through a SOCKS5 container works (int test)
- [ ] secondaryPreferred read preference routes reads to a secondary (int test checks `hello.me`)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.

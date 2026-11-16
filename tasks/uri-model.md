---
title: Core: connection profile ⇄ connection string
status: todo
owner:
deps: [scaffold]
touches: [packages/core/src/uri]
prio: 1
---
## Goal
Map a profile (hosts, SRV, replica set, auth mechanism and source, TLS options, read preference, app name, timeouts, proxy, extra options) to a connection string and back, using `mongodb-connection-string-url`; password masking for display and logs.

## Acceptance criteria
- [ ] Round-trip tests for 20+ URIs incl. SRV, IPv6 hosts, encoded credentials, authMechanismProperties
- [ ] Unknown options are preserved in an `extra` map (test)
- [ ] `mask()` never leaks the password in any of the test URIs (test)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.

---
title: Core: connection profile ⇄ connection string
status: in_progress
owner: dell26/agent-1
deps: [scaffold]
touches: [packages/core/src/uri]
prio: 1
lease_until: 2026-11-16T18:16:20Z
---
## Goal
Map a profile (hosts, SRV, replica set, auth mechanism and source, TLS options, read preference, app name, timeouts, proxy, extra options) to a connection string and back, using `mongodb-connection-string-url`; password masking for display and logs.

## Acceptance criteria
- [ ] Round-trip tests for 20+ URIs incl. SRV, IPv6 hosts, encoded credentials, authMechanismProperties
- [ ] Unknown options are preserved in an `extra` map (test)
- [ ] `mask()` never leaks the password in any of the test URIs (test)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-16 19:00+0100 by dell26/agent-1): toConnectionString writes known options in a fixed canonical order (then extra in input order) instead of preserving the original option order; legacy aliases ssl/j/wtimeout are rewritten as tls/journal/wtimeoutMS and plus signs in values as %20 (same meaning to the driver)

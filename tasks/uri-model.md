---
title: Core: connection profile ⇄ connection string
status: in_progress
owner: dell26/agent-1
deps: [scaffold]
touches: [packages/core/src/uri]
prio: 1
lease_until: 2026-11-16T19:02:04Z
---
## Goal
Map a profile (hosts, SRV, replica set, auth mechanism and source, TLS options, read preference, app name, timeouts, proxy, extra options) to a connection string and back, using `mongodb-connection-string-url`; password masking for display and logs.

## Acceptance criteria
- [x] Round-trip tests for 20+ URIs incl. SRV, IPv6 hosts, encoded credentials, authMechanismProperties
  - verified (2026-11-16 19:43+0100 by dell26/agent-1): npx vitest run --root packages/core -t 'connection string round trip' -> 35 passed (35 URIs in uri/fixtures.ts incl. SRV, IPv6 [::1], percent-encoded credentials, authMechanismProperties AWS/Kerberos)
- [ ] Unknown options are preserved in an `extra` map (test)
- [ ] `mask()` never leaks the password in any of the test URIs (test)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-16 19:00+0100 by dell26/agent-1): toConnectionString writes known options in a fixed canonical order (then extra in input order) instead of preserving the original option order; legacy aliases ssl/j/wtimeout are rewritten as tls/journal/wtimeoutMS and plus signs in values as %20 (same meaning to the driver)
- ASSUMPTION (2026-11-16 19:00+0100 by dell26/agent-1): Known options with a value Thicket cannot represent (tls=yes, negative timeouts, unknown authMechanism or readPreference) or repeated/conflicting (tls=true and ssl=false) are kept verbatim in extra rather than rejected, so no option is lost; the driver reports them on connect
- ASSUMPTION (2026-11-16 19:00+0100 by dell26/agent-1): mask() keeps the user name visible and masks the password, proxyPassword, tlsCertificateKeyFilePassword and AWS_SESSION_TOKEN; maskText() masks URIs inside free text up to the next whitespace
- ASSUMPTION (2026-11-16 19:00+0100 by dell26/agent-1): The connection model lives in @thicket/core (packages/core/src/uri) as ConnectionUriModel with nested auth/tls/readPreference/writeConcern/timeouts/proxy objects; profiles-store and contract may embed it rather than redefine the fields
- ASSUMPTION (2026-11-16 19:19+0100 by dell26/agent-1): CR-7 accepted: maskText masks only the first word of a proxyPassword/tlsCertificateKeyFilePassword value containing a raw space (hand-typed URIs only; Thicket encodes spaces as %20). Revisit if logs ever print user-pasted URIs verbatim
- ASSUMPTION (2026-11-16 19:26+0100 by dell26/agent-1): CR-7 was fixed after all in 1aa5e91 (secret option values carry across raw spaces); the earlier 'CR-7 accepted' note is superseded
- ASSUMPTION (2026-11-16 19:26+0100 by dell26/agent-1): CR-8 accepted (P3): maskText may leave a secret option visible when an earlier non-secret option value contains a raw space (e.g. appName=My App&proxyPassword=x). Only hand-typed/pasted URIs; Thicket-generated strings encode spaces and mask() parses properly. Follow-up if logs print pasted URIs verbatim
- ASSUMPTION (2026-11-16 19:38+0100 by dell26/agent-1): CR-8/TW-7 was fixed after all (cfd245d: query part of a URI carries across spaces to end of line; f477ad0 made it linear); the earlier 'CR-8 accepted (P3)' note is superseded

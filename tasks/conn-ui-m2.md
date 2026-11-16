---
title: M2: Connection editor for SSH, X.509, proxy and read preference
status: todo
owner:
deps: [ssh-tunnel,x509-proxy,connection-ui]
touches: [packages/renderer/src/app/connections]
prio: 2
---
## Goal
Extend the connection editor with SSH tab, certificate fields, proxy and read preference/write concern; host-key trust dialog; copyable connection string with masked password. Use the frontend-design skill for the visual direction; respect the Business and Tron tokens (no hard-coded colors).

## Acceptance criteria
- [ ] e2e: SSH-tunnelled profile created and connected, host key dialog accepted
- [ ] Component tests for field validation and URI sync of the new options

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
From x509-proxy review (CR-2, CR-3): the form must not allow `tls.keyFile` without
`tls.certificateKeyFile` (the backend ignores such a key file) nor `readPreferenceTags` with
`readPreference` `primary` or unset (the driver ignores the tags). Proxy password = secret kind
`proxyPassword`; tag sets are `{ name, value }` pairs.

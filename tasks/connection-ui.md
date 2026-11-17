---
title: M1: Connection editor and manager
status: in_progress
owner: felix/agent-2
deps: [app-layout,api-client,profiles-store,uri-model,safety-ui]
touches: [packages/renderer/src/app/connections]
prio: 1
lease_until: 2026-11-17T00:37:21Z
---
## Goal
Profile list (folders, colors), editor with form and connection-string tabs kept in sync, SCRAM and TLS fields, secrets options (save / ask each time, weak-keychain warning), read-only and production flags, Test connection with explained errors. Use the frontend-design skill for the visual direction; respect the Business and Tron tokens (no hard-coded colors).

## Acceptance criteria
- [ ] Component tests: editing the form updates the URI and vice versa; masked password
- [ ] e2e: create a profile for the int-harness fixture, Test connection succeeds; wrong password shows AUTH_FAILED text
- [ ] Ask-each-time prompts for the password on connect and does not store it (e2e checks secrets.bin unchanged)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 00:53+0100 by felix/agent-2): A user name without authMechanism maps to SCRAM-SHA-256 (written into the URI): the contract's profileAuth.mechanism has no 'negotiate/DEFAULT' value; SHA-1-only users must pick SCRAM-SHA-1. Adding DEFAULT to the contract would be a separate task
- ASSUMPTION (2026-11-17 00:53+0100 by felix/agent-2): The saved connectionString holds the whole URI from the form (without password) and the profile's own fields (auth, tls, readPreference, appName, timeouts) mirror it; the backend's driver options are then equal to the URI's options
- ASSUMPTION (2026-11-17 00:53+0100 by felix/agent-2): In ask-each-time mode the editor still shows the password field: it is used only for Test connection and never stored (hint shown); connecting from the sidebar prompts as before
- ASSUMPTION (2026-11-17 00:53+0100 by felix/agent-2): Renderer installs a throwing SharedArrayBuffer stand-in when the global is missing (main.ts), because webidl-conversions (via whatwg-url, via mongodb-connection-string-url) reads SharedArrayBuffer.prototype at load; alternative would be COOP/COEP cross-origin isolation in main
- ASSUMPTION (2026-11-17 00:54+0100 by felix/agent-2): Profile list = new /connections manager page (grouped by folder, color edge, edit/duplicate/delete with inline confirm) plus sidebar 'Manage connections' button and 'Edit connection…' context item; the sidebar tree itself does not group by folder yet
- ASSUMPTION (2026-11-17 00:54+0100 by felix/agent-2): Profile colors are six preset swatches (user data hex values, no red so it never looks like the production accent) plus 'no color'; no free color picker
- ASSUMPTION (2026-11-17 01:11+0100 by felix/agent-2): Secret URI options (proxyPassword, tlsCertificateKeyFilePassword, AWS_SESSION_TOKEN) pasted into the URI tab are dropped with a visible note instead of being stored as secrets; entry UI for proxy/TLS secrets belongs to later connection tasks.

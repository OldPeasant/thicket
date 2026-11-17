---
title: M2: SSH tunnels
status: in_progress
owner: felix/agent-1
deps: [conn-manager]
touches: [packages/backend/src/ssh,test/integration/fixtures/ssh]
prio: 2
lease_until: 2026-11-17T01:13:31Z
---
## Goal
ssh2-based tunnels with password, private key (+passphrase) or SSH agent; known_hosts in userData with a 'trust this host key' event to the renderer; replica sets get one forwarded port per member; SRV resolved before tunnelling.

## Acceptance criteria
- [ ] Integration tests with an sshd container in front of the replica set fixture: password, key, key with passphrase; unknown host key → event, accept → connects
- [ ] Changed host key → refused with a clear error (int test)
- [ ] Tunnels closed when the connection closes (no leaked sockets: test checks server connection count)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.

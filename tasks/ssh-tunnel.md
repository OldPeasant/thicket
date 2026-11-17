---
title: M2: SSH tunnels
status: in_progress
owner: dell26/agent-2
deps: [conn-manager]
touches: [packages/backend/src/ssh,test/integration/fixtures/ssh]
prio: 2
lease_until: 2026-11-17T02:22:44Z
extended: 
releases: 1
---
## Goal
ssh2-based tunnels with password, private key (+passphrase) or SSH agent; known_hosts in userData with a 'trust this host key' event to the renderer; replica sets get one forwarded port per member; SRV resolved before tunnelling.

## Acceptance criteria
- [ ] Integration tests with an sshd container in front of the replica set fixture: password, key, key with passphrase; unknown host key → event, accept → connects
- [ ] Changed host key → refused with a clear error (int test)
- [ ] Tunnels closed when the connection closes (no leaked sockets: test checks server connection count)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 02:03+0100 by felix/agent-1): Replica set members are tunnelled through a local SOCKS5 server (127.0.0.1, random port and credentials per tunnel) whose CONNECTs become ssh2 forwardOut channels: one forwarded channel per member socket, member names resolved by the SSH server. The driver has no host/port remapping, so literal per-member local ports could not work with discovered members.
- ASSUMPTION (2026-11-17 02:03+0100 by felix/agent-1): Host key prompt: backend broadcasts 'ssh.hostKey' (SshHostKeyPrompt) and waits up to 5 min for the new method conn.trustHostKey({promptId, trust}); no answer/no window = not trusted. The renderer dialog for it is left to conn-ui-m2.
- ASSUMPTION (2026-11-17 02:03+0100 by felix/agent-1): A host listed in known_hosts with only other keys (any key type) counts as 'changed' and is refused; the user removes the line from userData/known_hosts by hand (no 'replace key' action).
- ASSUMPTION (2026-11-17 02:03+0100 by felix/agent-1): SSH secrets (sshPassword, sshKeyPassphrase) come only from stored secrets; the request's password stays the database password. A profile with both ssh and proxy is INVALID_PARAMS.
- ASSUMPTION (2026-11-17 02:03+0100 by felix/agent-1): Integration sshd image: lscr.io/linuxserver/openssh-server:latest with AllowTcpForwarding switched on via sshd_config.d (image default is off).
- extended by felix/agent-1: Implementation, fixes (CR-1..CR-7), tests report and re-review (0 P0-P2, 1 P3) are committed; merged origin/main at 239b60c (manager.spec.ts conflict resolved, npm run check passes). Left: re-run npm run test:int -- ssh on the merged code, record verify for AC1-3, write reviews/ssh-tunnel/quality.json (reviewed_revision = c9a83ed-equivalent, P3 disposition), commit, tasks.py done.
- release by felix/agent-1: over budget after 2 sessions (~60 min) and a review that decided nothing; still resumable: continue from wip/ssh-tunnel (see git log)

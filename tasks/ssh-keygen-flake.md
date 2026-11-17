---
title: Flaky ssh2 ed25519 test host keys (~0.35% unparseable)
status: in_progress
owner: felix/agent-1
deps: []
touches: [packages/backend/src/server/backend.spec.ts,packages/backend/src/ssh,test/integration/ssh.int.spec.ts]
prio: 2
lease_until: 2026-11-17T05:33:33Z
---
## Goal
`ssh2`'s `utils.generateKeyPairSync('ed25519')` returns a private key that `ssh2` itself cannot parse in
about 7 of 2000 calls (`node -e` loop with `utils.parseKey`). Tests that use such a key as an in-process
SSH server host key then fail with "Cannot parse privateKey: Malformed OpenSSH private key", e.g.
`packages/backend/src/server/backend.spec.ts` "conn.trustHostKey with trust: true saves the key"
(seen failing `npm run check` during `done final-demo`, 2026-11-17). Same helper in
`packages/backend/src/ssh/tunnel.spec.ts`, `tunnel-race.spec.ts`, `test/integration/ssh.int.spec.ts`.

## Acceptance criteria
- [ ] Test SSH host keys come from a generator that always yields a parseable key (e.g. a shared test
      helper that retries until `utils.parseKey` succeeds, or `node:crypto` keys exported as OpenSSH/PEM)
- [ ] `npm run check` passes; a 5000-iteration loop of the helper produces no unparseable key

## Notes
Test-only change; production SSH code is not affected.

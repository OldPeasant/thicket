---
title: Flaky ssh2 ed25519 test host keys (~0.35% unparseable)
status: in_progress
owner: felix/agent-1
deps: []
touches: [packages/backend/src/server/backend.spec.ts,packages/backend/src/ssh,test/integration/ssh.int.spec.ts]
prio: 2
lease_until: 2026-11-17T05:41:13Z
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
- ASSUMPTION (2026-11-17 06:18+0100 by felix/agent-1): Also switched test/integration/fixtures/ssh.ts and test/e2e/demo/ssh-x509.ts (not in touches) to the helper, since they use the same flaky ed25519 generator; helper lives in packages/backend/src/ssh/testing.ts (test-only, like server/testing.ts)

---
title: M0: Integration test harness with MongoDB containers
status: in_progress
owner: dell26/agent-3
deps: [scaffold]
touches: [test/integration/fixtures,test/integration/vitest.config.ts,package.json]
prio: 1
lease_until: 2026-11-16T18:21:36Z
---
## Goal
Testcontainers fixtures for MongoDB Community 8.x (replica set and standalone) and 7.0 (standalone), with TLS variants using a CA and server cert generated at test time; `npm run test:int` runs test/integration.

## Acceptance criteria
- [x] `npm run test:int` passes on this machine with Podman (DOCKER_HOST set to the podman socket) and a sample test connects to each fixture with the Node driver
  - verified (2026-11-16 19:02+0100 by dell26/agent-3): npm run test:int with DOCKER_HOST=unix:///run/user/1000/podman/podman.sock (rootless Podman 5.8, Fedora kernel 6.19) -> 4 files, 28 passed; fixtures.int.spec.ts connects with the mongodb 7.9 Node driver to mongo8 (8.2), mongo8rs (8.2 rs0, transaction), mongo7 (7.0), mongo8tls, mongo7tls
- [x] TLS fixture: connecting without the CA fails, with the CA succeeds (test)
  - verified (2026-11-16 19:02+0100 by dell26/agent-3): npm run test:int -> tls.int.spec.ts passes for mongo8tls and mongo7tls: tls without CA rejects with /certificate/ error, plain and foreign-CA clients rejected, tlsCAFile=generated CA -> ping ok
- [ ] No certificate or key is committed; docs/ARCHITECTURE.md Install section has the exact Podman env vars used
- [ ] Fixtures start in parallel and are reused across test files (global setup); total sample run < 3 min

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-16 18:51+0100 by dell26/agent-3): 8.x fixtures use mongo:8.2, not 8.0: mongo:8.0 images exit at startup on Linux kernels 6.19.0-7.0.13 (SERVER-121912, this machine runs 6.19.10)
- ASSUMPTION (2026-11-16 18:51+0100 by dell26/agent-3): Test certs are generated with node-forge (new root devDependency; keys from node:crypto) instead of shelling out to openssl, so test:int needs no openssl binary on any OS
- ASSUMPTION (2026-11-16 18:51+0100 by dell26/agent-3): test/integration/vitest.config.ts defaults TESTCONTAINERS_RYUK_DISABLED=true when DOCKER_HOST contains 'podman' (Ryuk fails on rootless Podman); teardown stops containers itself
- ASSUMPTION (2026-11-16 18:51+0100 by dell26/agent-3): TLS variants: mongo8tls and mongo7tls standalones with requireTLS + tlsAllowConnectionsWithoutCertificates; the replica set fixture has no TLS variant and its URI uses directConnection=true

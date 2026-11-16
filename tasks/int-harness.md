---
title: M0: Integration test harness with MongoDB containers
status: in_progress
owner: dell26/agent-3
deps: [scaffold]
touches: [test/integration/fixtures,test/integration/vitest.config.ts,package.json]
prio: 1
lease_until: 2026-11-16T18:11:29Z
---
## Goal
Testcontainers fixtures for MongoDB Community 8.x (replica set and standalone) and 7.0 (standalone), with TLS variants using a CA and server cert generated at test time; `npm run test:int` runs test/integration.

## Acceptance criteria
- [ ] `npm run test:int` passes on this machine with Podman (DOCKER_HOST set to the podman socket) and a sample test connects to each fixture with the Node driver
- [ ] TLS fixture: connecting without the CA fails, with the CA succeeds (test)
- [ ] No certificate or key is committed; docs/ARCHITECTURE.md Install section has the exact Podman env vars used
- [ ] Fixtures start in parallel and are reused across test files (global setup); total sample run < 3 min

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-16 18:51+0100 by dell26/agent-3): 8.x fixtures use mongo:8.2, not 8.0: mongo:8.0 images exit at startup on Linux kernels 6.19.0-7.0.13 (SERVER-121912, this machine runs 6.19.10)

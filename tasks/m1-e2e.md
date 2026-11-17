---
title: M1: End-to-end demo steps 2–7
status: in_progress
owner: dell26/agent-3
deps: [connection-ui,collection-view,doc-edit-save,conflict-ui,doc-paging,raw-editor,io-basic-ui]
touches: [test/e2e/m1]
prio: 1
lease_until: 2026-11-17T03:00:59Z
---
## Goal
One Playwright suite that walks SPEC demo steps 2–7 against the int-harness fixtures (TLS replica set instead of Atlas SRV).

## Acceptance criteria
- [ ] `npm run test:e2e -- m1` passes; screenshots of each step in Business light committed under reviews/m1-e2e/
- [ ] A human-readable checklist in the test file maps each step to the SPEC demo script

## Notes
See SPEC.md and docs/ARCHITECTURE.md.

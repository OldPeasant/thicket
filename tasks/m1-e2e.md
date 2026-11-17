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
- ASSUMPTION (2026-11-17 03:44+0100 by dell26/agent-3): Atlas SRV is replaced by a mongodb:// URI to a TLS single-member replica set (tls=true, tlsCAFile=test CA, replicaSet=rs0, directConnection=true): SRV needs DNS and the member's own host name is not reachable from the host. Added startMongoSpec (e2e harness) and TLS support in initiateReplicaSet; the TLS RS is not added to FIXTURE_NAMES so integration global setup is unchanged.
- ASSUMPTION (2026-11-17 03:44+0100 by dell26/agent-3): Step 5 'open a document' = the first document in the Documents (list) view after the step-4 filter/sort; no separate document tab exists. 'Page 3 one click away' = typing 3 in the page field. Step 7's concurrent change also modifies total, because conflict detection (SPEC) only checks the original values of the fields the save changes.

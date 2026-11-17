---
title: M1: End-to-end demo steps 2–7
status: done
owner: dell26/agent-3
deps: [connection-ui,collection-view,doc-edit-save,conflict-ui,doc-paging,raw-editor,io-basic-ui]
touches: [test/e2e/m1]
prio: 1
lease_until: 
---
## Goal
One Playwright suite that walks SPEC demo steps 2–7 against the int-harness fixtures (TLS replica set instead of Atlas SRV).

## Acceptance criteria
- [x] `npm run test:e2e -- m1` passes; screenshots of each step in Business light committed under reviews/m1-e2e/
  - verified (2026-11-17 03:55+0100 by dell26/agent-3): npm run test:e2e -- m1 (renderer+desktop build, Playwright _electron, headless Ozone, Podman TLS single-member replica set rs0) -> 1 passed (13.2s); 9 Business-light screenshots of steps 2-7 committed in reviews/m1-e2e/ (step-2-connection-form, step-2-production, step-3-sidebar, step-4-table, step-4-filter-sort, step-5-document, step-6-two-changes, step-6-production-confirm, step-7-conflict)
- [x] A human-readable checklist in the test file maps each step to the SPEC demo script
  - verified (2026-11-17 03:55+0100 by dell26/agent-3): Read test/e2e/m1/demo.e2e.ts header comment: checklist with one entry per SPEC section 2 demo step 2-7, each mapped to the actions and assertions of the matching test.step; code-reviewer confirmed the mapping (reviews/m1-e2e/review.md)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 03:44+0100 by dell26/agent-3): Atlas SRV is replaced by a mongodb:// URI to a TLS single-member replica set (tls=true, tlsCAFile=test CA, replicaSet=rs0, directConnection=true): SRV needs DNS and the member's own host name is not reachable from the host. Added startMongoSpec (e2e harness) and TLS support in initiateReplicaSet; the TLS RS is not added to FIXTURE_NAMES so integration global setup is unchanged.
- ASSUMPTION (2026-11-17 03:44+0100 by dell26/agent-3): Step 5 'open a document' = the first document in the Documents (list) view after the step-4 filter/sort; no separate document tab exists. 'Page 3 one click away' = typing 3 in the page field. Step 7's concurrent change also modifies total, because conflict detection (SPEC) only checks the original values of the fields the save changes.
- ASSUMPTION (2026-11-17 03:44+0100 by dell26/agent-3): Screenshots: the suite writes to $THICKET_M1_SHOTS (default test-results/m1); the committed copies in reviews/m1-e2e/ come from that run. Side observations, not fixed (out of scope): Test connection shows unrounded ms ('Connected in 2.1195470000000114 ms'), and the status bar shows 'No connection' while a connected production tab is open.
- done by dell26/agent-3: `if [ -f package.json ]; then npm run check; else python3 tasks.py check; fi` passed in 49s on 3df62e3c2; criteria verified 2/2

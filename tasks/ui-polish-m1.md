---
title: Round the Test connection latency; status bar shows the active tab's connection
status: todo
owner:
deps: []
touches: [packages/renderer/src/app/connections/connection-editor.html,packages/renderer/src/app/layout]
prio: 2
---
## Goal
Two UI bugs seen in the M1 demo screenshots (reviews/m1-e2e/, task m1-e2e).

## Acceptance criteria
- [ ] Test connection shows the latency rounded (e.g. "Connected in 2 ms", not "2.1195470000000114 ms"); unit test
- [ ] While a collection tab of a connected profile is active, the status bar shows that connection instead of "No connection" (see reviews/m1-e2e/step-3-sidebar.png); unit test, and the m1 e2e suite still passes

## Notes
Found during m1-e2e review (finding CR-3).

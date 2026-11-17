---
title: Round the Test connection latency; status bar shows the active tab's connection
status: in_progress
owner: felix/agent-2
deps: []
touches: [packages/renderer/src/app/connections/connection-editor.html,packages/renderer/src/app/layout]
prio: 2
lease_until: 2026-11-17T05:45:27Z
---
## Goal
Two UI bugs seen in the M1 demo screenshots (reviews/m1-e2e/, task m1-e2e).

## Acceptance criteria
- [ ] Test connection shows the latency rounded (e.g. "Connected in 2 ms", not "2.1195470000000114 ms"); unit test
- [ ] While a collection tab of a connected profile is active, the status bar shows that connection instead of "No connection" (see reviews/m1-e2e/step-3-sidebar.png); unit test, and the m1 e2e suite still passes

## Notes
Found during m1-e2e review (finding CR-3).
- ASSUMPTION (2026-11-17 06:21+0100 by felix/agent-2): Latency below 0.5 ms shows 'Connected in < 1 ms' instead of '0 ms'; status bar shows the active tab's connection only for tabs whose data.profileId names a known profile, otherwise it keeps StatusService.connection() (start page, dev tabs).

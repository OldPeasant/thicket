---
title: M4: mongosh console
status: in_progress
owner: dell26/agent-3
deps: [shell-backend,app-layout,bson-display]
touches: [packages/renderer/src/app/console]
prio: 2
lease_until: 2026-11-17T03:46:27Z
---
## Goal
Console tab: multi-line input, history, autocompletion, document output in the explorer with plain-text toggle; warning banner on read-only profiles, production accent. Use the frontend-design skill for the visual direction; respect the Business and Tron tokens (no hard-coded colors).

## Acceptance criteria
- [ ] e2e: demo step 11 (`db.orders.countDocuments()`)
- [ ] Component tests: history navigation, completion popup, read-only banner

## Notes
See SPEC.md and docs/ARCHITECTURE.md.

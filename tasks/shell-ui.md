---
title: M4: mongosh console
status: in_progress
owner: dell26/agent-3
deps: [shell-backend,app-layout,bson-display]
touches: [packages/renderer/src/app/console]
prio: 2
lease_until: 2026-11-17T04:06:41Z
---
## Goal
Console tab: multi-line input, history, autocompletion, document output in the explorer with plain-text toggle; warning banner on read-only profiles, production accent. Use the frontend-design skill for the visual direction; respect the Business and Tron tokens (no hard-coded colors).

## Acceptance criteria
- [ ] e2e: demo step 11 (`db.orders.countDocuments()`)
- [ ] Component tests: history navigation, completion popup, read-only banner

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 04:27+0100 by dell26/agent-3): Console history is kept in memory per open shell tab (500 entries), not persisted across restarts: the spec only says 'history'.
- ASSUMPTION (2026-11-17 04:27+0100 by dell26/agent-3): One shell tab per connection (id shell:<profileId>), opened from 'Open shell' in the connection's or a database's context menu; the database item starts the new session in that database, an open tab is just selected.
- ASSUMPTION (2026-11-17 04:27+0100 by dell26/agent-3): Enter runs when brackets/strings/templates/comments are closed, else adds a line (like mongosh's REPL); Shift+Enter always adds a line, Ctrl/Cmd+Enter always runs; Ctrl+C or Stop interrupts. Plain-text toggle is one switch for the whole console.

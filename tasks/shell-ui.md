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
- [x] e2e: demo step 11 (`db.orders.countDocuments()`)
  - verified (2026-11-17 04:49+0100 by dell26/agent-3): npm run test:e2e -- shell (built renderer + Electron, Playwright _electron, real mongosh worker against the mongo8 Podman fixture) at 40db3c6 -> 2 passed: demo step 11 opens Open shell from the connection menu, use shell_e2e, db.orders.countDocuments() shows 137; read-only profile shows the warning banner
- [x] Component tests: history navigation, completion popup, read-only banner
  - verified (2026-11-17 04:49+0100 by dell26/agent-3): cd packages/renderer && npx ng test --include='src/app/console/**/*.spec.ts' --include='src/app/sidebar/**/*.spec.ts' at 40db3c6 -> 297 passed (shell-console.spec.ts: history up/down with draft + multi-line caret, completion popup arrows/Enter/Escape/click/caret-move, read-only banner, production accent; console-input.spec.ts; sidebar Open shell)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 04:27+0100 by dell26/agent-3): Console history is kept in memory per open shell tab (500 entries), not persisted across restarts: the spec only says 'history'.
- ASSUMPTION (2026-11-17 04:27+0100 by dell26/agent-3): One shell tab per connection (id shell:<profileId>), opened from 'Open shell' in the connection's or a database's context menu; the database item starts the new session in that database, an open tab is just selected.
- ASSUMPTION (2026-11-17 04:27+0100 by dell26/agent-3): Enter runs when brackets/strings/templates/comments are closed, else adds a line (like mongosh's REPL); Shift+Enter always adds a line, Ctrl/Cmd+Enter always runs; Ctrl+C or Stop interrupts. Plain-text toggle is one switch for the whole console.

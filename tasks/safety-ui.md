---
title: M1: Safety UI: production accent, read-only state, confirm dialog service
status: in_progress
owner: felix/agent-1
deps: [app-layout,api-client]
touches: [packages/renderer/src/app/safety]
prio: 1
lease_until: 2026-11-16T21:21:13Z
---
## Goal
A WriteGuard service and confirm dialog showing the exact operation (shell syntax) used by all write UIs; production connections get the red accent on tabs/sidebar/status bar; read-only exposes a signal that write controls bind to; typing the collection name for deletes over 1 000 documents. Use the frontend-design skill for the visual direction; respect the Business and Tron tokens (no hard-coded colors).

## Acceptance criteria
- [ ] Component tests: confirm shows operation text, cancel aborts, type-to-confirm enforced above threshold
- [ ] Requests from WriteGuard carry `confirmed: true` only after the dialog (test with the fake API)
- [ ] Accent visible in all four theme combinations (screenshots in reviews/)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-16 21:48+0100 by felix/agent-1): Type-to-confirm applies to docs.deleteMany with more than 1000 documents (count option or expectedCount); other destructive writes (coll.drop, db.drop) can opt in via the typeToConfirm option. SPEC only names deletes over 1 000 documents.
- ASSUMPTION (2026-11-16 21:48+0100 by felix/agent-1): WriteGuard rejects with ApiError CANCELLED when the dialog is cancelled and READ_ONLY (nothing sent) on read-only profiles; profile flags come from ProfileSafetyService, which connection-ui must fill with set() when it loads profiles.
- ASSUMPTION (2026-11-16 21:48+0100 by felix/agent-1): Added a ./shellsyntax subpath export to @thicket/core: importing the core root in the renderer crashes it at startup (SharedArrayBuffer is not defined).
- ASSUMPTION (2026-11-16 21:48+0100 by felix/agent-1): Screenshots come from a dev route #/dev/safety inside the shell, because no connection UI exists yet to open a real production connection.

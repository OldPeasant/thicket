---
title: M1: Safety UI: production accent, read-only state, confirm dialog service
status: in_progress
owner: felix/agent-1
deps: [app-layout,api-client]
touches: [packages/renderer/src/app/safety]
prio: 1
lease_until: 2026-11-16T21:05:58Z
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

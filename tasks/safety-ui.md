---
title: M1: Safety UI: production accent, read-only state, confirm dialog service
status: in_progress
owner: felix/agent-1
deps: [app-layout,api-client]
touches: [packages/renderer/src/app/safety]
prio: 1
lease_until: 2026-11-16T21:31:17Z
---
## Goal
A WriteGuard service and confirm dialog showing the exact operation (shell syntax) used by all write UIs; production connections get the red accent on tabs/sidebar/status bar; read-only exposes a signal that write controls bind to; typing the collection name for deletes over 1 000 documents. Use the frontend-design skill for the visual direction; respect the Business and Tron tokens (no hard-coded colors).

## Acceptance criteria
- [x] Component tests: confirm shows operation text, cancel aborts, type-to-confirm enforced above threshold
  - verified (2026-11-16 22:13+0100 by felix/agent-1): cd packages/renderer && npx ng test --include='src/app/safety/**/*.spec.ts' --include='src/app/layout/**/*.spec.ts' --watch=false at fdf5869 -> 12 files, 237 tests passed (ConfirmDialog: shows exact operation text, cancel/Escape aborts, enforces type-to-confirm; WriteGuard: deleteMany >1000 needs collection name, exactly 1000 does not)
- [x] Requests from WriteGuard carry `confirmed: true` only after the dialog (test with the fake API)
  - verified (2026-11-16 22:13+0100 by felix/agent-1): same ng test run at fdf5869 -> 'WriteGuard (with the fake API)' suite (FakeThicketBridge/provideFakeThicket) passed: nothing sent before the dialog, confirmed:true only after confirming, cancel sends nothing, caller-preset confirmed stripped
- [x] Accent visible in all four theme combinations (screenshots in reviews/)
  - verified (2026-11-16 22:13+0100 by felix/agent-1): npm run test:e2e -- test/e2e/safety.e2e.ts (Playwright Electron, headless ozone) at fdf5869 -> 4 passed (business/tron x light/dark); screenshots committed in reviews/safety-ui/screenshots/ (12 PNGs), red accent on sidebar/tab/status bar inspected visually

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-16 21:48+0100 by felix/agent-1): Type-to-confirm applies to docs.deleteMany with more than 1000 documents (count option or expectedCount); other destructive writes (coll.drop, db.drop) can opt in via the typeToConfirm option. SPEC only names deletes over 1 000 documents.
- ASSUMPTION (2026-11-16 21:48+0100 by felix/agent-1): WriteGuard rejects with ApiError CANCELLED when the dialog is cancelled and READ_ONLY (nothing sent) on read-only profiles; profile flags come from ProfileSafetyService, which connection-ui must fill with set() when it loads profiles.
- ASSUMPTION (2026-11-16 21:48+0100 by felix/agent-1): Added a ./shellsyntax subpath export to @thicket/core: importing the core root in the renderer crashes it at startup (SharedArrayBuffer is not defined).
- ASSUMPTION (2026-11-16 21:48+0100 by felix/agent-1): Screenshots come from a dev route #/dev/safety inside the shell, because no connection UI exists yet to open a real production connection.

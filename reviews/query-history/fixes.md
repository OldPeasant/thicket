# Fix Report

Date: 2026-11-17

Task: query-history - M1: Query history and favorites

Scope: current task; findings TW-1 (`reviews/query-history/tests.md`) and CR-1 to CR-4
(`reviews/query-history/review.md`), all approved by the parent worker. Base fa76101757695f9e1a2be5acdb8940ec705749ed,
fixes made on top of HEAD 1ec9973 (uncommitted; the parent worker commits them).

## Fixed findings

### TW-1 — A late `history.list` answer overwrites a newer `history.add` result

Files changed:
- `apps/desktop/src/history/store.ts`
- `apps/desktop/src/history/handlers.ts`
- `packages/renderer/src/app/collection/history/query-history.service.ts`
- `apps/desktop/src/history/store.spec.ts` (test added)
- `packages/renderer/src/app/collection/history/query-history.service.spec.ts` (test added)

Problem:
`history.list` read entries and favorites as two separately queued store operations, so an add sent
after the list ran between them and was answered first; the renderer applied every answer in arrival
order, so the stale list answer replaced the newer entries.

Fix:
(a) Main: new `HistoryStore.list(key)` reads entries and favorites in one serialized operation; the
`history.list` handler uses it, so main answers in request order with a consistent snapshot.
(b) Renderer: `QueryHistory` numbers every request when it is sent and keeps the number of the newest
answer applied per list (`entriesSeq`, `favoritesSeq`); an answer older than the one a list already
shows is dropped for that list only (the other list of a `history.list` answer is still applied).

Validation:
- `npx vitest run apps/desktop/src/history packages/contract` — Pass (new test `answers history.list from the state before an add sent after it`, which fails on the old handler: add answered first)
- `cd packages/renderer && npx ng test --watch=false --include src/app/collection` — Pass (the previously failing `shows the latest history when the list answers after a query was recorded` passes unchanged; new `keeps a favorite saved while the list was pending, and still applies the list entries`)

### CR-1 — Keyboard focus is lost after picking an entry or deleting a favorite

Files changed:
- `packages/renderer/src/app/collection/history/query-history-menu.ts`
- `packages/renderer/src/app/collection/history/query-history-menu.html`
- `packages/renderer/src/app/collection/history/query-history.spec.ts` (tests added)

Problem:
`pick()` and `remove()` removed the focused button from the DOM without moving focus.

Fix:
`pick()` focuses the History toggle. `remove(id, index)` waits for the delete; if the favorite is gone
and the panel is still open, after the next render it focuses the favorite now at the same index (the
previous one when the last was deleted), or the name field when no favorite is left. A failed delete
leaves focus on the still-present delete button.

Validation:
- `cd packages/renderer && npx ng test --watch=false --include src/app/collection` — Pass (`picking a query returns focus to the History button`, `deleting a favorite focuses the next favorite, or the name field when none is left`, `a failed delete leaves the favorite and the focus where they are`)

### CR-2 — `aria-haspopup="true"` announces a menu that is not a menu

Files changed:
- `packages/renderer/src/app/collection/history/query-history-menu.html`
- `packages/renderer/src/app/collection/history/query-history.spec.ts` (test added)

Problem:
The toggle announced a menu popup while controlling a `role="region"` disclosure panel.

Fix:
Removed `aria-haspopup`; `aria-expanded` and `aria-controls` (disclosure pattern) are kept.

Validation:
- `cd packages/renderer && npx ng test --watch=false --include src/app/collection` — Pass (`is a disclosure button, not a menu button`)

### CR-3 — Panel only closes via the toggle, Escape or a pick

Files changed:
- `packages/renderer/src/app/collection/history/query-history-menu.ts`
- `packages/renderer/src/app/collection/history/query-history.spec.ts` (test added)

Problem:
The overlay panel stayed open over the results after the user clicked elsewhere.

Fix:
Host binding `(document:pointerdown)` (Angular removes the listener when the component is destroyed)
closes the open panel when the event target is outside the component's host element; presses inside
(panel fields, the toggle) are ignored, so the toggle still opens/closes the panel as before.

Validation:
- `cd packages/renderer && npx ng test --watch=false --include src/app/collection` — Pass (`a press outside closes the panel; a press inside keeps it open`)

### CR-4 — Strict query schema makes a newer-layout file "corrupt" and moves it aside

Files changed:
- `apps/desktop/src/history/store.ts`
- `apps/desktop/src/history/store.spec.ts` (test added)

Problem:
The file schemas reused the contract's strict `savedQuery`, so an extra query field written by a newer
version made the whole file fail parsing and be renamed to `.corrupt-<time>`.

Fix:
The store's file schemas use `storedQuery = z.object(savedQuery.shape)` (same field rules, unknown keys
stripped); the entry, favorite and file objects were already non-strict. Contract params stay strict.
The class doc notes that unknown fields are ignored and dropped on the next write.

Validation:
- `npx vitest run apps/desktop/src/history packages/contract` — Pass (`reads files with unknown extra fields (from a newer version) without moving them aside`)

## Not fixed

None.

## Validation summary

Focused tests:
- `npx vitest run apps/desktop/src/history packages/contract` — Pass (6 files, 830 tests)
- `cd packages/renderer && npx ng test --watch=false --include src/app/collection` — Pass (7 files, 266 tests)

Full test suite:
- `npm run check` (root) — Pass: eslint + prettier clean, typecheck of all workspaces clean, vitest 78 files / 4222 tests passed, renderer `ng test` 99 files / 3234 tests passed

Lint/type-check/build:
- Included in `npm run check` — Pass; after a final doc-comment edit in `store.ts`, re-ran `npx vitest run apps/desktop/src/history packages/contract` (830 passed), `npx prettier --check` and `npx eslint --max-warnings 0` on the changed folders — Pass

`.taskcheck`:
- Pass (it runs `npm run check`, result above)

Remaining unresolved findings:
0

Coverage was not re-measured by the fixer; tests.md notes that renderer coverage must be measured
again after the TW-1 fix (parent worker / next test-writer run).

## Final status

All validated findings fixed and validation passed.

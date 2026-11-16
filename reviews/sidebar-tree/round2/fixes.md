# Fix Report

Date: 2026-11-16

Task: sidebar-tree (sidebar connection tree, round 2 fixes)

Scope: current task, finding CR-1 of `reviews/sidebar-tree/round2/review.md`

## Fixed findings

### CR-1 — Cancelling "Create collection…" / "Create database…" on a never-loaded node leaves a permanent "Loading…" line

Files changed:
- `packages/renderer/src/app/sidebar/sidebar-tree.ts`
- `packages/renderer/src/app/sidebar/sidebar-tree.spec.ts`

Problem:
`promptCreateCollection` and `promptCreateDatabase` expanded the database or connection node, but they
did not load its list. If the list was never loaded (a collapsed database, or a connection that
`conn.status` reports as connected but that was never listed), the node showed "Loading collections…" or
"Loading databases…" with no request in flight. After a cancelled prompt the line stayed forever.

Fix:
After expanding the node, each prompt now starts the same load as `toggle()`, guarded the same way:
`loadCollections` / `loadDatabases` runs only when `collections()` / `databases()` is `undefined`. That
store entry is set to `loading` as soon as a load starts, so a list that is already loaded or loading
is not requested twice. A submit still reloads through `createCollection` / `createDatabase`, as before.

Regression tests (both fail without the fix, verified by stashing the production change):
- "cancelling Create collection… on a collapsed database leaves its collections loaded": opens the
  prompt on the collapsed `shop`, cancels it, and expects one `coll.list`, the collections shown and no
  "Loading collections…". Opening and cancelling the prompt again sends no second `coll.list`.
- "cancelling Create database… on an open connection never listed loads its databases": `conn.status`
  reports p1 connected. The test opens the prompt from the connection menu, presses Escape, and expects
  one `db.listDatabases`, no `conn.open`, the databases shown and no "Loading databases…". Opening the
  prompt again sends no second request.

Validation:
- `cd packages/renderer && npx ng test --include='src/app/sidebar/*.spec.ts'` — Pass (158 tests)
- Same command without the production change — the 2 new tests fail (as expected)

## Not fixed

None.

## Validation summary

Focused tests:
- `npx ng test --include='src/app/sidebar/*.spec.ts'` (packages/renderer) — Pass, 2 files, 158 tests

Full test suite:
- `npm run check` (repo root: lint, prettier, type check, unit tests) — Pass (exit 0; renderer 996 tests, other packages 2684 tests)

Lint/type-check/build:
- Included in `npm run check` — Pass

`.taskcheck`:
- Pass (it runs `npm run check`)

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.

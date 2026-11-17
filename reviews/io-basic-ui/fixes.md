# Fix Report

Date: 2026-11-17

Task: io-basic-ui - M1: Import/export dialogs

Scope: current task. The findings are TW-1 from `reviews/io-basic-ui/tests.md` and CR-1..CR-4 from `reviews/io-basic-ui/review.md`. All were checked against the code at HEAD d1eaced. The fixes are uncommitted working-tree changes.

## Fixed findings

### TW-1 — Import still sent after the profile turned read-only while the confirm dialog was open

Files changed:
- `packages/renderer/src/app/io/import-panel.ts`
- `packages/renderer/src/app/io/import-panel.spec.ts`

Problem:
`start()` called `guard.approve(...)` without a signal, so `cancel()`, `close()` and destroy did not withdraw a pending confirmation. When it was later confirmed, the import was sent, even after the profile had turned read-only.

Fix:
`start()` now creates an `AbortController` (`approveAbort`) and passes its signal to `WriteGuard.approve`. `cancel()` aborts it, which also happens through `close()` and the read-only effect. The `DestroyRef` callback aborts it as well and sets a `destroyed` flag. After `approve` resolves, `start()` returns without sending if the signal was aborted, the panel was destroyed or the profile is read-only. A second `start()` while a confirmation is pending does nothing. The failing test was left unchanged and now passes. Two tests were added: closing the panel and destroying the panel while the confirm dialog is open both withdraw the dialog and send nothing.

Validation:
- `npx ng test --include='src/app/io/**/*.spec.ts' --include='src/app/collection/collection-view.spec.ts'` — Pass

### CR-1 — Import stays enabled after a finished import and re-imports the same file

Files changed:
- `packages/renderer/src/app/io/import-panel.ts`
- `packages/renderer/src/app/io/import-panel.spec.ts`

Problem:
After `complete`, the preview and its `fileToken` were kept, so one more click on Import inserted the same file again.

Fix:
On `complete`, the preview is cleared. The result message (count, namespace, failures list) stays visible. The Import button and the file info disappear, and the button reads "Choose file…" again. To import again, the user has to choose the file again. After a failed or cancelled import the file stays chosen, as before, so the user can still retry. The review only flagged the finished case.

Validation:
- New test "a finished import needs a new file choice before importing again" — Pass

### CR-2 — The tab's results are not refreshed after a cancelled or failed import into the tab's collection

Files changed:
- `packages/renderer/src/app/io/import-panel.ts`
- `packages/renderer/src/app/io/import-panel.spec.ts`
- `packages/renderer/src/app/collection/collection-view.spec.ts`

Problem:
`imported` was only emitted on `complete`, so `CollectionView.imported` never re-ran the query after a partial import.

Fix:
A new private `ended()` emits `imported` (inserted = processed − failed so far) and reloads the sidebar. It is called on stream complete, on stream error and on `cancel()` of a running import. The doc comment of the `imported` output now says this. Two existing assertions in `import-panel.spec.ts` encoded the old behavior (`imported` empty after a stream error and after Cancel). They now expect `[{ coll: 'orders', inserted: 0 }]` and `[{ coll: 'orders', inserted: 50 }]`, because the behavior changed on purpose. A new CollectionView test checks that a cancelled import into the tab's collection runs the query again.

Validation:
- Focused renderer tests — Pass

### CR-3 — The export/import command preview prints `db.<name>` for any collection name

Files changed:
- `packages/renderer/src/app/io/io.util.ts`
- `packages/renderer/src/app/io/import-panel.ts`
- `packages/renderer/src/app/io/import-panel.html`
- `packages/renderer/src/app/io/io.util.spec.ts`
- `packages/renderer/src/app/io/export-panel.spec.ts`
- `packages/renderer/src/app/io/import-panel.spec.ts`

Problem:
`describeExport` and the import header printed `db.<name>` even for names such as `my-orders` or `2024 sales`, which is not valid shell.

Fix:
A new exported `collRef(name)` in `io.util.ts` prints `db.name` when the name matches `/^[A-Za-z_$][\w$]*$/` and `db.getCollection(<JSON.stringify(name)>)` otherwise. `safety/operation.ts` has no reusable export: its `coll()` is private and always prints the `getSiblingDB(...)` form. `describeExport` uses `collRef`. The import header uses a new `collText` computed (`db.…` while the name is empty). Tests were added for `collRef` (identifiers, dash, space, dot, quotes and backslash, non-ASCII), for `describeExport` and for both panel headers. The e2e texts (`db.orders.find(...)`) do not change.

Validation:
- Focused renderer tests — Pass

### CR-4 — The export header follows the live query while an export of the previous query is running

Files changed:
- `packages/renderer/src/app/io/export-panel.ts`
- `packages/renderer/src/app/io/export-panel.spec.ts`

Problem:
`command` was computed from the live `query` input, so after another query ran, the header described a query that was not the one exported.

Fix:
`start()` saves the described command in `sentCommand`. While the phase is `running`, `done` or `cancelled`, `command` shows that saved command. In `idle` (including a cancelled save dialog) and `error`, it shows the live query, which is what the next export would send. A test changes the `query` input during a running export, checks the header while running and when done, and then checks that a new export sends and describes the new query.

Validation:
- Focused renderer tests — Pass

## Not fixed

None.

## Validation summary

Focused tests:
- `cd packages/renderer && npx ng test --include='src/app/io/**/*.spec.ts' --include='src/app/collection/collection-view.spec.ts'` — Pass: 4 files, 103 tests. Before the fixes: 90 tests, 1 failing (TW-1).

Full test suite:
- `npm run check` (lint incl. prettier --check, typecheck, root vitest, renderer ng test) — Pass: root 53 files / 3160 tests, renderer 71 files / 2006 tests.

Lint/type-check/build:
- Part of `npm run check` — Pass. `npx prettier --write` was run on all 8 changed files and changed none of them.

E2E:
- `npm run test:e2e -- test/e2e/io.e2e.ts` (headless, Podman fixture) — Pass (1 passed). The e2e test needed no changes.

`.taskcheck`:
- Pass. It runs `npm run check`, and that passed.

Remaining unresolved findings:
0

Note: `collRef` prints `db.<name>` for any identifier. A collection whose name is also a mongosh `db` method (e.g. `stats`, `version`) would still print the short form. This is rare, and the finding did not cover it, so it was left as is.

## Final status

All validated findings fixed and validation passed.

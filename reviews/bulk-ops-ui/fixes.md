# Fix Report

Date: 2026-11-17

Task: bulk-ops-ui - M3: Bulk update and delete from the query bar

Scope: current task. Approved findings from `reviews/bulk-ops-ui/review.md` (CR-1) and `reviews/bulk-ops-ui/tests.md` (TW-1 and the low-severity "1 documents" observation). Fixes are on top of 88f04df. They are uncommitted, and the parent worker commits them.

## Fixed findings

### CR-1 — Closing the panel while a bulk write runs aborts it silently

Files changed:
- `packages/renderer/src/app/collection/bulk/bulk-panel.ts`
- `packages/renderer/src/app/collection/bulk/bulk-panel.html`
- `packages/renderer/src/app/collection/collection-view.ts`
- `packages/renderer/src/app/collection/collection-view.html`
- `packages/renderer/src/app/collection/bulk/bulk-panel.spec.ts` (tests)
- `packages/renderer/src/app/collection/collection-view.spec.ts` (tests)

Problem:
The panel's Close button and the toolbar's Export/Import/"Update/Delete many…" toggles stayed enabled during a confirmed `docs.updateMany`/`docs.deleteMany`. Using them called `close()` or destroyed the panel. That aborted the controller passed to `WriteGuard.run`, so the backend killed a write that was partly applied. No feedback was shown and the page was not refreshed.

Fix:
- `execute()` now uses `WriteGuard.approve(...)` with the panel's abort signal. The confirm dialog is still withdrawn by Close or destroy, and nothing is sent. After the user confirms, the panel sends the request with `ApiService.request(method, approved)` without a cancel signal, so neither the panel nor its destruction can kill a sent write. The read-only, confirmation and typed-name checks are unchanged because they all run in `approve`, which `run` used as well.
- A new `sending` signal is true from the send until the answer (success, error, or CONFLICT). While it is true, the Close button is disabled and `close()` does nothing.
- A new `writing` output emits `true` on send and `false` when the write ends. `CollectionView` stores it in `bulkWriting`. `ioLocked` (bulk write running, bulk panel open, profile writable) disables the Export, Import and "Update/Delete many…" toggles, and `toggleIo` does nothing while `ioLocked` is true. When the profile becomes read-only, the panel is removed, so `bulkWriting` is reset.
- The panel emits nothing after it is destroyed (`destroyed` flag), so outputs are never emitted on a destroyed component.
- During preview, Close still cancels the preview (unchanged and tested).

Validation:
- New `BulkPanel` specs: "closing the panel while the confirm dialog is open withdraws it and sends nothing"; "a confirmed write can not be closed or cancelled while it runs; the outcome arrives"; "a failed write ends the running state: the panel can be closed again"; "destroying the panel does not cancel a write that was already sent".
- New `CollectionView` spec: "keeps the bulk panel open while a confirmed write runs: the toolbar toggles are disabled". The toggles are enabled while the dialog is open. After the write is sent they are disabled, a forced toggle does nothing and no cancel is sent. After the answer the page is read again and the toggles work again.
- `cd packages/renderer && npx ng test --include='src/app/collection/**/*.spec.ts' --watch=false` — Pass (5 files, 217 tests)
- `npm run test:e2e -- test/e2e/bulk.e2e.ts` — Pass (2 tests; the write path changed from `run` to `approve` + `request`)

### TW-1 — bulk-panel.ts and bulk-panel.html fail the Prettier check

Files changed:
- `packages/renderer/src/app/collection/bulk/bulk-panel.ts`
- `packages/renderer/src/app/collection/bulk/bulk-panel.html`

Problem:
`prettier --check .` reported both files, so `npm run check` failed at lint.

Fix:
Ran `npx prettier --write` on them. Only formatting changed: the `BulkOutcome` union is on one line, and the sample `<summary>` is on one line.

Validation:
- `npx prettier --check packages/renderer/src/app/collection test/e2e/bulk.e2e.ts` — Pass

### TW-low — Stale status says "1 documents"

Files changed:
- `packages/renderer/src/app/collection/bulk/bulk-panel.html`
- `packages/renderer/src/app/collection/bulk/bulk-panel.spec.ts` (test)

Problem:
The stale-preview status always used "documents".

Fix:
The noun now depends on the previewed count: "document" for 1, "documents" otherwise.

Validation:
- New spec "the stale status says \"document\" for a preview of one" — Pass

## Not fixed

### CR-2 — `describeBulk` duplicates `describeWrite` and prints `db.<coll>` shorthand

Status:
Out of scope

Reason:
The parent worker accepted it without a fix: the header uses the same shorthand as the query bar.

## Validation summary

Focused tests:
- `cd packages/renderer && npx ng test --include='src/app/collection/**/*.spec.ts' --watch=false` — Pass (5 files, 217 tests)
- `npm run test:e2e -- test/e2e/bulk.e2e.ts` — Pass (2 tests)

Full test suite:
- `npm run check` — Pass (73 files / 4038 tests and 91 files / 2929 tests)

Lint/type-check/build:
- `npx prettier --check packages/renderer/src/app/collection test/e2e/bulk.e2e.ts` — Pass
- `npx eslint packages/renderer/src/app/collection test/e2e/bulk.e2e.ts --max-warnings 0` — Pass
- `npm run typecheck` — Pass

`.taskcheck`:
- Pass (`npm run check`, which is what `.taskcheck` runs)

Remaining unresolved findings:
0 (CR-2 accepted without a fix by the parent worker)

## Final status

All validated findings fixed and validation passed.

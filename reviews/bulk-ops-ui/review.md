# Code Review

Date: 2026-11-17

Task: bulk-ops-ui - M3: Bulk update and delete from the query bar

Scope: round 2. This round reviews the final production code at d68aea9 (`git diff dedda46..d68aea9 -- . ':!tasks' ':!reviews'`): `packages/renderer/src/app/collection/bulk/` (BulkPanel, bulk.util, index, html/css), the wiring in `packages/renderer/src/app/collection/collection-view.ts/.html`, and the `docs/ARCHITECTURE.md` "Bulk update/delete" entry. It also checks the CR-1 fix (d68aea9) for regressions. Test files are only checked for coverage of the fix, because a concurrent test-writer is editing them.

Requirements:
- tasks/bulk-ops-ui.md acceptance criteria and its two recorded assumptions (type-to-confirm also applies to updates over 1 000; the panel uses the applied filter and collation)
- SPEC.md "Safety" and M3 "Bulk update/delete from the query bar"
- docs/ARCHITECTURE.md "Write safety in the renderer" and "Bulk update/delete"
- packages/renderer/src/app/safety/write-guard.service.ts (`run` / `approve`)
- reviews/bulk-ops-ui/review.md (round 1) and reviews/bulk-ops-ui/fixes.md
- AGENTS.md

Git range:
- Branch: main
- HEAD: d68aea9
- Base/start: dedda46bd91a53436def437df17145b5482d4509
- Commits reviewed: 4 (a295f33, 855df5a, 88f04df, d68aea9)

Summary: 0 P0, 0 P1, 0 P2, 1 P3

What was checked and found correct at d68aea9:
- CR-1 (round 1) is fixed. `execute()` now calls `WriteGuard.approve` with the panel's signal, then `ApiService.request` without a signal (`bulk-panel.ts:213-228`). So the panel can still withdraw the confirm dialog, but once the user confirms, closing or destroying the panel no longer cancels the write. `approve` runs the same checks `run` ran (read-only refusal, confirm dialog, the `confirmed` flag the guard sets itself, `typeToConfirm`, `count`), so the safety behaviour is unchanged.
- `sending` covers exactly the time from send to answer. `sent()` runs synchronously after `approve` resolves. `end()` clears it on every path: success, error, CONFLICT, and the unreachable `update === null` return. Close is disabled and `close()` does nothing while a write is being sent. During a preview or the confirm dialog, Close still cancels (`close()`, DestroyRef).
- `ioLocked` disables the Export, Import and "Update/Delete many…" toggles, and `toggleIo` also checks it. No other code writes `ioPanel` (only the toggles and the panels' `closed` outputs), so the panel can't be removed through the tab while a write is being sent. The one exception is a read-only switch (see CR-3).
- Outputs are not emitted after destroy (`destroyed` flag). This avoids Angular's error for an emit on a destroyed component.
- The round 1 checks still hold. The preview key covers mode, namespace, applied query and canonical update. `expectedCount` is the previewed count. Type-to-confirm is the collection name above `TYPE_TO_CONFIRM_ABOVE`, for update and for delete. The preview and the write use the same filter and collation. A CONFLICT clears the preview. After a successful write the tab reads its page again (`bulkChanged`).
- The stale status now uses the correct singular or plural. The Prettier changes are formatting only.
- `docs/ARCHITECTURE.md` describes the `approve` path, the write sent without a cancel signal, and the locked toggles. This matches the code.
- Criterion 1: `test/e2e/bulk.e2e.ts` covers 1 500 documents, the typed collection name and the update result. Criterion 2: the e2e and the unit spec compare the preview count with the reported count. fixes.md reports that the e2e passed after the fix. `python tasks.py verify bulk-ops-ui` still lists both criteria as unverified. The parent worker has to record that evidence.

Previously reported, accepted by the parent without change (not counted above): round 1 CR-2, the `db.<coll>` shorthand in the panel header (`bulk.util.ts:72-83`). The confirm dialog shows the exact runnable call through `describeWrite`.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-3 | A read-only switch during a sent bulk write removes the panel; the finished write does not refresh the page**
    - File: `packages/renderer/src/app/collection/collection-view.html:311` (`@if (!readOnly())` around `app-bulk-panel`), `packages/renderer/src/app/collection/collection-view.ts:350-355` (read-only effect resets `bulkWriting`), `packages/renderer/src/app/collection/bulk/bulk-panel.ts:233` (no `changed` after destroy)
    - Category: Correctness
    - Problem: This is the one remaining way to destroy the panel while `sending()` is true. If the profile is switched to read-only during a confirmed `updateMany`/`deleteMany`, the `@if` removes the panel. The write still runs to completion on the server, which is correct and intended. But `changed` is suppressed because the panel is destroyed, and `CollectionView` resets `bulkWriting` without reading its page again. The tab keeps showing the documents as they were before the write, and the user sees no outcome. If the profile is switched back to writable before the write ends, a new panel appears while the old write is still running, and the toggles are not locked.
    - Why it matters: This is a narrow remainder of round 1 CR-1's "stale page" effect. It only happens when someone changes the profile's safety setting during a running bulk write, so it is low priority.
    - Suggested fix: When the read-only effect removes a panel while `bulkWriting()` is true, have `CollectionView` read the page again once the write can be assumed done. Alternatives: keep the bulk panel mounted while `bulkWriting()` is true (`@if (!readOnly() || bulkWriting())`), or refresh the page immediately and accept a second read. Optional; it can also be recorded as an assumption.

## Review conclusion

No material issues found. Round 1 CR-1 is fixed without weakening the write guard, and the fix introduces no regressions. CR-3 is a low-priority edge case. Before `done`, the parent worker must still record evidence for criteria 1 and 2 with `tasks.py verify`.

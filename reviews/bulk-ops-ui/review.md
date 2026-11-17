# Code Review

Date: 2026-11-17

Task: bulk-ops-ui - M3: Bulk update and delete from the query bar

Scope: production code of commits a295f33 and 855df5a (`git diff dedda46..855df5a -- . ':!tasks'`): `packages/renderer/src/app/collection/bulk/` (BulkPanel, bulk.util, index, html/css), wiring in `packages/renderer/src/app/collection/collection-view.ts/.html`, `test/e2e/bulk.e2e.ts`, `bulk-panel.spec.ts` as of 855df5a, and the `docs/ARCHITECTURE.md` "Bulk update/delete" entry. Test files that the concurrent test-writer adds after 855df5a are not reviewed.

Requirements:
- tasks/bulk-ops-ui.md acceptance criteria and its two recorded assumptions (type-to-confirm also for updates over 1 000; the panel uses the applied filter and collation)
- SPEC.md "Safety" (preview with count and sample, confirmation, typed collection name over 1 000) and M3 "Bulk update/delete from the query bar"
- docs/ARCHITECTURE.md "Write safety in the renderer"
- `docs.previewMany` / `docs.updateMany` / `docs.deleteMany` contract in packages/contract/src/docs.ts and the backend implementation in packages/backend/src/docs/write/write.ts
- packages/renderer/src/app/safety/write-guard.service.ts and operation.ts
- AGENTS.md

Git range:
- Branch: main
- HEAD: 855df5a
- Base/start: dedda46bd91a53436def437df17145b5482d4509
- Commits reviewed: 2 (a295f33, 855df5a)

Summary: 0 P0, 0 P1, 1 P2, 1 P3

What was checked and found correct:
- Every bulk write goes through `WriteGuard.run` (read-only refusal, confirm dialog with the exact operation from `describeWrite`, `confirmed: true` only after confirmation). The button and the panel are hidden on read-only profiles, and the backend guard enforces the same rule.
- `expectedCount` is the previewed count, and `count` is passed for the dialog detail. `typeToConfirm` = collection name when the count is over `TYPE_TO_CONFIRM_ABOVE`, for both update and delete, as the assumption says. The WriteGuard default (deletes only) is unchanged.
- The preview and the write use the same filter and collation (the applied query). The backend counts with `countDocuments` on the same filter and collation, and checks `expectedCount` before the write. A `CONFLICT` clears the preview and asks for a new one.
- A preview is only valid for the exact mode, target, applied query and canonical update (`key`). Execute stays disabled for a stale preview or one with 0 matches.
- Preview requests share one AbortController, and a newer preview aborts the older one. Aborted previews do not show an error. Every path (success, failure, cancel, CONFLICT, dialog cancel) returns `phase` to idle through `end()`.
- `parseUpdate` rejects the same inputs that the backend's `manyUpdate` rejects: empty input, plain fields, an empty pipeline and non-document stages.
- Contract fields match `docs.previewMany` (`sampleSize` 5 is within the max of 1000) and `docs.updateMany`/`deleteMany`.
- After a successful write, the tab reads its page again through `bulkChanged()`.
- e2e `test/e2e/bulk.e2e.ts` covers criterion 1 against real MongoDB: 1 500 docs, typed name required (a wrong name keeps OK disabled, nothing is written before confirmation), all 1 500 updated, and the closed documents are untouched. It also covers criterion 2 for update and delete. The unit spec covers criterion 2 against the fake bridge.
- `docs/ARCHITECTURE.md` matches the implementation.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | Closing the panel while a bulk write runs aborts it silently: possible partial write and a stale page**
    - File: `packages/renderer/src/app/collection/bulk/bulk-panel.ts:225` (`close()`), `:131` (DestroyRef abort), `packages/renderer/src/app/collection/bulk/bulk-panel.html:12-21` (close button enabled while `busy()`), `packages/renderer/src/app/collection/collection-view.html:249-258` (toolbar toggle)
    - Category: Correctness
    - Problem: During `phase === 'running'` (after the user confirmed, while `docs.updateMany`/`deleteMany` is in flight), the panel's Close button and the toolbar's "Update/Delete many…" toggle are still enabled. Both call `close()` or destroy the panel, which aborts the controller whose signal was passed to `WriteGuard.run`, so the request is cancelled. The backend then kills the running operation (`write.ts:14`: "a cancel kills it on the server (the write may already have happened by then)"). Because the panel is destroyed, `changed` is never emitted, no outcome or error is shown, and the tab is not refreshed. The panel's own comment says "a write in the confirm dialog is cancelled there" (`bulk-panel.ts:219`), so it does not seem intended that a confirmed write can be stopped at all.
    - Why it matters: A multi-document update or delete is not atomic. Killing it midway leaves an unknown subset of the matching documents modified or deleted, and the user gets no feedback and still sees the old page of results. This is the "cancelled write may already have been committed" case, on the most destructive operation in the app.
    - Suggested fix: Do not abort a confirmed bulk write from the panel. Disable Close (and the toolbar toggle, or make it a no-op) while `phase() === 'running'`, or keep the write's AbortController separate so that `close()` and destroy only withdraw a pending confirmation. If a cancel of a running write is wanted, make it explicit, and afterwards refresh the tab and say that some documents may have changed. Add a spec test that closing during `running` neither drops the result nor leaves the tab un-refreshed.

## P3 Low

- [ ] **CR-2 | `describeBulk` duplicates `describeWrite` and prints `db.<coll>` shorthand that is wrong for some names**
    - File: `packages/renderer/src/app/collection/bulk/bulk.util.ts:72-83`
    - Category: Quality
    - Problem: The panel header builds its own shell text. For identifier-like names it uses `db.<coll>`, which mongosh resolves to a database method or property for names such as `stats`, `version` or `getName` (`db.stats.updateMany(...)` does not work). The confirm dialog uses `describeWrite` (`safety/operation.ts:21-23`, `db.getSiblingDB(...).getCollection(...)`), so the two show the same write in different forms, and the formatting logic exists twice.
    - Why it matters: The header claims to show "the call the panel runs". For those names it is not a runnable call, and the second formatter can drift from the one the safety layer treats as authoritative.
    - Suggested fix: Build the header from `describeWrite('docs.updateMany' | 'docs.deleteMany', params)` (with a placeholder update when none is valid), or at least use `db.getCollection("<name>")` for every name.

## Review conclusion

Material issues found; fix before completing the task. CR-1 (P2) can cause a silent partial bulk write. No acceptance criterion is unmet in the production code as of 855df5a. The parent worker still has to record the evidence for criteria 1 and 2 with `tasks.py verify` (`python tasks.py verify bulk-ops-ui` lists both as unverified at the time of this review).

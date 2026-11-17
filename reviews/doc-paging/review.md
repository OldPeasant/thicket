# Code Review

Date: 2026-11-17

Task: doc-paging - M1: Paging inside documents

Scope: review round 3 of the final code after the merge with conflict-ui (e258b01) and the test-writer's round-3 tests (999f96b). Committed task change `git diff abf371ae58c3f6c170629acb6380e03615a54df5..2742e63f6a0463c213d528c5a1e597d52a9cfc8e -- . ':!tasks' ':!reviews'` (47 files, +3017/-531). I checked the merge resolution of e258b01 with `git show --remerge-diff` and read the doc-paging x conflict-ui paths in full: `document-actions.service.ts` (save, send, keepServer, resolveWith, resolveBlocker, readBack, failed/serverVersion), `edit-session.ts` (partial flag stickiness, rebase, discard), `collection-view.ts` (isPartial, docChanged, treeOf, slicedOf, documentChanged), `collection-results.service.ts` (patchDocument), `array-slice.service.ts`, `json-table.component.ts` (total of a registered array), `packages/core/src/diff/diff.ts` (how arrays are diffed), and `packages/backend/src/docs/write/write.ts` `conflict()`. Uncommitted: only the untracked `build/` directory, which is not part of this review.

Requirements:
- tasks/doc-paging.md acceptance criteria and the three recorded assumptions
- SPEC.md "Paging inside a document" and "Conflict detection"
- docs/ARCHITECTURE.md "Paging inside documents"
- AGENTS.md, docs/QUALITY.md
- Previous review rounds (CR-1..CR-7), reviews/doc-paging/tests.md (round 3, TW-1/TW-2), tasks/conflict-partial-docs.md, tasks/docs-get-numeric-slice.md
- Parent instructions (focus: cut arrays, partial flag and read-back with `sliceAbove` in conflict-ui's Save and conflict paths)

Git range:
- Branch: main
- HEAD: 2742e63f6a0463c213d528c5a1e597d52a9cfc8e (task code identical to 9ae0703 and 999f96b)
- Base/start: abf371ae58c3f6c170629acb6380e03615a54df5 (`git merge-base HEAD origin/main`)
- Commits reviewed: 20 in `abf371a..HEAD` (task commits dc1bf2b, 670ffdb, 6539f25, ea897c5, a4191c8, 158b959, 32bf828, 52ba7e0, the conflict-ui merge e258b01, the round-3 test commit 999f96b, plus main merges and task/review-only commits)

Commands run:
- `git log --oneline abf371a..HEAD`, `git diff --stat abf371a HEAD -- . ':!tasks' ':!reviews'` -> 47 files, +3017/-531
- `git show --remerge-diff e258b01 -- packages/renderer/src/app/document/document-actions.service.ts packages/renderer/src/app/collection/ packages/renderer/src/app/raw-editor/raw-editor.ts` -> conflicts in `save()`, `collection-view.html` and `docChanged` were resolved by keeping doc-paging's `isPartial($index)` / `isPartial(index)` together with conflict-ui's `hidesSubFields`, and moving the PARTIAL_REFUSED choice into conflict-ui's shared `send()`. No doc-paging behavior was lost.
- `git diff --stat 35aa821 HEAD -- . ':!tasks' ':!reviews'` -> only the two round-3 spec files changed since the code on which both criteria were verified, so the recorded AC evidence still applies to the current production code.
- `npx vitest run packages/backend/src/docs/query/query.spec.ts packages/contract/src/index.spec.ts` -> 2 files, 446 passed
- `cd packages/renderer && npx ng test --include src/app/explorer/doc-paging.spec.ts --include src/app/collection/collection-view.spec.ts --include src/app/collection/collection-results.service.spec.ts --include src/app/document/document-actions.service.spec.ts --include src/app/document/table-editing.spec.ts --include src/app/document/document-editing.spec.ts --include src/app/explorer/services/array-slice.service.spec.ts --include src/app/explorer/services/page.service.spec.ts --include src/app/raw-editor/raw-editor-collection.spec.ts --include src/app/explorer/pager/pager.component.spec.ts` -> 10 files, 383 passed
- I did not re-run the e2e myself (it needs the renderer/desktop build and the mongo8 container). The parent recorded it with `tasks.py verify`: 1 passed, opened in 190 ms, `$slice` reads for pages 2, 400 and 500. The e2e file and the production code under it have not changed since then.

Acceptance criteria assessment:
1. Component tests (pager on a 2 000-item array, jump to page, edits on page 7 kept when paging away): `doc-paging.spec.ts` is unchanged and passed again in the focused run (part of the 383). The evidence was recorded with `tasks.py verify` (16 passed). Met.
2. e2e (50 000-item document opens in < 2 s and pages through getSlice): recorded with `tasks.py verify` with the command, configuration and result. The test file is unchanged and the production code it runs is unchanged since that run. Met, based on the recorded evidence.

doc-paging x conflict-ui integration (what I checked):
- Partial flag in the Save path: `save()` passes `this.isPartial(key)`. This is the edit entry's sticky `partial` flag, which `docChanged` sets from `isPartial(index)` (projection or cut arrays). `send()` refuses whole-array `$set` and replace operations for a partial document, and words the refusal PARTIAL_REFUSED when no projection is active. Correct.
- Overwrite / Merge manually: for a cut document without a projection, `resolveBlocker` returns `'projection'`, so both are refused and not offered. Checked further: with a top-level projection that includes the cut array, `resolveBlocker` allows Overwrite. Even then, the base is the whole server array from the conflict detail and the local copy has only the loaded first page. `diffArray` (`packages/core/src/diff/diff.ts:162-181`) produces a whole-array `$set` for a shorter array, and `overwritesHiddenData` refuses that because the path exists in the base. No unloaded items can be overwritten.
- Re-insert after a delete on the server: refused for a partial document (`resolveWith`, line 252).
- Keep server version: `slicedOf(key)` reads the page's `sliced` before the read-back, so the read-back is cut (`sliceAbove`) and the answered `sliced` is stored. When the read-back fails and `saved === undefined` (unknown server version), nothing replaces the loaded document, and its cut flags stay. See CR-8 for the fallback that shows the conflict version.
- Read-back after a successful Save keeps the arrays cut, and the fallback uses the cut flags of the shown (cut) local document. Correct.
- A late read-back after the user moved to another result page finds no index and patches nothing (`documentChanged`/`patchDocument`). This is safe.

Deferral of TW-1 / TW-2: I agree with it. Neither can lose data (Overwrite, Merge and re-insert are refused for a cut document). Both are in conflict-ui's view (`conflict/conflict-view.ts`), outside this task's `touches`. The follow-up task `conflict-partial-docs` has concrete criteria for both. One addition the parent may want there: the re-insert refusal for a cut document (`PROJECTION_REINSERT_REFUSED`, `document-actions.service.ts:549-551`) also says "with a projection active". It is the same kind of wording issue as TW-2, but the follow-up's second criterion names only the conflict note and the refused-resolve message.

## Status of previous findings

- CR-1 (sparse-array memo miss on the first page): Resolved (round 2). Code unchanged.
- CR-2 (read-back after Save): Resolved. The merge kept `readBack` with `sliceAbove`. It now serves conflict-ui's Save, Keep server version and re-insert paths too, and the round-3 tests cover them.
- CR-3 (cut arrays without `_id`): Resolved (round 2). Code unchanged.
- CR-4 (missing wiring tests): Resolved (round 2). Round 3 added 14 tests for the conflict paths.
- CR-5 (inner page state never reset): Resolved (round 2). Code unchanged.
- CR-6 (refusal wording): Resolved. After the merge, PARTIAL_REFUSED is chosen in conflict-ui's shared `send()` (`document-actions.service.ts:324-327`), so Save and the resolve paths both use it.
- CR-7 (`docs.get` `sliceAbove` cuts arrays with all-digit names): Open, deferred to follow-up task `docs-get-numeric-slice` (P3, not blocking).

Summary: 0 P0, 0 P1, 0 P2, 1 P3

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-8 | Keep server version with a failed read-back shows the whole conflict version but marks it cut with the old totals**
    - File: `packages/renderer/src/app/document/document-actions.service.ts:504` (reached from `keepServer`, line 202)
    - Category: Correctness
    - Problem: The `readBack` fallback always passes `cut?.arrays`, the `sliced` entries of the document as it was loaded. In the Save path this is right, because `saved` is the local document and its cut arrays hold only the loaded first page. In `keepServer`, `saved` is `conflict.current`, the server's whole current document from the conflict detail (`write.ts` `conflict()` reads it without slicing). That document is not cut, but it is registered as cut with the old `total`. `JsonTableComponent` uses `Math.max(source.total, length)` (`json-table.component.ts:241, 442`). So if the array shrank on the server since the load, the pager still lists the old length, and pages past the real end are read through `docs.getSlice` and come back empty. In every case the whole document is also marked partial and its arrays read-only, although all of it is loaded. The round-3 view test `Keep server version shows the conflict version, still cut, when the read-back fails` asserts this state: 300 items in the conflict version, and the pager says "of 50,000".
    - Why it matters: This happens only in a narrow fallback (Keep server version, then a failed `docs.get`). It is display-only and conservative, and no data can be lost. But the pager can show pages that do not exist, and right after a conflict the array length is more likely to have changed.
    - Suggested fix: Let the caller say whether `saved` is cut. For example, `keepServer` could pass the cut entries with `total`/`loaded` set to the actual lengths of those arrays in `conflict.current`. It could also pass none, because the version is whole. Then adjust the round-3 test to the chosen behavior. This can also go into the `conflict-partial-docs` follow-up, which already touches `document-actions.service.ts`.

## Review conclusion

No material issues found.

The conflict-ui merge (e258b01) was resolved correctly. doc-paging's partial flag, cut-array refusal, PARTIAL_REFUSED wording and read-back with `sliceAbove` all still apply in conflict-ui's Save, Overwrite, Merge, re-insert and Keep server version paths. I found no path that writes over unloaded array items. Both acceptance criteria are met: the recorded evidence still covers the current production code, and the focused backend/contract (446) and renderer (383) suites pass. CR-7 stays deferred to `docs-get-numeric-slice`, and TW-1/TW-2 are deferred to `conflict-partial-docs`, which I agree with. The only new finding, CR-8, is P3. It can be fixed now or added to the `conflict-partial-docs` follow-up.

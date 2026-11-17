# Test Report

Date: 2026-11-17

Task: multi-doc-edit — M1 (Should): Edit a field across selected rows

Scope: `git diff 2e67f6a10c9f05790847ea154daee3dd1ceef52e..9d8e036d67ff134a3459beed84b8b5ce269e0798` (task commits 020bb288, 06120087, 9d8e036d on `main`; base and commit list supplied by the parent worker). Working tree: production code unchanged; only the test files below are new or modified (uncommitted).

Requirements:
- `tasks/multi-doc-edit.md`: the goal, 2 acceptance criteria and 3 ASSUMPTION lines (one `approveAll` confirm that is always asked and shows the count and the first 10 operations; one conflict-checked `docs.update` per document, sent one after the other; checkboxes only in table view, in edit mode, on writable profiles; selection cleared when the page's `_id` list changes or edit mode ends, kept after a save; a dotted path where set creates missing parents and a non-document parent is refused; plain numbers follow the integer default; rows with unsaved edits refuse the batch; partly loaded rows allow top-level fields only; conflicting documents are listed in the panel and reloaded)
- SPEC.md M1 "Should" (quoted in `MultiEdit`'s doc comment), docs/ARCHITECTURE.md "Coverage" and "Conventions"
- Existing test conventions: `safety/write-guard.service.spec.ts`, `collection/bulk/bulk-panel.spec.ts`, `document/document-actions.service.spec.ts`, `document/table-editing.spec.ts`

## Test files changed

- `packages/renderer/src/app/collection/multi-edit/multi-edit.util.spec.ts` (new)
- `packages/renderer/src/app/collection/multi-edit/multi-edit.service.spec.ts` (new)
- `packages/renderer/src/app/collection/multi-edit/multi-edit-selection.spec.ts` (new; CollectionView + explorer table + MultiEditPanel + MultiEdit + WriteGuard against the fake bridge)
- `packages/renderer/src/app/explorer/services/row-selection.service.spec.ts` (new)
- `packages/renderer/src/app/safety/write-guard.service.spec.ts` (new `describe` block for `approveAll` added; no existing test was changed)

## Tests added or updated

Count: 81 (util 20, MultiEdit service 21, collection view / panel / json-table 21, RowSelectionService 7, WriteGuard.approveAll 12)

## Requirement coverage

Focused command (F): `cd packages/renderer && npx ng test --include='src/app/collection/multi-edit/**/*.spec.ts' --include='src/app/safety/write-guard.service.spec.ts' --include='src/app/explorer/services/row-selection.service.spec.ts'`

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: select 3 rows, set a field, save → 3 docs updated (unit/component level; the e2e itself was run by the parent, not by me) | `select 3 rows, set a field, save: one confirm with the count, 3 docs updated` (selection spec); `three documents: one confirm with the count, then one conflict-checked docs.update each` (service spec) | F | Pass |
| AC2: one conflicting document is reported, the others saved (changed on the server) | `one conflicting document is listed; the others are saved` (selection spec); `one conflicting document is reported and reloaded; the others are saved`, `a CONFLICT without a readable detail counts as changed and is reloaded` (service spec) | F | Pass |
| AC2: one conflicting document is reported, the others saved (deleted on the server) | `a conflicting document deleted on the server is still reported after the batch` (selection spec); `a document deleted on the server since loading is reported and removed from the page` (service spec) | F | **Fail** in the view (TW-1); the service-level test passes |
| One WriteGuard confirm with the document count, asked on every profile, first 10 operations then "… and N more" | `approveAll`: `production: one dialog for the whole batch…`, `alwaysConfirm asks on a non-production profile…`, `exactly 10 writes are all listed…`, `more than 10 writes: the first 10 operations, then how many more…`, `the count option overrides…`; service: `asks even on a non-production profile…`, `lists the first 10 operations in the dialog, then how many more` | F | Pass |
| approveAll: read-only, non-confirm path, cancel, mixed profiles, abort, empty batch | `read-only is refused with READ_ONLY, also with alwaysConfirm`, `non-production without alwaysConfirm: no dialog…`, `cancel rejects with CANCELLED`, `writes to several profiles in one batch are refused before any dialog`, `an already aborted signal opens no dialog`, `an abort while the dialog is open cancels the batch`, `an empty batch resolves with nothing and asks nothing` | F | Pass |
| Per-document conflict check, sent one after the other; failure of one doesn't stop the others | `sends the documents one after the other, not in parallel`, `another error on one document is listed as failed and does not stop the others`, `a failed document is listed as failed` (view) | F | Pass |
| Unchanged documents are counted, not sent | `documents that already have the value are counted, not sent`, `when every document already has the value: no dialog, nothing sent`, `documents that already have the value are counted in the summary` (view) | F | Pass |
| Unsaved edits refuse the batch | `a row with unsaved edits refuses the whole batch before asking` (service), `a row with unsaved edits refuses the batch with a message` (view) | F | Pass |
| Partly loaded rows: top-level only | `a partly loaded row allows top-level fields only` (service), `rows loaded with a projection allow top-level fields only` (view) | F | Pass |
| Read back after a save (projection, cut arrays, unreadable document) | `reads back with the query projection; an unreadable document stays as loaded`, `reads back with the cut of a partly loaded document and passes its sliced arrays` | F | Pass |
| Busy state / no double batch | `is busy while confirming and sending, and refuses a second batch meanwhile` (service), `while the batch is being confirmed the panel is busy and a second save does nothing` (view) | F | Pass |
| Dotted path: set creates parents, non-document parent refused, `_id` / `$` / empty segments refused; unset; shell-syntax value never evaluated | all of `multi-edit.util.spec.ts`; view: `shows input errors without sending anything; editing clears them`, `remove hides the value and unsets the field (nested path)`, `switching back from remove to set shows the value again` | F | Pass |
| Plain numbers follow the integer default | `a plain number takes the integer default from the settings` | F | Pass |
| Checkboxes only on the root table, in table view, in edit mode, on writable profiles | `has no checkbox column outside edit mode`, `in edit mode the root table (only) gets one checkbox per document row`, `a read-only profile has no checkbox column even in edit mode`, `other views have no row selection, and switching clears it` | F | Pass |
| Selection: select-all (mixed state), clear, cleared when the page's `_id` list changes or edit mode ends, kept after a save | `selecting rows marks them, shows the panel with the count, and select-all is mixed`, `one row reads "1 row selected"…; Clear selection hides the panel`, `a page with other documents clears the selection`, `leaving edit mode clears the selection…`, end of the AC1 view test (selection kept after the save); RowSelectionService spec (7 tests) | F | Pass |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/app/collection/multi-edit/**/*.spec.ts' --include='src/app/safety/write-guard.service.spec.ts' --include='src/app/explorer/services/row-selection.service.spec.ts'`

Result:

Fail: 1 test fails (TW-1, `a conflicting document deleted on the server is still reported after the batch`); every other new or existing test in these files passes. Before that test was added, the same selection passed 107/107.

## Full test execution

Command:

`npm run check` (repo root: eslint + prettier --check, tsc / ngc typecheck of every workspace, root `vitest run`, renderer `ng test`)

Result:

Fail, only because of TW-1. Lint passed, typecheck passed, root vitest passed (87 files, 4457 tests), renderer `ng test`: 105 of 106 files, 3474 passed and 1 failed (3475 tests).

## .taskcheck

Result:

Fail: `.taskcheck` runs `npm run check` (above). The only failure is the TW-1 test.

## Bugs found

### The batch result disappears when a conflicting document was deleted on the server

Finding ID:

`TW-1`

Test:

`Edit a field across selected rows (collection view) > a conflicting document deleted on the server is still reported after the batch` (`packages/renderer/src/app/collection/multi-edit/multi-edit-selection.spec.ts`)

Production source:

`packages/renderer/src/app/collection/multi-edit/multi-edit.service.ts:166` (`if (deleted) host.documentChanged(p.key, null)`), together with `packages/renderer/src/app/collection/collection-view.ts:432-437` (the effect that clears the selection when `pageKeys()` changes) and `collection-view.html:398-399` (the panel exists only while rows are selected). `CollectionResults.patchDocument(index, null)` removes the row from the page.

Requirement:

AC2 "One conflicting document is reported, the others saved". ASSUMPTION: "Conflicting documents are listed in the panel and reloaded from the server".

Expected behavior:

After the batch, the panel stays visible and lists the deleted document (`2 deleted on the server since it was loaded`), with the summary `Saved 2 documents. …`.

Actual behavior:

`MultiEdit.save` correctly returns `conflicts: [{ label: '2', reason: 'deleted on the server since it was loaded' }]`, as the service spec shows. But removing the row changes the page's `_id` list, the effect clears the row selection, `selectedDocs()` becomes empty and the `@if` removes `app-multi-edit-panel` together with its `result` signal. The user sees no summary and no conflict list, so 2 saved documents and 1 conflict look the same as a cancelled batch. Note: keeping index-based selection after a row is removed would point at the wrong rows (the indices shift), so the fix should keep or translate the result and the selection, not just skip the clearing.

Severity:

Medium

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.`

## Coverage

Status: partial. The last complete coverage run (exit 0) measured the current production code with every test above except the final 2 (`switching back from remove to set shows the value again` and the TW-1 test). The final run on the current test snapshot exited 1 because of TW-1, and Vitest wrote no report (it does not report coverage when a test fails, and it cleaned the earlier output). After TW-1 is fixed, the coverage command below must run again.

Metric: whole-file coverage of task-changed production files (all renderer tests, so files such as `collection-view.ts`, `json-table.component.ts` and `write-guard.service.ts` include hits from older tests).
Changed-line coverage: 234/234 executable added lines covered (100%), from the same run. Method: added lines from `git diff -U0 2e67f6a1..9d8e036d` for the in-scope files, intersected with the `DA:` records of `coverage/renderer/lcov.info`. Branch records on changed lines: 176/188 (the misses are in the gap table below). These are not the same as changed-branch coverage.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `multi-doc-edit`; base `2e67f6a10c9f05790847ea154daee3dd1ceef52e`; HEAD `9d8e036d67ff134a3459beed84b8b5ce269e0798`; task commits 020bb288, 06120087, 9d8e036d as supplied by the parent and checked with `git diff --stat 2e67f6a1..HEAD` (14 files, all belong to the task).
- Source/test snapshot identifier (including uncommitted inputs): production files are the committed HEAD state (no uncommitted production changes). Final test file sha256: `multi-edit-selection.spec.ts` a775609f…fdc9, `multi-edit.service.spec.ts` c135632c…7b81, `multi-edit.util.spec.ts` 64ff8cc8…69d4, `row-selection.service.spec.ts` ba54908c…4fa7, `write-guard.service.spec.ts` 695d1cac…86d. The measured (05:54Z) snapshot differs from these hashes only in `multi-edit-selection.spec.ts` (2 tests added afterwards).
- Exact included files: `src/app/collection/collection-view.ts`, `src/app/collection/multi-edit/{index.ts,multi-edit.util.ts,multi-edit.service.ts,multi-edit-panel.ts}`, `src/app/explorer/json-table/json-table.component.ts`, `src/app/explorer/services/row-selection.service.ts`, `src/app/safety/write-guard.service.ts`. Excluded: `.html` / `.css` templates and styles (V8 does not instrument them; templates are exercised by the view spec), `test/e2e/multi-edit.e2e.ts` (a test). No renamed or deleted files.
- Provider/version, command, working directory, and test selection: Vitest v5.1.0 with v8 coverage through `@angular/build` `ng test`; `cd packages/renderer && npx ng test --coverage --coverage-include='src/app/collection/multi-edit/multi-edit.util.ts' --coverage-include='src/app/collection/multi-edit/multi-edit.service.ts' --coverage-include='src/app/collection/multi-edit/multi-edit-panel.ts' --coverage-include='src/app/collection/multi-edit/index.ts' --coverage-include='src/app/safety/write-guard.service.ts' --coverage-include='src/app/explorer/services/row-selection.service.ts' --coverage-include='src/app/explorer/json-table/json-table.component.ts' --coverage-include='src/app/collection/collection-view.ts'`; the whole renderer suite.
- Run start/completion time and exit status: measured run 2026-11-17T05:54:25Z to about 05:54:49Z, exit 0 (106 files, 3473 tests passed). Final run 05:56:58Z, exit 1 (3474 passed, 1 failed: TW-1), no coverage output.
- Generated report paths and report hashes/run identifier: `packages/renderer/coverage/renderer/coverage-summary.json` sha256 e9d391de847cc6e4545bdffd1383ac48a1e712211fc659fbb86509d0e2dd3941; `packages/renderer/coverage/renderer/lcov.info` sha256 867e237d4e974a9176a9f8828507fb27bb525b0a1fc6853f69106b398cf4bb79 (both 05:54:48Z). The final failed run removed these files. The stale `packages/renderer/coverage/coverage-summary.json` from 2026-11-16 was not used.
- Evidence outputs are fresh and inputs stayed unchanged: yes for the measured run (files were written in that run, and production files were unchanged before and after it).
- Final run after latest test additions and production fixes: no. The final run failed on TW-1 and produced no report, so the numbers describe the test snapshot without the last 2 tests. No production fix has been made yet.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `src/app/collection/multi-edit/multi-edit.util.ts` | 46/46 (100%) | 37/38 (97.37%) | 9/9 (100%) | 33/33 (100%) |
| `src/app/collection/multi-edit/multi-edit.service.ts` | 74/74 (100%) | 47/47 (100%) | 6/6 (100%) | 66/66 (100%) |
| `src/app/collection/multi-edit/multi-edit-panel.ts` | 68/70 (97.14%) | 35/38 (92.11%) | 10/10 (100%) | 59/59 (100%) |
| `src/app/collection/multi-edit/index.ts` | N/A (0/0) | N/A (0/0) | N/A (0/0) | N/A (0/0) |
| `src/app/explorer/services/row-selection.service.ts` | 23/23 (100%) | 13/13 (100%) | 9/9 (100%) | 14/14 (100%) |
| `src/app/explorer/json-table/json-table.component.ts` | 229/264 (86.74%) | 154/183 (84.15%) | 97/108 (89.81%) | 192/215 (89.30%) |
| `src/app/safety/write-guard.service.ts` | 81/81 (100%) | 73/76 (96.05%) | 12/12 (100%) | 61/61 (100%) |
| `src/app/collection/collection-view.ts` | 333/340 (97.94%) | 170/193 (88.08%) | 98/99 (98.99%) | 286/286 (100%) |
| **Aggregate (summed counters, 8 files; templates/CSS not instrumented)** | 854/898 (95.10%) | 529/588 (89.97%) | 241/253 (95.26%) | 711/734 (96.87%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `multi-edit-panel.ts:74` (set action) | switching back from "remove" to "set" | Test added afterwards (`switching back from remove to set shows the value again`, passes). Not in the measured run. |
| `multi-edit-panel.ts:60` (`summary` with no result) | none: the template reads `summary()` only inside `@if (result())` | Non-material, defensive. |
| `multi-edit-panel.ts:115` (an `ApiError` other than `CANCELLED`, e.g. `READ_ONLY`) | the panel can't be shown on a read-only profile (no checkboxes), so the UI can't reach it; `MultiEdit` rejecting with `READ_ONLY` is tested in the service spec | Justified gap. |
| `multi-edit.util.ts:75` (an error string returned from a recursion below a missing parent) | unreachable: a set below a missing parent builds new empty documents, so no non-document parent can occur | Non-material. |
| `collection-view.ts:259` (a `null` / `_id`-less row in `pageKeys`) | unreadable document on the page; only the key string is affected | Non-material for this task. Other uncovered branches in this file are in code that existed before the task (changed lines: 27/27 covered). |
| `json-table.component.ts:93,103,107` (`?? false` / `?? 0` when no `RowSelectionService` is provided) | these are reached only when `selectable` is false, so the template never calls them | Non-material, defensive. The rest of the uncovered code in this file existed before the task (changed lines: 11/11 covered). |
| `write-guard.service.ts:147` (`?? 'This connection'` for an unknown read-only profile) | unknown profiles are never read-only | Non-material, defensive. |

## Unable to test

- AC1 / AC2 as e2e (Playwright against the real stack): I did not run them. The parent reports `npx playwright test test/e2e/multi-edit.e2e.ts` as passing. My tests use the fake bridge and do not replace that evidence.
- The real `ConfirmDialog` rendering of the batch request is not tested here: the confirm service is spied or answered through `ConfirmService.answer`. The dialog component is covered by its own spec, so no follow-up is needed.

Observations (not defects, need a product decision):
- `planFieldEdit` refuses an *unset* below a non-document parent (`unset address.city` where `address: "n/a"`), and one such document refuses the whole batch. The ASSUMPTION says only that a non-document parent is refused. Treating this as "unchanged" for unset might be friendlier; current behavior is tested as implemented in the util spec.
- Running the same query again (same `_id`s) clears the selection, because the `_id` list is briefly empty while the page loads. This matches "new query" in the ASSUMPTION, so I wrote no test for either outcome.
- The panel summary for conflicts always says "changed on the server since they were loaded (reloaded…)", also when the list item says "deleted". This is only wording; it is visible only once TW-1 is fixed.

## Summary

Tests added; production defects were discovered and must be passed to the `fixer` before task completion (TW-1: the batch result and its conflict list disappear when a conflicting document was deleted on the server). Every other new test passes. Lint and typecheck pass. Coverage is partial: the last complete run predates the final 2 tests and must be repeated after the fix.

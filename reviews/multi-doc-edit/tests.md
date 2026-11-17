# Test Report

Date: 2026-11-17

Task: multi-doc-edit — M1 (Should): Edit a field across selected rows (round 2, on the fixed code)

Scope: `git diff 1602276b2f753f0f95f7d2bbc1eb75c845dd5e74..2cb13cce07a61832201efd98227831a3121a1460` (task commits 5a1060ee, ba379677, 76d0d7f8, 1a54212f, 2cb13cce on `main`; base and commit list supplied by the parent, checked with `git merge-base --is-ancestor` and `git log 1602276b..HEAD`: the 5 commits, all `multi-doc-edit`). Focus: the round-1 fixes in 2cb13cce (CR-1/TW-1 report kept on deleted rows and `RowSelectionService.removeRow`, CR-2 `partialRefusal`, CR-3 `setAll` on the shown rows, CR-5 live region). Working tree: production code unchanged; the 3 test files below are modified and uncommitted.

Requirements:
- `tasks/multi-doc-edit.md`: goal, 2 acceptance criteria, 4 ASSUMPTION lines (including the CR-2 one: the "field isn't loaded" refusal applies only with a projection, cut arrays are refused)
- `reviews/multi-doc-edit/review.md` (CR-1 … CR-6) and `reviews/multi-doc-edit/fixes.md` (the fix design: report kept in `MultiEdit.result`, selection moves with deleted rows, ended by paging / new query / edit mode off, not cleared while a batch runs)
- SPEC.md M1 "Should" (edit several documents in the table view, the confirm lists the count); docs/ARCHITECTURE.md "Write safety in the renderer" (the new multi-edit bullet) and "Coverage"
- Existing test conventions in the task's own specs and `test/e2e/multi-edit.e2e.ts`

## Test files changed

- `packages/renderer/src/app/collection/multi-edit/multi-edit-selection.spec.ts` (4 tests added)
- `packages/renderer/src/app/collection/multi-edit/multi-edit.service.spec.ts` (2 tests added)
- `test/e2e/multi-edit.e2e.ts` (1 e2e test added)

## Tests added or updated

Count: 7 (added; no existing test changed)

- View (`Edit a field across selected rows (collection view)`):
  - `a deleted row above a selected row: the selection stays on the same document` — rows 1 and 3 selected, document 1 deleted on the server: afterwards row 2 is not selected, row 3 (moved up) is, and the next batch goes only to document 3. Fails without `removeRow`'s index shift (TW-1's index note).
  - `Enter in the panel with no row left selected sends nothing` — the `count() === 0` guard in `MultiEditPanel.save` (the button is disabled, a form submit is not).
  - `leaving edit mode while the batch is sent keeps its report until Close` — `endSelection` while `busy`: the panel stays, the report arrives ("Saved 1 document.", "No rows selected"), Close removes it.
  - `a new page while the batch is sent ends the selection; the report still arrives` — the selection is cleared on the new page, the report arrives, and the read-back of a document from the old page does not change the new page.
- Service (`MultiEdit`):
  - `a cut array below the top-level field is refused; a field that only starts alike is not` — cut array `meta.items` refuses `meta`; `me` / `met` are not refused (the `startsWith(top + '.')` boundary).
  - `a batch refused before sending clears the report of the previous batch`.
- E2E: `one document deleted on the server: the report stays, the others are saved` — CR-1 against MongoDB (the review noted the e2e covered only a changed document).

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: e2e select 3 rows, set a field, save → 3 docs updated | e2e `select 3 rows, set a field, save: 3 documents updated`; view `select 3 rows, set a field, save: one confirm with the count, 3 docs updated`; service `three documents: one confirm with the count, …` | `npm run test:e2e -- test/e2e/multi-edit.e2e.ts --output=/tmp/me-out2` (Playwright + Electron against the MongoDB container fixture); focused `ng test` below | Pass |
| AC2: one conflicting document reported, the others saved (int/e2e) | e2e `one document changed on the server: …`, e2e `one document deleted on the server: the report stays, the others are saved` (new); view `one conflicting document is listed; the others are saved`, `a conflicting document deleted on the server is still reported after the batch` | same e2e command; focused `ng test` | Pass |
| CR-1/TW-1: report kept when a conflicting document was deleted; selection follows the rows | view `a conflicting document deleted …`, `when every selected row was deleted …`, `a deleted row above a selected row …` (new), `Enter in the panel with no row left selected …` (new), `leaving edit mode while the batch is sent …` (new), `a new page while the batch is sent …` (new), `a page with other documents also ends the report …`; service `keeps the last result …`, `a batch refused before sending clears the report …` (new); `RowSelectionService` `removeRow …`; e2e deleted-document test (new) | focused `ng test`; e2e command | Pass |
| CR-2: partly loaded rows: hidden field under a projection and cut arrays refused | service `under a projection, a top-level field the loaded row lacks is refused (set and remove)`, `a top-level field that is a cut array is refused …`, `a cut array below the top-level field is refused; a field that only starts alike is not` (new); view `rows loaded with a projection allow top-level fields only` | focused `ng test` | Pass |
| CR-3: select-all works on the rows shown (search and explorer page) | view `select all takes only the rows the explorer search shows`, `select all takes only the rows on the explorer page shown`; `RowSelectionService` `setAll on …`, `setAll off …` | focused `ng test` | Pass |
| CR-5: the `role="status"` region is in the DOM before the result | view `the result live region is in the DOM before there is a result` | focused `ng test` | Pass |
| One confirm, always asked, count and first 10 operations (ASSUMPTION 1) | service `asks even on a non-production profile …`, `lists the first 10 operations …`; `write-guard.service.spec.ts` `approveAll` tests | focused `ng test` | Pass |
| Selection lifecycle (ASSUMPTION 2) | view `leaving edit mode clears the selection …`, `a page with other documents clears the selection`, `other views have no row selection …`, `a read-only profile has no checkbox column …` | focused `ng test` | Pass |
| Dotted path, integer default, unsaved edits refuse (ASSUMPTION 3) | util spec `planFieldEdit` tests; view `a plain number takes the integer default …`, `a row with unsaved edits refuses the batch …`; service `a row with unsaved edits refuses the whole batch …` | focused `ng test` | Pass |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/app/collection/multi-edit/**/*.spec.ts' --include='src/app/safety/write-guard.service.spec.ts' --include='src/app/explorer/services/row-selection.service.spec.ts'`

Result:

Pass (5 files, 125 tests).

E2E command:

`npm run test:e2e -- test/e2e/multi-edit.e2e.ts --output=/tmp/me-out2` (rebuilds the renderer and desktop app, then Playwright/Electron against the MongoDB container fixture), 2026-11-17T06:10:26Z–06:10:36Z

Result:

Pass (3 passed). The first run of the new deleted-document e2e failed on a test bug (it compared `_id` with `promoteValues: false`, so `Int32` vs number); fixed in the test (`Number(d._id)`), the UI assertions before it already passed.

## Full test execution

Command:

`npm run check` (repo root: `eslint . --max-warnings 0 && prettier --check .`, typecheck, root `vitest run`, renderer `ng test`)

Result:

Pass: lint and Prettier clean, typecheck passed, root vitest 87 files / 4457 tests passed, renderer 107 files / 3530 tests passed.

## .taskcheck

Result:

Pass (`.taskcheck` runs `npm run check`, above).

## Bugs found

None. Every new test passes on the fixed code (2cb13cce).

## Coverage

Status: verified (fresh run on the final production code and the final test snapshot, exit 0).

Metric: whole-file coverage of task-changed production files (whole renderer suite, so `collection-view.ts`, `json-table.component.ts` and `write-guard.service.ts` include hits from older tests).
Changed-line coverage: 281/281 executable added lines covered (100%). Method: added lines from `git diff -U0 1602276b..HEAD` per in-scope file, intersected with the `DA:` records of `packages/renderer/coverage/renderer/lcov.info`. Branch records on added lines: 216/224 (misses in the gap table). This is not changed-branch coverage.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `multi-doc-edit`; base `1602276b2f753f0f95f7d2bbc1eb75c845dd5e74`; HEAD `2cb13cce07a61832201efd98227831a3121a1460`; task commits 5a1060ee, ba379677, 76d0d7f8, 1a54212f, 2cb13cce (supplied by the parent; `git log 1602276b..HEAD` lists exactly these, all `multi-doc-edit`); file scope from `git diff --name-only 1602276b..HEAD -- '*.ts'`.
- Source/test snapshot identifier (including uncommitted inputs): production files = committed HEAD (`git diff --quiet HEAD -- packages/renderer/src ':!*.spec.ts'` before and after). Uncommitted test files, sha256 identical before and after the run: `multi-edit-selection.spec.ts` 3e09004c40f5b925…a9f196, `multi-edit.service.spec.ts` 36cfc2dbf0b16ee8…0bd61, `test/e2e/multi-edit.e2e.ts` 34132839a338d1db…90a56. Committed, unchanged: `multi-edit.util.spec.ts` 64ff8cc8…1669, `row-selection.service.spec.ts` 6a367351…e394, `write-guard.service.spec.ts` 695d1cac…d286.
- Exact included files: `src/app/collection/collection-view.ts`, `src/app/collection/multi-edit/{index.ts,multi-edit.util.ts,multi-edit.service.ts,multi-edit-panel.ts}`, `src/app/explorer/json-table/json-table.component.ts`, `src/app/explorer/services/row-selection.service.ts`, `src/app/safety/write-guard.service.ts` (paths in `packages/renderer`). Excluded: `.html` / `.css` templates and styles (V8 does not instrument them; the view spec exercises the templates), spec files and `test/e2e/multi-edit.e2e.ts` (tests), `docs/ARCHITECTURE.md` and `reviews/` (documentation). No renamed or deleted files. All 8 included files have report records.
- Provider/version, command, working directory, and test selection: Vitest v5.1.0 with v8 coverage through `@angular/build` `ng test`; in `packages/renderer`: `npx ng test --coverage --coverage-include='src/app/collection/multi-edit/multi-edit.util.ts' --coverage-include='src/app/collection/multi-edit/multi-edit.service.ts' --coverage-include='src/app/collection/multi-edit/multi-edit-panel.ts' --coverage-include='src/app/collection/multi-edit/index.ts' --coverage-include='src/app/safety/write-guard.service.ts' --coverage-include='src/app/explorer/services/row-selection.service.ts' --coverage-include='src/app/explorer/json-table/json-table.component.ts' --coverage-include='src/app/collection/collection-view.ts'`; the whole renderer suite.
- Run start/completion time and exit status: 2026-11-17T06:10:58Z to 06:11:26Z; 107 files, 3530 tests passed; coverage summary printed (exit 0).
- Generated report paths and report hashes/run identifier: `packages/renderer/coverage/renderer/coverage-summary.json` sha256 66391420543e50ac0ed500762910cf7eab1c16f5fc78a445889ed7f22f89f998; `packages/renderer/coverage/renderer/lcov.info` sha256 fb7d58b7e32778a6ecf25cf8287e9933ec33b537814980c5711a7449e31f63a7 (both written 06:11:26Z by this run; Vitest cleans the directory at the start).
- Evidence outputs are fresh and inputs stayed unchanged: yes (report mtime within the run; source and test hashes identical before and after).
- Final run after latest test additions and production fixes: yes (after all 7 new tests and after the fixer's 2cb13cce).

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `src/app/collection/multi-edit/multi-edit.util.ts` | 46/46 (100%) | 37/38 (97.37%) | 9/9 (100%) | 33/33 (100%) |
| `src/app/collection/multi-edit/multi-edit.service.ts` | 94/94 (100%) | 61/61 (100%) | 11/11 (100%) | 83/83 (100%) |
| `src/app/collection/multi-edit/multi-edit-panel.ts` | 75/77 (97.40%) | 42/44 (95.45%) | 11/11 (100%) | 64/64 (100%) |
| `src/app/collection/multi-edit/index.ts` | N/A (0/0) | N/A (0/0) | N/A (0/0) | N/A (0/0) |
| `src/app/explorer/services/row-selection.service.ts` | 39/39 (100%) | 21/21 (100%) | 11/11 (100%) | 27/27 (100%) |
| `src/app/explorer/json-table/json-table.component.ts` | 230/265 (86.79%) | 155/184 (84.24%) | 98/109 (89.91%) | 192/215 (89.30%) |
| `src/app/safety/write-guard.service.ts` | 81/81 (100%) | 73/76 (96.05%) | 12/12 (100%) | 61/61 (100%) |
| `src/app/collection/collection-view.ts` | 344/351 (98.01%) | 180/201 (89.55%) | 101/102 (99.02%) | 297/297 (100%) |
| **Aggregate (summed counters, 8 files; templates/CSS not instrumented, no file missing)** | 909/953 (95.38%) | 569/625 (91.04%) | 253/265 (95.47%) | 757/780 (97.05%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `multi-edit-panel.ts:63` (`summary` with no result) | none: the template reads `summary()` only inside `@if (result())` | Non-material, defensive. |
| `multi-edit-panel.ts:125` (an `ApiError` other than `CANCELLED`, e.g. `READ_ONLY`) | the UI can't reach it: no checkboxes on a read-only profile, and a report-only panel has Save disabled (count 0); `READ_ONLY` from `MultiEdit` is tested in the service spec | Justified gap. |
| `multi-edit.util.ts:75` (an error from a recursion below a missing parent) | unreachable: a set below a missing parent builds new empty documents | Non-material. |
| `collection-view.ts:259` (`if (doc)` false: a selected index with an unreadable / missing row) | after `removeRow` a selected index can't point past the page; an unreadable (`null`) row is skipped | Non-material. Other uncovered branches in this file are in code that existed before the task (added lines 39/39 covered). |
| `json-table.component.ts:93,105,110` (`?? false` / `?? 0` without a `RowSelectionService`) | reached only when `selectable` is false, so the template never calls them | Non-material, defensive. The rest of the uncovered code in this file existed before the task (added lines 11/11 covered). |
| `write-guard.service.ts:147` (`?? 'This connection'` for an unknown read-only profile) | unknown profiles are never read-only | Non-material, defensive. |

## Unable to test

- The real `ConfirmDialog` rendering of the batch request is covered only by the e2e tests (the renderer specs spy on `ConfirmService`); no follow-up needed.
- Screen-reader announcement of the live region (CR-5) can't be tested here; the spec checks the structural fix (the same `role="status"` element exists before and after the result).

Observations for the parent (not defects against the stated requirements; no failing test written):
- Sub-field projection (e.g. `{ "address.city": 1 }`): `partialRefusal` passes a top-level field that is loaded but may be only partly loaded (`address`). Setting or removing `address` then always reports a false "changed on the server" conflict, because the conflict filter compares the partial value. Nothing is overwritten (the conflict filter protects the hidden sub-fields), so this is safe, but the message is misleading and repeats after every reload. The ASSUMPTIONs only say "top-level fields only", so whether this should also be refused (as `DocumentActions` does with `overwritesHiddenData` for object/array values) is a product decision. Severity if treated as a defect: Low.
- Leaving edit mode or paging while a batch is being sent keeps the panel visible with "No rows selected" and the report until Close. This matches the fixer's documented design ("A report is not cleared while a batch is still running") and is now covered by tests.
- Round-1 observation still open: one document whose `unset` path runs through a non-document value (`address: "n/a"`, unset `address.city`) refuses the whole batch.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. The round-1 defect TW-1 is fixed in 2cb13cce and its test passes, together with 7 new tests (4 view, 2 service, 1 e2e against MongoDB for the deleted-document conflict). Focused specs (125), the multi-edit e2e (3), and `npm run check` / `.taskcheck` all pass. Fresh coverage on the final code: 281/281 added executable lines covered, aggregate lines 757/780 (97.05%), branches 569/625 (91.04%).

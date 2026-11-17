# Test Report

Date: 2026-11-17

Task: doc-paging - M1: Paging inside documents

Scope: `git diff abf371ae58c3f6c170629acb6380e03615a54df5..80f9c5966f415c1555af24bbd632cd1ff85596c5 -- . ':!tasks' ':!reviews'` (47 files). The base is `git merge-base HEAD origin/main`, as the parent gave it. Branch: main. HEAD: 80f9c59. This run re-tests the task after merge e258b01 (main with conflict-ui), which changed the task lines in `packages/renderer/src/app/document/document-actions.service.ts`. The fallback read-back call `host.documentChanged(key, stringifyEJson(saved), cut?.arrays)` is now guarded by `if (saved !== undefined)` in conflict-ui's reworked Save/conflict path. The parent says the rest of the task change is identical by content to what the previous report tested (as of 52ba7e0). Uncommitted at measurement: only this run's two spec changes, listed below. The untracked `build/` directory existed before this run and is not part of it.

Requirements:
- tasks/doc-paging.md: acceptance criteria 1 and 2, and the recorded assumptions. One of them: "arrays loaded page-wise are read-only ...; the document counts as partial, so Save refuses edits that would replace a whole cut array".
- SPEC.md "Paging inside a document" and "Conflict detection" (side-by-side diff with overwrite / keep server version / merge manually).
- docs/ARCHITECTURE.md "Coverage".
- Parent instructions: check how doc-paging (cut arrays, partial flags, read-back with `sliceAbove`, `sliced` passed to `documentChanged`) interacts with conflict-ui's reworked Save path (the `saved === undefined` case, conflict handling).

## Test files changed

- `packages/renderer/src/app/document/document-actions.service.spec.ts`
- `packages/renderer/src/app/collection/collection-view.spec.ts`

## Tests added or updated

Count: 14 tests added. No existing test was changed.

`document-actions.service.spec.ts` gets a new describe, `a large document with cut arrays in the conflict paths`. Its host has `slicedOf` (`{above: 100, arrays: [items, total 50 000]}`) and records the third `documentChanged` argument. It holds 9 tests:
- `a conflicting save keeps the edits and reports nothing changed to the host`
- `keepServer reads the server version back cut, with the sliced arrays it answers`: `docs.get` gets `sliceAbove: 100`, and the host receives `sliced`.
- `keepServer passes no cut arrays when the read-back answers the document whole`: an empty `sliced` becomes `undefined`.
- `keepServer shows the conflict version with the cut flags when the read-back fails`: the fallback passes `cut.arrays`.
- `keepServer of an unknown server version shows nothing when the read-back fails too`: the `saved === undefined` guard. `documentChanged` is not called, and the edits and the conflict are cleared.
- `keepServer of an unknown server version shows the cut read-back when it works`
- `Overwrite and Merge manually are refused for the partial document, nothing is written`
- `re-inserting a large document deleted on the server is refused (it is partial)`
- `a save after the conflict was kept reads back cut and passes the new cut arrays`

`collection-view.spec.ts` gets a new describe inside `a large document with a cut array`: `and a save conflict (conflict-ui)`. These are end-to-end through the real view, DocumentActions, CollectionResults, ArraySliceService and the conflict view. It holds 5 tests:
- `keeps the edit and the cut array paging through getSlice`
- `offers only Keep server version (Overwrite and Merge would replace unloaded items)`
- `Keep server version reads the document back cut and keeps paging it`: `docs.get` gets the exact params with `sliceAbove: 100`. The pager still shows "of 50,000", and Last reads `skip 49 900` through getSlice.
- `Keep server version shows the conflict version, still cut, when the read-back fails`: the conflict version has 300 items. The pager still spans 50 000, page 2 comes from memory without getSlice, and the next edit is still marked partial.
- `an unknown server version: Keep server version leaves the cut document as loaded`: the `saved === undefined` path in the view. The loaded version, its cut array and getSlice paging stay.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: pager on a 2 000-item array, jump to page, edits on page 7 kept when paging away | doc-paging.spec.ts (16 tests, unchanged) | `cd packages/renderer && npx ng test --include src/app/explorer/doc-paging.spec.ts ...` (focused command below) | Pass |
| AC2: 50 000-item array document opens in < 2 s and pages via getSlice | test/e2e/doc-paging.e2e.ts | `npx playwright test test/e2e/doc-paging.e2e.ts`, run by the parent on HEAD 80f9c59; not re-run here because it is unchanged | Pass (as reported by the parent): 1 passed, opened in 190 ms, slice reads for pages 2, 400 and 500 |
| Assumption: a large document is partial and cut arrays are not replaced on Save; read-back keeps the arrays cut (`sliceAbove`, `sliced`) | collection-view.spec.ts `a large document with a cut array` (existing tests plus the 5 new ones); document-actions.service.spec.ts (new describe plus the existing PARTIAL_REFUSED tests) | focused renderer command below | Pass |
| doc-paging x conflict-ui: a conflicting save of a large document keeps the edits, the partial flag and getSlice paging | `a conflicting save keeps the edits ...`; `keeps the edit and the cut array paging through getSlice` | same | Pass |
| doc-paging x conflict-ui: Keep server version reads back cut and keeps the cut flags (success, whole answer, read-back failure) | `keepServer reads the server version back cut ...`, `keepServer passes no cut arrays ...`, `keepServer shows the conflict version with the cut flags ...`; view tests `Keep server version reads the document back cut ...`, `... still cut, when the read-back fails` | same | Pass |
| doc-paging x conflict-ui: `saved === undefined` (unknown server version, read-back fails): nothing is shown in place of the document, and its cut flags stay | `keepServer of an unknown server version shows nothing when the read-back fails too`; view `an unknown server version: Keep server version leaves the cut document as loaded` | same | Pass |
| doc-paging x conflict-ui: Overwrite, Merge manually and re-insert must not write a large partial document | `Overwrite and Merge manually are refused ...`, `re-inserting a large document deleted on the server is refused ...`; view `offers only Keep server version ...` | same | Pass. The wording and diff issues are listed as TW-1 and TW-2 below. |
| Backend `slice` / `sliced`, contract schemas | query.spec.ts, contract index.spec.ts (unchanged) | `npx vitest run packages/backend/src/docs/query/query.spec.ts packages/contract/src/index.spec.ts` | Pass (446) |

## Focused test execution

Command:

`npx vitest run packages/backend/src/docs/query/query.spec.ts packages/contract/src/index.spec.ts`

`cd packages/renderer && npx ng test --include src/app/explorer/doc-paging.spec.ts --include src/app/collection/collection-view.spec.ts --include src/app/collection/collection-results.service.spec.ts --include src/app/document/document-actions.service.spec.ts --include src/app/document/table-editing.spec.ts --include src/app/document/document-editing.spec.ts --include src/app/explorer/services/array-slice.service.spec.ts --include src/app/explorer/services/page.service.spec.ts --include src/app/raw-editor/raw-editor-collection.spec.ts`

Result:

Pass. Backend and contract: 2 files, 446 tests (2026-11-17T02:25:48Z). Renderer: 9 files, 374 tests (02:25:52Z to 02:26:04Z). Before that, the new tests ran alone: document-actions.service.spec.ts 132 passed, collection-view.spec.ts 56 passed.

## Full test execution

Command:

`npm run check` (eslint and prettier, typecheck, root vitest, renderer `ng test`)

Result:

Pass, exit 0 (2026-11-17T02:27:28Z to 02:28:25Z, 57 s). Root: 62 files, 3480 tests. Renderer: 77 files, 2253 tests. The first attempt stopped at `prettier --check` on the new collection-view.spec.ts code. It was formatted with `npx prettier --write` (test file only) before the passing run.

## .taskcheck

Result:

Pass. `.taskcheck` runs `npm run check`; see above.

## Bugs found

No production defect makes a test fail. All doc-paging x conflict-ui paths keep the data safe: nothing unloaded is written, every read-back stays cut, and the cut flags survive every fallback. Two findings at the interaction of doc-paging and conflict-ui affect what the conflict view shows for a large document. In both, the expected behavior is not stated by the task or SPEC, so they are written down here for the parent to decide (fix now or open a follow-up task). There are no failing tests for them, because the required wording or diff is not defined.

### Conflict diff counts the unloaded items of a cut array as differences

Finding ID:

`TW-1`

Test:

None committed. Reproduced with a temporary probe in the collection-view `and a save conflict (conflict-ui)` setup, then removed. Steps: rename the large document (items cut at 100 of 50 000) and save into `CONFLICT` with `detail.current` = the server version with 300 items and another `name`.

Production source:

`packages/renderer/src/app/document/conflict/conflict-view.ts:415-423` (`item()`: `visibleFields` keeps the whole `items` field of the server version, and `diffLines(lines(local), lines(server))`). The conflict detail is the whole server document (`packages/backend/src/docs/write/write.ts` `conflict()`), and so is `serverVersion()` in `document-actions.service.ts:468-481`. Neither uses `sliceAbove`.

Requirement:

SPEC "Conflict detection: ... shows a side-by-side diff". Task assumption: arrays loaded page-wise are read-only, and the document is partial.

Expected behavior:

The diff shows what differs: here only `name`. Items the user never loaded are not shown as removed by "your version".

Actual behavior:

The view shows "202 differing lines": `changed` 2, `right` (server-only) 200, `same` 104. The 200 items the renderer never loaded appear as lines your version lacks. For the AC2 document (50 000 items), the conflict view would render about 49 900 server-only rows from the whole conflict document, so the renderer still receives and renders the whole large document.

Severity:

Medium. It misleads the user and costs performance only in the conflict view of a large document. No data can be lost, because Overwrite and Merge are not offered.

Fix required:

Decision needed by the parent worker: fix in production code (for example, compare cut arrays only over their loaded items, or read the server version with `sliceAbove`) or record a follow-up task. Do not weaken the existing tests.

### Conflict note for a large document says it was loaded with a projection

Finding ID:

`TW-2`

Test:

None committed (same probe as TW-1). The committed tests check that Overwrite and Merge are not offered (`offers only Keep server version ...`) but do not assert the wording.

Production source:

`packages/renderer/src/app/document/conflict/conflict-view.ts:69-74` (the note shown when `blocked`), and `document-actions.service.ts:219-227` `resolveBlocker()` → `'projection'` for any partial document without a projection. The direct `actions.overwrite` / `saveMerged` calls use `PROJECTION_RESOLVE_REFUSED` (`document-actions.service.ts:540-543`).

Requirement:

Task assumption (the document is partial because of cut arrays). The task already changed the Save refusal to `PARTIAL_REFUSED` for this case, so the user is not told about a projection that does not exist.

Expected behavior:

The note says why Overwrite and Merge are unavailable for a large document read page by page.

Actual behavior:

"Overwrite and Merge manually are not available: the document was loaded with a projection that hides parts of fields or is no longer active ... To use them, clear the projection, run the query again and edit again." No projection was ever set, and following the advice does not help.

Severity:

Low (wording only).

Fix required:

Decision needed by the parent worker: fix with the TW-1 change or in a follow-up task.

### Observation (not a defect)

`serverVersion()` (used when the conflict detail has no readable version) reads the document whole, without `sliceAbove`. That is by design for the comparison. It is noted here because it is the same whole-document transfer as in TW-1.

## Coverage

Status: verified. The final run came after the latest test additions, and no production code changed since HEAD 80f9c59.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: 232/235 changed executable renderer lines (98.72%). Method: intersect lcov `DA` lines with the added/modified lines of `git diff -U0 abf371a..HEAD -- packages/renderer/src` (spec files are not in the lcov include list). The 3 uncovered lines are `json-table.component.ts:157, 158, 608`. `document-actions.service.ts`: 6/6 changed executable lines covered, and both sides of `cut === undefined ? ...` and `sliced.length > 0 ? ...` are now exercised. Backend `query.ts` and contract `docs.ts` have 100% line coverage, so all their changed lines are covered. Changed-branch coverage was not measured.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: doc-paging. Base abf371ae58c3f6c170629acb6380e03615a54df5 (`git merge-base HEAD origin/main`, given by the parent). HEAD 80f9c5966f415c1555af24bbd632cd1ff85596c5. Scope given by the parent: `git diff abf371a HEAD -- . ':!tasks' ':!reviews'`. File list: `git diff --name-only --diff-filter=AMR abf371a HEAD -- '*.ts' ':!*.spec.ts' ':!test/**'`.
- Source/test snapshot identifier (including uncommitted inputs): HEAD 80f9c59 plus uncommitted `packages/renderer/src/app/collection/collection-view.spec.ts` sha256 8f318c3e0fc8714b9634c5d7a67906d8001df94d5a2850b949e5749c47975bc9 and `packages/renderer/src/app/document/document-actions.service.spec.ts` sha256 0c5e274961ced58d6558f35449a8783c8b450358cd137b84b5fa9f57aac75d3a. The hashes were identical before and after the coverage runs.
- Exact included files; renamed/deleted/excluded files and reasons: 16 measured files. `packages/backend/src/docs/query/query.ts`, `packages/contract/src/docs.ts`, and 14 renderer files: `collection/collection-results.service.ts`, `collection/collection-view.ts`, `document/document-actions.service.ts`, `explorer/editable-value/editable-value.component.ts`, `explorer/json-form/json-form.component.ts`, `explorer/json-lines/json-lines.component.ts`, `explorer/json-table/json-table.component.ts`, `explorer/page.util.ts`, `explorer/pager/pager.component.ts`, `explorer/services/array-slice.service.ts`, `explorer/services/json-lines.service.ts`, `explorer/services/jump.service.ts`, `explorer/services/nested-page-size.service.ts`, `explorer/services/page.service.ts`. Excluded: `explorer/reveal.util.ts` and `explorer/services/reveal.service.ts` (deleted by the task, cannot be instrumented at HEAD); `test/e2e/doc-paging.e2e.ts` (a test); HTML/CSS templates (not instrumented as TS; their behavior is exercised by the component specs); `docs/ARCHITECTURE.md` (documentation). Missing instrumentation: none.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with `@vitest/coverage-v8` ^5.1.0 (v8), node v24.21.0.
  - `packages/backend`: `npx vitest run --coverage --coverage.include='src/docs/query/query.ts' --coverage.reportsDirectory=coverage/doc-paging-r3 --coverage.reporter=text --coverage.reporter=json-summary` (all backend tests: 27 files, 1137 tests)
  - `packages/contract`: the same with `--coverage.include='src/docs.ts'` (4 files, 731 tests)
  - `packages/renderer`: `npx ng test --coverage --coverage-reporters=lcovonly --coverage-reporters=json-summary` with one `--coverage-include=src/app/...` option per renderer file above (all renderer specs: 77 files, 2253 tests)
- Run start/completion time and exit status: backend 2026-11-17T02:28:32Z to 02:28:45Z, all passed. Contract finished 02:28:46Z, all passed. Renderer 02:29:02Z to 02:29:21Z, all passed.
- Generated report paths and report hashes/run identifier: `packages/backend/coverage/doc-paging-r3/coverage-summary.json` sha256 f89618bdfd28c7f8e861b0b56044273d3de2e640f13e42e7e4f1d815cc7cf317; `packages/contract/coverage/doc-paging-r3/coverage-summary.json` sha256 e5477bfa0cab340e89554ea374e6cc94768763dbecc67b8e9e226f010f09edd0; `packages/renderer/coverage/renderer/coverage-summary.json` sha256 763e0bc987099b6b10b3548b6d2170c397130bc0f3781222b5268f7a5968b4b2; `packages/renderer/coverage/renderer/lcov.info` sha256 0d01390fbb89174359dcd2b08f4b366fd75d556de897663a1639c48d4da6ac22. All are git-ignored.
- Evidence outputs are fresh and inputs stayed unchanged: yes. The backend and contract reports went to a new directory (`doc-paging-r3`, which did not exist before). `packages/renderer/coverage/` did not exist before the renderer run, and its files are timestamped 03:29:21+01:00 (= 02:29:21Z). The snapshot hashes did not change.
- Final run after latest test additions and production fixes: yes.

Values below use covered/total (percentage).

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/docs/query/query.ts` | 270/270 (100%) | 218/219 (99.54%) | 47/47 (100%) | 226/226 (100%) |
| `packages/contract/src/docs.ts` | 9/9 (100%) | 9/9 (100%) | 3/3 (100%) | 9/9 (100%) |
| `packages/renderer/src/app/collection/collection-results.service.ts` | 274/279 (98.2%) | 177/184 (96.19%) | 37/37 (100%) | 238/238 (100%) |
| `packages/renderer/src/app/collection/collection-view.ts` | 227/234 (97%) | 128/151 (84.76%) | 68/69 (98.55%) | 192/192 (100%) |
| `packages/renderer/src/app/document/document-actions.service.ts` | 263/267 (98.5%) | 157/162 (96.91%) | 64/65 (98.46%) | 219/220 (99.54%) |
| `packages/renderer/src/app/explorer/editable-value/editable-value.component.ts` | 60/73 (82.19%) | 46/60 (76.66%) | 20/26 (76.92%) | 51/60 (85%) |
| `packages/renderer/src/app/explorer/json-form/json-form.component.ts` | 82/116 (70.68%) | 56/87 (64.36%) | 33/47 (70.21%) | 75/102 (73.52%) |
| `packages/renderer/src/app/explorer/json-lines/json-lines.component.ts` | 38/38 (100%) | 22/22 (100%) | 11/11 (100%) | 31/31 (100%) |
| `packages/renderer/src/app/explorer/json-table/json-table.component.ts` | 218/253 (86.16%) | 144/170 (84.7%) | 91/102 (89.21%) | 181/204 (88.72%) |
| `packages/renderer/src/app/explorer/page.util.ts` | 9/9 (100%) | 2/2 (100%) | 4/4 (100%) | 9/9 (100%) |
| `packages/renderer/src/app/explorer/pager/pager.component.ts` | 18/18 (100%) | 16/16 (100%) | 5/5 (100%) | 12/12 (100%) |
| `packages/renderer/src/app/explorer/services/array-slice.service.ts` | 52/52 (100%) | 29/29 (100%) | 7/7 (100%) | 45/45 (100%) |
| `packages/renderer/src/app/explorer/services/json-lines.service.ts` | 16/25 (64%) | 7/13 (53.84%) | 3/8 (37.5%) | 12/18 (66.66%) |
| `packages/renderer/src/app/explorer/services/jump.service.ts` | 48/54 (88.88%) | 32/37 (86.48%) | 6/8 (75%) | 42/44 (95.45%) |
| `packages/renderer/src/app/explorer/services/nested-page-size.service.ts` | 21/21 (100%) | 12/12 (100%) | 5/5 (100%) | 15/15 (100%) |
| `packages/renderer/src/app/explorer/services/page.service.ts` | 16/16 (100%) | 9/9 (100%) | 5/5 (100%) | 12/12 (100%) |
| **Aggregate (16 files, summed counters)** | 1621/1734 (93.48%) | 1064/1182 (90.02%) | 409/449 (91.09%) | 1369/1437 (95.27%) |

The aggregate leaves out the deleted files `reveal.util.ts` and `reveal.service.ts` (they cannot be instrumented at HEAD). No scoped file is unmeasured. Several numbers grew compared with the previous report (52ba7e0) because the conflict-ui code merged into `document-actions.service.ts` and `collection-view.ts` adds to the whole-file totals. `jump.service.ts` functions went from 7/8 to 6/8. Its uncovered lines (33, 48) are outside the task's changed lines, and its changed lines are all covered (4/4).

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `document-actions.service.ts` changed lines 487-505 (`readBack` with `slicedOf`) | Read-back of a large document in the Save, conflict and Keep server version paths, including `saved === undefined` | Covered by the 9 new unit tests and 5 new view tests; changed lines 6/6. The only uncovered line, 107, is not task code. |
| `json-table.component.ts:157-158` (`addGhost` through `emit`/`showLastEntry`) | Adding a schema ghost key to a paged object | Not tested, as in the previous report. Ghost keys existed before the task; the same `showLastEntry` path is covered by `adding a key to a paged object shows the page it landed on`. Low risk. |
| `json-table.component.ts:608` (`onEntryDelete` through `emit`) | Deleting a field of an object in the table | Not tested, as in the previous report. It deletes by key, so it does not depend on paging; the `emit` lock is covered through the item paths. Low risk. |
| `json-form.component.ts`, `editable-value.component.ts`, `json-lines.service.ts`, `jump.service.ts:33,48`, `collection-view.ts` branches | Pre-existing Canopy editing paths and conflict-ui code outside the task's changed lines | Outside the task scope; the changed lines are 100% covered in these files. |
| `query.ts:56` (branch: non-Error thrown while parsing EJSON) | Pre-existing code, not from this task | Outside the task scope. |

## Unable to test

- AC2 (e2e) was not re-run by this helper. It is unchanged, and the parent ran it on this HEAD: `npx playwright test test/e2e/doc-paging.e2e.ts` -> 1 passed, opened in 190 ms, slice reads for pages 2, 400 and 500.
- TW-1 and TW-2 have no committed tests, because the expected conflict-view wording and diff for a large document are not specified. The parent decides how to proceed.

## Summary

Tests added and all validation passed. The doc-paging x conflict-ui interaction (cut arrays, partial flags, read-back with `sliceAbove`, `sliced` passed to `documentChanged`, the `saved === undefined` guard, and the refused Overwrite, Merge and re-insert) now has 14 tests, and all pass. No production defect fails a test. Two findings in how the conflict view shows a large document (TW-1 Medium: unloaded items counted as differences, with the whole document rendered; TW-2 Low: the note blames a projection) need a parent decision: fix now or a follow-up task.

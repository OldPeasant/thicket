# Test Report

Date: 2026-11-17

Task: doc-paging - M1: Paging inside documents

Scope: `git diff 2656cdbc182bad12516da77e4ca30d7fff7f65e7..2ce59392dc7038e0d2172ca5e4622ea55bc4b200`, excluding `tasks/` and `reviews/`. This covers the task commits 0fa0f29, edebb9e, d4eabbd, 63fd33b, 719fdff, 6ec1e2b and 2ce5939; every commit in `origin/main..HEAD` starts with "doc-paging:". The base is `git merge-base HEAD origin/main`. Branch: main. Uncommitted at measurement: the two spec changes listed below (this run's own test changes, nothing else).

Requirements:
- tasks/doc-paging.md: acceptance criteria 1 and 2, and the three recorded assumptions (slice param and 1 MiB threshold, cut arrays read-only with the document partial, page state per uid)
- SPEC.md "Paging inside a document"
- docs/ARCHITECTURE.md "Paging inside documents", "End-to-end tests", "Coverage"
- reviews/doc-paging/review.md finding CR-4 (missing docs.find slice-wiring tests); reviews/doc-paging/fixes.md (CR-1, 2, 3, 5, 6)
- Parent instructions

## Test files changed

- `packages/renderer/src/app/explorer/doc-paging.spec.ts`
- `packages/renderer/src/app/raw-editor/raw-editor-collection.spec.ts`

Earlier test-writer and fixer runs had already committed the tests for CR-4 and the fixes (commits 719fdff and 6ec1e2b). This run checked them item by item:

| CR-4 item | Existing test(s) |
|---|---|
| streamFind `slice`: per-chunk index with batchSize | query.spec.ts `cuts large documents and lists them per batch, by index into that batch` |
| streamFind reverse/fromEnd | `indexes the documents of a page read from the end in display order` |
| `sliced` omitted when nothing cut / without slice | same test (batch 1), `sends documents whole without slice, however large`, `keeps an array the projection returns only partly` |
| CollectionResults: `sliced` across several batches (`docs.length + s.index`) | collection-results.service.spec.ts `collects the cut arrays of every batch at the index of the page` (3 batches, 8 docs) |
| findParams sends `slice` | `asks docs.find to cut large arrays at the nested page size and 1 MiB`, `follows the nested page size setting` |
| patchDocument keeps `sliced` aligned on delete | `patchDocument loads a saved document whole and keeps the others cut`, `patchDocument keeps a document read back cut partly loaded` |
| Superseded read leaking `sliced` | `a superseded read does not leak its cut arrays into the newer page` |
| CollectionView.treeOf / sliceSource registration and docs.getSlice params | collection-view.spec.ts `a large document with a cut array` (`reads another page of the array with docs.getSlice by _id and path` asserts the exact params) |
| isPartial feeds Save | `marks an edit of the large document partial, ...`, `does not mark the small document of the same page partial`, read-back tests (CR-2) |
| isPartial feeds the raw editor | **gap, added**: raw-editor-collection.spec.ts `passes a large document with cut arrays to the editor as partial, its neighbour not` |
| Contract schemas: `slice` params, `sliced` entries | contract index.spec.ts `docs.find slice (large documents)` (valid, size < 1, fraction, missing/unknown key; `sliced` empty arrays, index -1, empty path) |

## Tests added or updated

Count: 2 tests added, 1 describe block changed (timeout only)

- `raw-editor-collection.spec.ts`: `passes a large document with cut arrays to the editor as partial, its neighbour not`. This covers the `[partial]="isPartial($index)"` template change. Before the change it would fail, because the raw editor got `partialDocs()`, which is false without a projection.
- `doc-paging.spec.ts`: `deletes the item it was asked to on page 7, not the one at that row of page 1`. This covers a deletion through the table's page-relative rows, which must use the absolute index (`onItemDelete`), and checks that the page stays.
- `doc-paging.spec.ts`: describe `Paging inside a document` now has `{ timeout: 30_000 }`. See "Bugs found / test robustness" below. No assertion changed.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: pager on a 2 000-item array | doc-paging.spec.ts `shows a 2 000-item array one page of 100 at a time, with a pager`, `goes to the next, last, previous and first page` | `cd packages/renderer && npx ng test --include src/app/explorer/doc-paging.spec.ts` | Pass (16/16) |
| AC1: jump to page | `jumps to a typed page; an invalid page number keeps the page shown` | same | Pass |
| AC1: edits on page 7 kept when paging away | `keeps an edit made on page 7 when paging away and back`, `deletes the item it was asked to on page 7, ...` | same | Pass |
| AC2: 50 000-item array document opens in < 2 s and pages via getSlice (network log shows slices) | test/e2e/doc-paging.e2e.ts `a 50 000-item array document opens in < 2 s and pages via docs.getSlice` | `npm run build -w packages/renderer && npm run build -w apps/desktop && npx playwright test test/e2e/doc-paging.e2e.ts --reporter=list` (harness `mongo8` fixture via Docker CLI on Podman 5.8.9, no display: harness headless ozone) | Pass: 1 passed (3.2 s test, 5.7 s total). Logged "opened the 50 000-item document in 227 ms". Profiler log asserted exactly the getSlice `$slice` reads `[100,100]`, `[39900,100]`, `[49900,100]`, and none before the first Next |
| Assumption: docs.find `slice` / batch `sliced` / 1 MiB | query.spec.ts `sliceLargeArrays` + `streamFind with slice`; contract index.spec.ts; collection-results.service.spec.ts `large documents (slice)` | `npx vitest run packages/backend/src/docs/query/query.spec.ts packages/contract/src/index.spec.ts` | Pass (442) |
| Assumption: cut arrays read-only, document partial (Save, raw editor) | doc-paging.spec.ts `can not be edited, and says why`; collection-view.spec.ts large-document block; document-actions.service.spec.ts PARTIAL_REFUSED; raw-editor-collection.spec.ts new test | renderer `ng test --include` for these specs | Pass |
| Assumption: page state per uid, reset on a new page of results (CR-5) | page.service.spec.ts; collection-view.spec.ts `starts the inner pages over when another page of documents is read` | same | Pass |
| CR-2 / CR-3 fixes | collection-view.spec.ts read-back tests; query.spec.ts `_id` tests | same | Pass |

## Focused test execution

Command:

`npx vitest run packages/backend/src/docs/query/query.spec.ts packages/contract/src/index.spec.ts`

`cd packages/renderer && npx ng test --include src/app/explorer/doc-paging.spec.ts --include src/app/collection/collection-view.spec.ts --include src/app/collection/collection-results.service.spec.ts --include src/app/document/document-actions.service.spec.ts --include src/app/explorer/services/array-slice.service.spec.ts --include src/app/explorer/services/page.service.spec.ts --include src/app/explorer/services/nested-page-size.service.spec.ts --include src/app/explorer/services/jump.service.spec.ts --include src/app/explorer/page.util.spec.ts --include src/app/explorer/pager/pager.component.spec.ts --include src/app/explorer/json-lines/json-lines.component.spec.ts --include src/app/document/table-editing.spec.ts --include src/app/raw-editor/raw-editor-collection.spec.ts`

Result:

Pass. Backend and contract: 2 files, 442 tests. Renderer: 13 files, 264 tests, before the page-7 delete test was added. The doc-paging spec alone then passed 16/16.

## Full test execution

Command:

`npm run check` (lint + prettier, typecheck, root vitest, renderer `ng test`)

Result:

Pass on the final snapshot (2026-11-17T01:54:15Z to 01:55:27Z): root 55 files / 3279 tests, renderer 76 files / 2099 tests. Before the timeout change, one of two `npm run check` runs and one of four renderer runs failed in doc-paging.spec.ts (see below). After it, two `npm run check` runs, one more `ng test` run and both coverage runs passed.

## .taskcheck

Result:

Pass. `.taskcheck` runs `npm run check`; see above.

## Bugs found

No production defects found.

### Test robustness (fixed in test code, not a production bug)

Finding ID:

`TW-1`

Test:

`doc-paging.spec.ts` > `Paging inside a document` > `goes to the next, last, previous and first page` (and the test after it)

Production source:

None. The cause is test timing.

Requirement:

AC1 component tests must pass reliably in `npm run check` / `.taskcheck`.

Expected behavior:

The suite passes on every run.

Actual behavior:

Under full-suite parallel load, a test rendering pages of the 2 000-item array took 6.7 s, above Vitest's default 5 s, and timed out. Because `fixture` is a describe-level variable, the timed-out test kept running and clicked the next test's pager. That produced a second, misleading failure: `follows the page size setting` received "1,501–2,000 of 2,000 items". Alone, the same tests take 0.4–1.4 s each.

Severity:

Medium. It made `.taskcheck` flaky, so `tasks.py done` could fail at random.

Fix required:

No production fix. The describe now has `{ timeout: 30_000 }`; no assertion changed. Optional observation: Angular logs NG0956 (track by identity re-creates 100 rows) when a getSlice page replaces the items of a partly loaded array. That is expected when the shown items are all new, and it is not a defect.

## Coverage

Status: verified (final run after the latest test additions; no production changes since HEAD 2ce5939).

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: 232/235 changed executable renderer lines (98.7%). The method intersects lcov `DA` lines with the added/modified lines of `git diff -U0 2656cdbc..HEAD` for the renderer files (excluding specs). Backend `query.ts` and contract `docs.ts` have 100% line coverage, so all their changed lines are covered. Changed-branch coverage was not measured.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: doc-paging; base 2656cdbc182bad12516da77e4ca30d7fff7f65e7 (`git merge-base HEAD origin/main`); HEAD 2ce59392dc7038e0d2172ca5e4622ea55bc4b200. Ownership: all 7 commits in `origin/main..HEAD` carry the "doc-paging:" prefix. File list from `git diff --name-only 2656cdbc..HEAD -- '*.ts'`.
- Source/test snapshot identifier (including uncommitted inputs): HEAD 2ce5939 plus uncommitted `doc-paging.spec.ts` sha256 b9ada549e43aea393afce2e21f3d135eb4d30d42f6cf65ebb19ffafe348e2a8f and `raw-editor-collection.spec.ts` sha256 4c4c26b9757942c398c2e284d69a1f2e2e7b3b298687a3217310b40f8c25d571. The hashes were identical before and after the final run.
- Exact included files; renamed/deleted/excluded files and reasons: 16 measured files: `packages/backend/src/docs/query/query.ts`, `packages/contract/src/docs.ts`, and 14 renderer files (`collection/collection-results.service.ts`, `collection/collection-view.ts`, `document/document-actions.service.ts`, `explorer/editable-value/editable-value.component.ts`, `explorer/json-form/json-form.component.ts`, `explorer/json-lines/json-lines.component.ts`, `explorer/json-table/json-table.component.ts`, `explorer/page.util.ts`, `explorer/pager/pager.component.ts`, `explorer/services/array-slice.service.ts`, `explorer/services/json-lines.service.ts`, `explorer/services/jump.service.ts`, `explorer/services/nested-page-size.service.ts`, `explorer/services/page.service.ts`). Excluded: `explorer/reveal.util.ts` and `explorer/services/reveal.service.ts`, which the task deleted and which cannot be instrumented at HEAD. Also excluded: `test/e2e/doc-paging.e2e.ts` (a test), templates/CSS (not instrumented by V8 as TS; template behavior is exercised by the component specs) and `docs/ARCHITECTURE.md` (documentation). Missing instrumentation: none.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with `@vitest/coverage-v8` (v8).
  - `packages/backend`: `npx vitest run --coverage --coverage.include='src/docs/query/query.ts' --coverage.reportsDirectory=coverage/doc-paging --coverage.reporter=text --coverage.reporter=json-summary` (all backend tests)
  - `packages/contract`: the same with `--coverage.include='src/docs.ts'`
  - `packages/renderer`: `npx ng test --coverage --coverage-reporters=lcovonly --coverage-reporters=json-summary` with one `--coverage-include` per renderer file above (all 76 renderer spec files)
- Run start/completion time and exit status: backend 2026-11-17T01:51:36Z to 01:51:47Z, all tests passed. Contract run directly after, all tests passed. Renderer final run 01:55:33Z to 01:56:07Z, 76 files / 2099 tests passed. A renderer run with the text reporter at 01:51:58Z, before the page-7 delete test, was superseded.
- Generated report paths and report hashes/run identifier: `packages/backend/coverage/doc-paging/coverage-summary.json` sha256 1c830a5b65bca426793d68e05d081be03d0d3a60233f07e80367a2ae287c7b18; `packages/contract/coverage/doc-paging/coverage-summary.json` sha256 62fbb664c1128ce7ceb3ae75231385b1436d2cf45961489b06decc83646b8c4c; `packages/renderer/coverage/renderer/coverage-summary.json` sha256 0939d38c35f6fd0b4c17ca5b1cb05c9ad20867b2945d82b67d98c447a73c2f2d; `packages/renderer/coverage/renderer/lcov.info` sha256 5b8b7e40141921fea2b4b74e5c18a6b73d36c688d2162a68a636c3cbf6fbcf27 (all git-ignored).
- Evidence outputs are fresh and inputs stayed unchanged: yes. The backend and contract reports were written to a new directory (`coverage/doc-paging`). The renderer report timestamps match the final run. The snapshot hashes were unchanged. No production or backend/contract test file changed after the backend/contract runs.
- Final run after latest test additions and production fixes: yes.

Values below use covered/total (percentage).

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/docs/query/query.ts` | 270/270 (100%) | 218/219 (99.54%) | 47/47 (100%) | 226/226 (100%) |
| `packages/contract/src/docs.ts` | 9/9 (100%) | 9/9 (100%) | 3/3 (100%) | 9/9 (100%) |
| `packages/renderer/src/app/collection/collection-results.service.ts` | 274/279 (98.2%) | 177/184 (96.19%) | 37/37 (100%) | 238/238 (100%) |
| `packages/renderer/src/app/collection/collection-view.ts` | 224/231 (96.96%) | 126/149 (84.56%) | 67/68 (98.52%) | 188/188 (100%) |
| `packages/renderer/src/app/document/document-actions.service.ts` | 164/169 (97.04%) | 77/81 (95.06%) | 42/43 (97.67%) | 139/141 (98.58%) |
| `packages/renderer/src/app/explorer/editable-value/editable-value.component.ts` | 60/73 (82.19%) | 46/60 (76.66%) | 20/26 (76.92%) | 51/60 (85%) |
| `packages/renderer/src/app/explorer/json-form/json-form.component.ts` | 82/116 (70.68%) | 56/87 (64.36%) | 33/47 (70.21%) | 75/102 (73.52%) |
| `packages/renderer/src/app/explorer/json-lines/json-lines.component.ts` | 38/38 (100%) | 22/22 (100%) | 11/11 (100%) | 31/31 (100%) |
| `packages/renderer/src/app/explorer/json-table/json-table.component.ts` | 218/253 (86.16%) | 144/170 (84.7%) | 91/102 (89.21%) | 181/204 (88.72%) |
| `packages/renderer/src/app/explorer/page.util.ts` | 9/9 (100%) | 2/2 (100%) | 4/4 (100%) | 9/9 (100%) |
| `packages/renderer/src/app/explorer/pager/pager.component.ts` | 18/18 (100%) | 16/16 (100%) | 5/5 (100%) | 12/12 (100%) |
| `packages/renderer/src/app/explorer/services/array-slice.service.ts` | 52/52 (100%) | 29/29 (100%) | 7/7 (100%) | 45/45 (100%) |
| `packages/renderer/src/app/explorer/services/json-lines.service.ts` | 16/25 (64%) | 7/13 (53.84%) | 3/8 (37.5%) | 12/18 (66.66%) |
| `packages/renderer/src/app/explorer/services/jump.service.ts` | 49/54 (90.74%) | 32/37 (86.48%) | 7/8 (87.5%) | 42/44 (95.45%) |
| `packages/renderer/src/app/explorer/services/nested-page-size.service.ts` | 21/21 (100%) | 12/12 (100%) | 5/5 (100%) | 15/15 (100%) |
| `packages/renderer/src/app/explorer/services/page.service.ts` | 16/16 (100%) | 9/9 (100%) | 5/5 (100%) | 12/12 (100%) |
| **Aggregate (16 files, summed counters)** | 1520/1633 (93.08%) | 982/1099 (89.35%) | 387/426 (90.85%) | 1285/1354 (94.90%) |

The aggregate excludes the deleted files `reveal.util.ts` and `reveal.service.ts` (not instrumentable at HEAD). No scoped file is unmeasured.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `json-table.component.ts:157-158` (`addGhost`, changed to go through `emit` and show the last page) | Adding a schema ghost key to a paged object in the table | Not tested here. Ghost-key behavior predates the task; only the `emit`/`showLastEntry` wiring changed, and the same `showLastEntry` path is covered by `adding a key to a paged object shows the page it landed on`. Low risk. |
| `json-table.component.ts:608` (`onEntryDelete` via `emit`) | Deleting a field of an object in the table | Not tested here. Key-based, so it is independent of paging; the `emit` lock is covered through `onItemChange`/`onItemDelete` and `can not be edited, and says why`. Low risk. |
| `json-table.component.ts:630` (`onItemDelete` on a paged array) | Deleting an item on a later page must use the absolute index | Covered now: `deletes the item it was asked to on page 7, ...` |
| `json-form.component.ts`, `editable-value.component.ts`, `json-lines.service.ts`, `jump.service.ts:33,48`, `collection-view.ts` branches | Remaining uncovered lines are outside the task's changed lines (changed-line coverage of these files is 100%): pre-existing Canopy editing paths | Outside the task scope; no tests added. |
| `query.ts:56` (branch: non-Error thrown while parsing EJSON) | Pre-existing (commit e7c0a75), not task code | Outside the task scope. |

## Unable to test

- Nothing required by the acceptance criteria was left unrun. The e2e ran against the real built Electron app and a `mongo8` container, headless (no X display; the harness falls back to `--ozone-platform=headless`), not under `xvfb-run`, because `xvfb-run` is not installed here. The open time of 227 ms was measured on this machine.

## Summary

Tests added and all validation passed. The CR-4 slice-wiring tests from the earlier run were already in place. This run added the missing raw-editor `isPartial` test and a page-7 delete test, and it fixed a timeout flake in the AC1 component spec that made `.taskcheck` fail intermittently. The e2e for AC2 passed (227 ms open, getSlice reads `[100,100]`, `[39900,100]`, `[49900,100]`). No production defects found.

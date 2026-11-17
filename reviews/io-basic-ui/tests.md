# Test Report

Date: 2026-11-17

Task: io-basic-ui - M1: Import/export dialogs

Scope: `git diff 01305873def284d41f41a923f25d0fd12c685d72..78316e45ef1cb9ea76d6241930c003e79e9b0ce9`
(second pass, final code after the fixes). Base 01305873def284d41f41a923f25d0fd12c685d72 comes from
the parent. The task commits are 548f7eb (panels), dc2e96e (e2e and read-only tests), e11f536
(reuses the `readOnly` signal after the raw-editor merge), fbc733f (unit tests and reports) and
78316e4 (fixes for TW-1 and CR-1..CR-4). Branch `main`, HEAD
78316e45ef1cb9ea76d6241930c003e79e9b0ce9. All production files were committed when measured. The
only uncommitted inputs are the three spec files listed below. `reviews/io-basic-ui/review.md` also
had uncommitted changes, made by another helper. It is not a test input.

Requirements:
- `tasks/io-basic-ui.md`: the acceptance criteria and the three recorded assumptions (panels under
  the pager, import defaults and a 5-of-20 preview, read-only profiles hide Import and close the
  panel)
- `reviews/io-basic-ui/review.md` (CR-1..CR-4), `reviews/io-basic-ui/fixes.md`, and the first-pass
  TW-1 in this report's earlier revision
- `docs/ARCHITECTURE.md`, section "Coverage"
- The parent's instructions: check the fixes have tests, edit test files only

## Test files changed

In this pass (uncommitted):
- `packages/renderer/src/app/io/import-panel.spec.ts` (4 tests added)
- `packages/renderer/src/app/io/export-panel.spec.ts` (3 tests added)
- `packages/renderer/src/app/collection/collection-view.spec.ts` (1 test added)

From the first pass and the fixer (committed): `io.util.spec.ts` (new), `export-panel.spec.ts`
(new), `import-panel.spec.ts` (new), and 3 + 1 tests appended to `collection-view.spec.ts`.

## Tests added or updated

Count in this pass: 8 added, none changed. The 4 spec files now hold 111 tests (103 before this pass).

The new tests:
- ImportPanel `production: a cancelled confirm dialog does not block a later Import`. Checks that the
  new `approveAbort` guard is released in `finally`.
- ImportPanel `production: a second Import while the confirm dialog is open sends only one import`.
  Checks the TW-1 fix's double-start guard.
- ImportPanel `a cancelled import keeps the file chosen, so Import can be tried again`. Checks
  CR-1's boundary (only a finished import drops the file) and the CR-2 emit (`inserted` = 7 − 2).
- ImportPanel `turning read-only while the confirm dialog is open withdraws the dialog`. TW-1: the
  dialog closes at once, the panel closes, and nothing is sent or emitted.
- ExportPanel `keeps describing the exported query after Cancel, even when the query changed` (CR-4,
  cancelled phase)
- ExportPanel `after a failed export, describes the query the next try would send` (CR-4, error
  phase)
- ExportPanel `after a cancelled save dialog, describes the live query` (CR-4, idle after a null
  stream)
- CollectionView `a failed import into the tab collection also runs the query again` (CR-2, error
  path through the real view)

## Fix coverage

| Finding | Tests that cover the fix |
|---|---|
| TW-1 (pending confirmation not withdrawn) | `a profile turning read-only while the confirm dialog is open sends nothing` (the original failing test, now passing), `turning read-only while the confirm dialog is open withdraws the dialog`*, `closing the panel while the confirm dialog is open withdraws it and sends nothing`, `destroying the panel while the confirm dialog is open withdraws it`, `production: a second Import while the confirm dialog is open sends only one import`*, `production: a cancelled confirm dialog does not block a later Import`* |
| CR-1 (repeated import of a finished file) | `a finished import needs a new file choice before importing again`, `a cancelled import keeps the file chosen, so Import can be tried again`*, `a stream that fails shows the error and still reloads the sidebar` (the file stays chosen after an error) |
| CR-2 (tab not refreshed after a partial import) | ImportPanel `a stream that fails…` and `Cancel stops the import stream…` (both assert `imported`), `a cancelled import keeps the file chosen…`*; CollectionView `a cancelled import into the tab collection also runs the query again`, `a failed import into the tab collection also runs the query again`* |
| CR-3 (short `db.name` form printed for non-identifiers) | `collRef` x2, `describeExport` `quotes a collection name that is not an identifier`, ExportPanel `quotes a collection name…`, ImportPanel `shows a target name that is not an identifier with getCollection` |
| CR-4 (export header follows the live query) | `describes the exported query while running and done, not one applied later`, `keeps describing the exported query after Cancel…`*, `after a failed export, describes the query the next try would send`*, `after a cancelled save dialog, describes the live query`* |

\* added in this pass.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: e2e export the fixture, import into a new collection, counts match | `export the fixture, import it into a new collection: counts and documents match` (test/e2e/io.e2e.ts) | `npm run test:e2e -- test/e2e/io.e2e.ts` (headless Electron, mongo fixture through Podman) | Pass (1 passed) |
| AC2: Import into a read-only profile is not offered | CollectionView `does not offer import on a read-only profile, and closes an open import panel`; ImportPanel `a read-only profile gets no panel and closes it at once`, `turning read-only during an import stops it and closes the panel`, `turning read-only after the preview closes without importing` | `cd packages/renderer && npx ng test --include='src/app/io/**/*.spec.ts' --include='src/app/collection/collection-view.spec.ts'` | Pass |
| AC2 (edge, TW-1): read-only while the production confirm dialog is open | `a profile turning read-only while the confirm dialog is open sends nothing`, `turning read-only while the confirm dialog is open withdraws the dialog` | same | Pass |
| Pending confirmation withdrawn on close and destroy; no double start | `closing the panel while the confirm dialog is open…`, `destroying the panel while the confirm dialog is open…`, `production: a second Import while the confirm dialog is open…`, `production: a cancelled confirm dialog does not block a later Import` | same | Pass |
| Export params (filter/projection/sort/collation/limit, format, EJSON mode, no skip, limit 0) | `exportParams` x4, ExportPanel `sends the applied query with the default JSON / relaxed options`, `sends the chosen format and EJSON mode`, CollectionView `exports the applied query; a second click on Export… closes the panel` | same | Pass |
| Export command text (incl. quoted names, snapshot while running/done/cancelled, live query when idle/error) | `describeExport` x5, `collRef` x2, ExportPanel CR-4 tests listed above | same | Pass |
| Export: cancelled save dialog, progress, done, Cancel, Close, destroy, errors | ExportPanel tests from the first pass | same | Pass |
| Import preview, open dialog cancel, format switch, errors | ImportPanel `preview` describe (8 tests) | same | Pass |
| Import: WriteGuard confirmation on production, CANCELLED, non-production | `production: nothing is sent before…`, `production: cancelling the confirm dialog…`, `non-production: sends io.import…` | same | Pass |
| Import: progress, failures, cancel, stream/request error, invalid names, sidebar reload | ImportPanel `import` describe | same | Pass |
| Import: a finished import cannot be repeated without a new file choice (CR-1) | `a finished import needs a new file choice before importing again` | same | Pass |
| An import into the tab's collection re-runs its query (done, cancelled, failed; CR-2) | CollectionView `an import into the tab collection shows the new documents`, `a cancelled import into the tab collection also runs the query again`, `a failed import into the tab collection also runs the query again`, `an import into another collection leaves the shown page alone` | same | Pass |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/app/io/**/*.spec.ts' --include='src/app/collection/collection-view.spec.ts'`

Result:

Pass: 4 files, 111 tests, 111 passed.

## Full test execution

Command:

`npm run check` (repo root: eslint + prettier --check, tsc and ngc typecheck, root vitest, renderer `ng test`)

Result:

Pass. Lint and typecheck passed. Root vitest: 53 files, 3160 tests passed. Renderer: 71 files, 2014
tests passed.

E2E: `npm run test:e2e -- test/e2e/io.e2e.ts` (headless, Podman fixture). Pass: 1 passed
(`export the fixture, import it into a new collection: counts and documents match`).

`npx prettier --write` was run on the three changed spec files and left them unchanged.

## .taskcheck

Result:

Pass. `.taskcheck` runs `npm run check`, which passed (see above). `.taskcheck` itself was not run
separately.

## Bugs found

None in this pass. TW-1 from the first pass is fixed: its original test was not changed and now
passes, and the tests listed above cover the fix.

## Coverage

Status: verified. The run includes every test, and it exited 0.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured as a separate intersection. `io.util.ts`, `export-panel.ts`,
`import-panel.ts` and `index.ts` are entirely new in this task, so for them whole-file coverage
equals changed-line coverage. In `collection-view.ts`, the task's executable lines (the `ioPanel`
signal, `toggleIo` and `imported`) are not in the provider's uncovered-line list, which ends at
417-418. The file's hash is the same as in the first pass, so those line numbers still apply.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: io-basic-ui;
  base 01305873def284d41f41a923f25d0fd12c685d72 (from the parent); HEAD
  78316e45ef1cb9ea76d6241930c003e79e9b0ce9; commits 548f7eb, dc2e96e, e11f536, fbc733f, 78316e4
  (from `git log 01305873..HEAD`).
- Source/test snapshot identifier (sha256, first 12 hex): export-panel.ts e95871c96ed6;
  import-panel.ts 581579076a1f; io.util.ts fa1f8c6b5a27; index.ts affd71fa5793; collection-view.ts
  ff821d56fe51; export-panel.spec.ts 1aae0c170ce0; import-panel.spec.ts e64412ca7e2a;
  io.util.spec.ts fec138d969d2; collection-view.spec.ts 860a6c3df16f. All were the same before and
  after the run.
- Exact included files: `packages/renderer/src/app/io/{io.util,export-panel,import-panel,index}.ts`
  and `packages/renderer/src/app/collection/collection-view.ts`. Excluded: the `.html`/`.css`
  templates and styles (v8 does not instrument them; the specs exercise the templates through the
  DOM, and the e2e test runs them in the built app), `test/e2e/io.e2e.ts` (a test), and
  `tasks/` and `reviews/` (metadata). `index.ts` is measured but has no executable statements
  (re-exports only; 0/0).
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with v8 through
  `@angular/build` `ng test`, run in `packages/renderer`:
  `npx ng test --include='src/app/io/**/*.spec.ts' --include='src/app/collection/collection-view.spec.ts' --coverage --coverage-include='src/app/io/io.util.ts' --coverage-include='src/app/io/export-panel.ts' --coverage-include='src/app/io/import-panel.ts' --coverage-include='src/app/io/index.ts' --coverage-include='src/app/collection/collection-view.ts' --coverage-reporters=text --coverage-reporters=json-summary --coverage-reporters=json`
  (no filter; 111 tests)
- Run start/completion time and exit status: started 2026-11-17 02:15:56 +0100, report written
  02:16:04 +0100, exit 0 (111 passed).
- Generated report paths and hashes: `packages/renderer/coverage/renderer/coverage-summary.json`
  (sha256 8d105d239d6d…), `packages/renderer/coverage/renderer/coverage-final.json`
  (sha256 dc5e54294a40…).
- Evidence outputs are fresh and inputs stayed unchanged: yes. The report mtimes (02:16:04) fall
  within the run, and the input hashes were the same before and after.
- Final run after latest test additions and production fixes: yes. It ran on HEAD 78316e4 (which
  contains all fixes) plus this pass's spec additions.

Values below use covered/total (percentage), from the provider's json-summary.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/io/io.util.ts` | 42/43 (97.7%) | 29/30 (96.7%) | 7/7 (100%) | 34/34 (100%) |
| `packages/renderer/src/app/io/export-panel.ts` | 57/58 (98.3%) | 20/21 (95.2%) | 15/15 (100%) | 49/49 (100%) |
| `packages/renderer/src/app/io/import-panel.ts` | 146/151 (96.7%) | 62/70 (88.6%) | 30/30 (100%) | 126/129 (97.7%) |
| `packages/renderer/src/app/io/index.ts` | N/A (0/0) | N/A (0/0) | N/A (0/0) | N/A (0/0) |
| `packages/renderer/src/app/collection/collection-view.ts` (whole file, mostly code from earlier tasks) | 151/204 (74.0%) | 79/126 (62.7%) | 44/59 (74.6%) | 129/164 (78.7%) |
| Aggregate (summed counters, all 5 files; no files missing or unmeasured) | 396/456 (86.8%) | 190/247 (76.9%) | 96/111 (86.5%) | 338/376 (89.9%) |

The `io/` files alone, summed: statements 245/252 (97.2%), branches 111/121 (91.7%), functions 52/52
(100%), lines 209/212 (98.6%).

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `import-panel.ts:222-224`, branch at 221 (a non-CANCELLED `guard.approve` error that arrives without an abort) | Defensive: the only other rejection is READ_ONLY. `start()` checks `readOnly()` just before, and an abort always turns into CANCELLED | Not reachable through the UI without stubbing WriteGuard, which is core behavior. Justified gap |
| `import-panel.ts:229` (after `approve` resolved: aborted, destroyed or read-only) | TW-1 defense in depth. `WriteGuard.approve` already rejects with CANCELLED when the signal is aborted (`write-guard.service.ts:124`), and read-only/close/destroy all abort | Not reachable with the real WriteGuard. The behavior it protects is covered by the 4 TW-1 tests above. Justified gap |
| `import-panel.ts:172` (preview resolves after an abort) | Race guard: `ApiService.request` rejects with CANCELLED on abort | Justified gap; the abort path is covered by `closing while the open dialog is up…` |
| `import-panel.ts:266` (cancel during "choosing" with an earlier file) | Only reachable through `close()`, which closes the panel anyway | Non-material |
| `import-panel.ts:99,101` (`?? []` / `?? 0` with no preview) | Computed values read only while a preview exists | Non-material |
| `export-panel.ts:93` (`start()` while running) | Double-start guard; the Start button is not rendered while running | Non-material |
| `io.util.ts:56` (`shell()` with `undefined`) | Defensive: every caller checks for `undefined` first | Non-material |
| `collection-view.ts` remaining uncovered lines (151-215, 259-262, 341-403, 417-418) | Code from earlier tasks (query, paging, editing) | Outside this task's scope |

## Unable to test

- The visual result of `io-panel.css` (layout, colours) is not checked by unit tests. The e2e test
  exercises the panels in the built app. No follow-up needed within this task.
- `import-panel.ts:222-224` and `:229` can't be reached through the real WriteGuard (see the table
  above). No follow-up needed.
- The fixer noted one more case: a collection named like a mongosh `db` method (e.g. `stats`) still
  prints the short `db.stats` form. CR-3 did not cover this, so no test was added. The parent can
  decide whether it needs a follow-up.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. TW-1 and CR-1..CR-4
are fixed, and tests cover each fix. This pass added 8 tests for the edge cases of the fixes (no
double start, the guard released after a cancelled confirm, the cancelled and error export
headers, and a failed import refreshing the tab). The focused specs (111), `npm run check`, and the
io e2e test all pass on HEAD 78316e4 plus these spec additions.

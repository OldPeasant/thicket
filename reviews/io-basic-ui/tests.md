# Test Report

Date: 2026-11-17

Task: io-basic-ui - M1: Import/export dialogs

Scope: `git diff ef00038..c2dc346`, where ef00038b48cdc807f0ae7b7bc57eeab948b9a0c8 is the base
(`git merge-base HEAD origin/main` after the parent's rebase). The task commits are 000bc3e (panels),
f535cbe (e2e and read-only tests) and c2dc346 (duplicate `readOnly` removed after the raw-editor
merge). These are the rebased versions of 60e88fd/d90f400 and later 3d9869a/364d2bb; the parent
supplied them. Branch `main`, HEAD c2dc34613fe520be399340190adce400677279af. Production files were
committed when measured. The only uncommitted inputs are the test files listed below.

Requirements:
- `tasks/io-basic-ui.md`: the acceptance criteria and the three recorded assumptions (panels under
  the pager, import defaults and a 5-of-20 preview, read-only profiles hide Import and close the
  panel)
- `docs/ARCHITECTURE.md`, section "Coverage"
- The parent's instructions: the list of behaviours to cover, the FakeThicketBridge style, and edit
  test files only

## Test files changed

- `packages/renderer/src/app/io/io.util.spec.ts` (new)
- `packages/renderer/src/app/io/export-panel.spec.ts` (new)
- `packages/renderer/src/app/io/import-panel.spec.ts` (new)
- `packages/renderer/src/app/collection/collection-view.spec.ts` (3 tests appended; existing
  tests unchanged)

## Tests added or updated

Count: 55 (16 io.util, 11 export panel, 25 import panel, 3 collection view)

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: e2e export the fixture, import into a new collection, counts match | `export the fixture, import it into a new collection: counts and documents match` (test/e2e/io.e2e.ts) | `npm run test:e2e -- test/e2e/io.e2e.ts` (headless, Podman fixture) | Pass (1 passed) |
| AC2: Import into a read-only profile is not offered | CollectionView `does not offer import on a read-only profile, and closes an open import panel`; ImportPanel `a read-only profile gets no panel and closes it at once`, `turning read-only during an import stops it and closes the panel`, `turning read-only after the preview closes without importing` | `cd packages/renderer && npx ng test --include='src/app/io/**/*.spec.ts' --include='src/app/collection/collection-view.spec.ts'` | Pass |
| AC2 (edge): read-only while the production confirm dialog is open | ImportPanel `a profile turning read-only while the confirm dialog is open sends nothing` | same | **Fail**, TW-1 |
| Export params (filter/projection/sort/collation/limit, format, EJSON mode, no skip, limit 0) | `exportParams` x4, ExportPanel `sends the applied query with the default JSON / relaxed options`, `sends the chosen format and EJSON mode`, CollectionView `exports the applied query; a second click on Export… closes the panel` | same | Pass |
| Export command text, formatBytes, formatNumber, printSample | `describeExport` x4, `formatBytes` x3, `formatNumber`, `printSample` x3, `NO_PROGRESS` | same | Pass |
| Export: cancelled save dialog (streamId null) returns to idle | `a cancelled save dialog (streamId null) returns to the form without an error` | same | Pass |
| Export: progress, then done | `shows the path and progress while running, then the count when done` | same | Pass |
| Export: Cancel unsubscribes (fake records the cancel) | `Cancel stops the stream (the backend is told) and says how far it got`, `Close cancels a running export and emits closed`, `destroying the panel stops a running export` | same | Pass |
| Export: error display | `shows a failed request as an error and allows another try`, `shows a stream that fails midway as an error` | same | Pass |
| Import preview (format, 5 of 20, file info, empty or unreadable sample, format switch) | `asks for a preview of the chosen format and shows the first documents`, `shows an empty file and unreadable sample documents without failing`, `switching the format drops the chosen file`, `shows "choosing" and blocks a second dialog…`, `shows a failed preview as an error…` | same | Pass |
| Import: cancelled open dialog | `a cancelled open dialog returns to idle without an error`, `a cancelled open dialog keeps the file chosen before`, `closing while the open dialog is up withdraws the request and emits closed` | same | Pass |
| Import: WriteGuard confirmation on production, and CANCELLED | `production: nothing is sent before the confirm dialog; confirmed: true after Import`, `production: cancelling the confirm dialog sends nothing and shows no error`, `non-production: sends io.import with the options at once, without confirmed` | same | Pass |
| Import: progress and failures list | `shows progress and the first failures, then the inserted count when done` | same | Pass |
| Import: cancel, stream error, request error | `Cancel stops the import stream…`, `a stream that fails shows the error and still reloads the sidebar`, `a refused import request shows the error`, `destroying the panel stops a running import` | same | Pass |
| Import: an invalid collection name blocks the import | `an invalid collection name blocks the import and shows why`, `imports into a new, trimmed collection name…` | same | Pass |
| Import: sidebar reload after import | `reloads the sidebar collections after an import…`, `a failed sidebar reload does not turn a finished import into an error` | same | Pass |
| An import into the tab's own collection re-runs its query | CollectionView `an import into the tab collection shows the new documents (the query runs again)`, `an import into another collection leaves the shown page alone` | same | Pass |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/app/io/**/*.spec.ts' --include='src/app/collection/collection-view.spec.ts'`

Result:

Fail: 4 files, 90 tests, 89 passed, 1 failed. The failure is TW-1, a production defect, not a test
error.

## Full test execution

Command:

`npm run check` (lint: eslint + prettier --check; typecheck; root vitest; renderer `ng test`)

Result:

Fail. Lint passed, typecheck passed, and root vitest passed (53 files, 3160 tests). The renderer
run had 71 files and 1996 tests: 1995 passed and 1 failed (TW-1 only).

E2E: `npm run test:e2e -- test/e2e/io.e2e.ts` passed (1 test).

## .taskcheck

Result:

Fail. `.taskcheck` runs `npm run check`, so the result is the same as above: TW-1 is the only
failure.

## Bugs found

### Import is still sent after the profile turned read-only while the confirm dialog was open

Finding ID:

`TW-1`

Test:

`ImportPanel > read-only profiles > a profile turning read-only while the confirm dialog is open sends nothing`
(`packages/renderer/src/app/io/import-panel.spec.ts:455`)

Production source:

`packages/renderer/src/app/io/import-panel.ts:178-208` (`start()`) and `:242` (`close()`/`cancel()`)

Requirement:

AC2 "Import into a read-only profile is not offered". The task assumption says an open import
panel closes when the profile turns read-only. The component documents that "the panel itself
refuses (and closes) when the profile is or becomes read-only."

Expected behavior:

The flow is: a production profile, a file chosen, Import clicked (the WriteGuard confirm dialog is
open), and then the profile turns read-only. Closing the panel should withdraw the pending
confirmation, or `start()` should re-check `readOnly()` after `guard.approve` resolves. Either way,
no `io.import` request is sent.

Actual behavior:

`close()` → `cancel()` only cancels an active stream or a preview request. The pending
`guard.approve(...)` is not aborted, because `start()` passes no signal. The confirm dialog stays
open. When the user confirms, `start()` continues: the panel is hidden or destroyed, yet it sends
`io.import` with `confirmed: true` to a read-only profile. The backend's `guardWrites` should
refuse this (it fails closed), so no data is written. But the UI breaks its own read-only contract.
When the panel is destroyed (as in CollectionView), the new stream subscription is also created
after `onDestroy`, so nothing ever unsubscribes it.

Severity:

Low. The backend refuses read-only writes, and in practice the confirm dialog is modal.

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.`

## Coverage

Status: verified (diagnostic filter). The run that includes the TW-1 test exits 1, and Vitest then
writes no coverage report (the files in `coverage/` were stale, dated 2026-11-16, and were not
used). The numbers below come from a fresh run of the same selection with only the TW-1 test
filtered out (89 passed, 1 skipped, exit 0). Once TW-1 is fixed, the test should cover the same
lines of `start()` that the production-confirm tests already cover.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured as a separate intersection. `io.util.ts`, `export-panel.ts`,
`import-panel.ts` and `index.ts` are entirely new in this task, so for them whole-file coverage
equals changed-line coverage. In `collection-view.ts`, the task's executable lines (the `ioPanel`
signal, `toggleIo`, `imported`, lines 143-144 and 421-428) are not in the provider's uncovered-line
list (that list ends at 417-418).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: io-basic-ui;
  base ef00038b48cdc807f0ae7b7bc57eeab948b9a0c8; HEAD c2dc34613fe520be399340190adce400677279af;
  commits 000bc3e, f535cbe, c2dc346 (from the parent and `git log ef00038..HEAD`).
- Source/test snapshot identifier (sha256): export-panel.ts 9eef73e8…; import-panel.ts 168b9b95…;
  io.util.ts f7ad3432…; index.ts affd71fa…; collection-view.ts ff821d56…; io.util.spec.ts 05db2489…;
  export-panel.spec.ts 2af655d4…; import-panel.spec.ts 214fc4e8…; collection-view.spec.ts 81b60d7c….
  The production hashes were the same before and after the runs.
- Exact included files: `packages/renderer/src/app/io/{io.util,export-panel,import-panel,index}.ts`
  and `packages/renderer/src/app/collection/collection-view.ts`. Excluded: the `.html` and `.css`
  templates and styles (v8 does not instrument them; the specs exercise the templates through the
  DOM), `test/e2e/io.e2e.ts` (a test), and `tasks/` (metadata). `index.ts` is measured but has no
  executable statements (re-exports only; 0/0).
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with v8 through
  `@angular/build` `ng test`, run in `packages/renderer`:
  `npx ng test --include='src/app/io/**/*.spec.ts' --include='src/app/collection/collection-view.spec.ts' --filter='^(?!.*while the confirm dialog is open sends nothing)' --coverage --coverage-include='src/app/io/io.util.ts' --coverage-include='src/app/io/export-panel.ts' --coverage-include='src/app/io/import-panel.ts' --coverage-include='src/app/io/index.ts' --coverage-include='src/app/collection/collection-view.ts' --coverage-reporters=text --coverage-reporters=json-summary --coverage-reporters=json`
- Run start/completion time and exit status: started 2026-11-17 02:09:10 +0100, report written
  02:09:15 +0100, exit 0.
- Generated report paths and hashes: `packages/renderer/coverage/renderer/coverage-summary.json`
  (sha256 076cdd43…), `packages/renderer/coverage/renderer/coverage-final.json` (sha256 2739e56d…).
- Evidence outputs are fresh and inputs stayed unchanged: yes. The report timestamps fall within
  the run, and the input hashes were unchanged.
- Final run after latest test additions and production fixes: yes for the test additions. No
  production fix exists yet, so TW-1 needs a re-run after its fix.

Values below use covered/total (percentage).

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/io/io.util.ts` | 41/42 (97.6%) | 27/28 (96.4%) | 6/6 (100%) | 33/33 (100%) |
| `packages/renderer/src/app/io/export-panel.ts` | 53/54 (98.1%) | 15/16 (93.8%) | 15/15 (100%) | 44/44 (100%) |
| `packages/renderer/src/app/io/import-panel.ts` | 129/133 (97.0%) | 50/56 (89.3%) | 28/28 (100%) | 110/113 (97.3%) |
| `packages/renderer/src/app/io/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/renderer/src/app/collection/collection-view.ts` (whole file, mostly pre-existing code) | 151/204 (74.0%) | 79/126 (62.7%) | 44/59 (74.6%) | 129/164 (78.7%) |
| Aggregate (summed counters, all 5 files; no files missing) | 374/433 (86.4%) | 171/226 (75.7%) | 93/108 (86.1%) | 316/354 (89.3%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `collection-view.ts:422,427` (toggle closes the same panel; re-run after an import into the tab's collection) | Task behavior: after an import, the tab's documents are shown again | Tests added: `exports the applied query; a second click on Export… closes the panel`, `an import into the tab collection shows the new documents`, `an import into another collection leaves the shown page alone`. Now covered. |
| `collection-view.ts` remaining uncovered lines (151-215, 259-262, 341-403, 417-418) | Code from earlier tasks (query, paging, editing) | Outside this task's scope |
| `import-panel.ts:202-204` (a non-CANCELLED error from `guard.approve`) | Defensive: the only other rejection is READ_ONLY, which `start()` checks first | Not reachable through the UI without stubbing WriteGuard; justified gap |
| `import-panel.ts:158` (preview resolves after an abort) | Race guard: `ApiService.request` rejects with CANCELLED on abort, so the resolve branch can't happen | Justified gap; the abort path is covered by `closing while the open dialog is up…` |
| `import-panel.ts:238` (cancel during "choosing" with an earlier file) | Only reachable through `close()`, which closes the panel anyway | Non-material |
| `import-panel.ts:90,92` (`?? []` / `?? 0` with no preview) | Computed values read only once a preview exists | Non-material |
| `export-panel.ts:84` (`start()` while running) | A double-start guard; the Start button is not rendered while running | Non-material |
| `io.util.ts:56` (`shell()` with `undefined`) | Defensive: every caller checks for `undefined` first | Non-material |

## Unable to test

- The visual result of `io-panel.css` (layout, colours) is not checked by unit tests. The e2e test
  exercises the panels in the built app. No follow-up needed beyond the task's scope.
- A non-CANCELLED `WriteGuard.approve` rejection (`import-panel.ts:202-204`) can't be reached
  without mocking WriteGuard, which is core behavior. No follow-up needed.

## Summary

Tests added; production defects were discovered and must be passed to the `fixer` before task
completion. TW-1 (Low): a pending production confirmation is not withdrawn when the profile turns
read-only, so `io.import` is still sent. Both acceptance criteria otherwise pass: the e2e round trip
passes, and the read-only hiding and closing pass in the unit specs.

# Test Report

Date: 2026-11-17

Task: bulk-ops-ui - M3: Bulk update and delete from the query bar

Scope: `git diff dedda46bd91a53436def437df17145b5482d4509..d68aea9bb224c6d69cf5b11dcdd92f1d5a05eb62 -- . ':!tasks' ':!reviews'`
(task commits a295f33, 855df5a, 88f04df, d68aea9 on branch `main`; the parent worker supplied the base
and final revision). Round 2: this run re-checks the tests against the final code after fix commit d68aea9
(CR-1, TW-1, singular "document"), plus the uncommitted test changes listed below.

Requirements:
- `tasks/bulk-ops-ui.md` acceptance criteria and its two recorded assumptions (type-to-confirm also
  for updates over 1 000; applied filter + collation only, a write only for a preview of the current
  mode/update/query)
- `reviews/bulk-ops-ui/review.md` CR-1 and `reviews/bulk-ops-ui/fixes.md` (the behavior the fix
  promises: a write that was sent can't be cancelled, the `writing` output exists, and the toolbar
  toggles are locked while a write runs)
- `docs/ARCHITECTURE.md` "Bulk update/delete", "Coverage", "Conventions"
- `AGENTS.md`, parent worker instructions

## Test files changed

Round 2 (uncommitted):
- `packages/renderer/src/app/collection/bulk/bulk-panel.spec.ts` (4 tests added)
- `packages/renderer/src/app/collection/collection-view.spec.ts` (1 test added)

Earlier rounds (committed in 88f04df and d68aea9): `bulk.util.spec.ts` (new), `bulk-panel.spec.ts`,
`collection-view.spec.ts`, and the lint fix in `test/e2e/bulk.e2e.ts`.

## Tests added or updated

Count: 5 in this round, all new. No existing test was changed. The task has 60 tests in total: 49 from
round 1, 6 added by the fixer, and the 5 above.

Added in round 2:
- `BulkPanel` "a sent updateMany can not be cancelled; writing ends with its answer". It covers the
  update branch of the new `approve` → `request` path. It checks the sent params (`confirmed: true`,
  `expectedCount`), `writing` [true] then [true, false], and that Close, the mode buttons, the update
  and Preview are disabled while the write runs. It also checks that no Cancel button is shown and
  that a forced `cancel()` sends no cancel. Finally it checks the outcome text.
- `BulkPanel` "a CONFLICT answer to a sent write ends the running state: the panel can be closed again".
- `BulkPanel` "a write that is never sent (dialog cancelled, read-only) emits no writing state".
  `approve` rejects before `sent()` is called, so Close stays enabled.
- `BulkPanel` "a destroyed panel emits nothing when its sent write fails later". This covers the error
  path combined with `destroyed`: there is no `writing(false)` emission and no cancel.
- `CollectionView` "a profile turning read-only during a bulk write does not leave the toggles locked".
  This is a regression test for the `bulkWriting.set(false)` reset in the read-only effect. Without the
  reset, `ioPanel` stays `'bulk'` and the toggles would stay disabled after the profile becomes
  writable again. The test also checks that removing the panel does not cancel the write.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: e2e, updateMany on 1 500 docs requires typing the collection name and updates them | `bulk.e2e.ts` "updateMany on 1 500 documents needs the collection name typed; preview count = result" | `npm run test:e2e -- test/e2e/bulk.e2e.ts` (builds renderer + desktop, Electron + Playwright, MongoDB container fixture) on d68aea9 + round-2 test changes | Pass (2 passed) |
| AC2: Preview shows the same count the execution reports | e2e both tests (update 1 500; delete 120); `BulkPanel` "the preview shows the same count the execution reports (update)", "delete at or below 1 000 ...", "asks for the typed name at 1 001 documents, also for a delete", "an update of exactly 1 000 documents needs no typed name", "a sent updateMany can not be cancelled ..." | e2e command above; `cd packages/renderer && npx ng test --include='src/app/collection/**/*.spec.ts' --watch=false` | Pass |
| Type-to-confirm only above 1 000 (boundary 1000 / 1001), for updates and deletes (assumption) | `needsTypedName` boundary; `BulkPanel` 1 001 delete, 1 000 update, 1 500 update | renderer command above | Pass |
| CR-1 fix: a confirmed write is sent without a cancel signal; Close/destroy/cancel can't abort it | fixer tests "a confirmed write can not be closed or cancelled while it runs ...", "destroying the panel does not cancel a write that was already sent"; round 2 "a sent updateMany can not be cancelled ...", "a destroyed panel emits nothing when its sent write fails later" | renderer command above | Pass |
| CR-1 fix: Close before the send withdraws the confirm dialog and sends nothing | fixer "closing the panel while the confirm dialog is open withdraws it and sends nothing"; "cancelling the confirm dialog sends nothing"; round 2 "a write that is never sent ..." | renderer command above | Pass |
| CR-1 fix: `writing` output true on send, false on success / error / CONFLICT; nothing after destroy | fixer tests (success, SERVER_ERROR); round 2 CONFLICT, never-sent, destroyed-then-fail | renderer command above | Pass |
| CR-1 fix: toolbar toggles (Export, Import, Update/Delete many) disabled while a bulk write runs; `toggleIo` ignored; unlocked after the answer and after a read-only switch | fixer "keeps the bulk panel open while a confirmed write runs ..."; round 2 "a profile turning read-only during a bulk write does not leave the toggles locked" | renderer command above | Pass |
| Stale status singular ("1 document") | fixer "the stale status says \"document\" for a preview of one" | renderer command above | Pass |
| Update parsed in shell syntax: operators or pipeline; replacement, empty, scalar, malformed refused | `parseUpdate` suite; `BulkPanel` plain-field, empty-update, pipeline tests | renderer command above | Pass |
| Command line shown; collation passed through; no collation key when absent | `describeBulk` suite; collation tests | renderer command above | Pass |
| Preview error/retry, preview cancel, stale preview (update, filter, mode), zero matches, write error, read-only refused | round-1 `BulkPanel` tests | renderer command above | Pass |
| CollectionView wiring: open/close on the applied query, close button, read-only hides button and panel, page re-read after a bulk write | round-1 `CollectionView` tests | renderer command above | Pass |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/app/collection/**/*.spec.ts' --watch=false`

Result:

Pass: 5 files, 222 tests (217 before round 2, plus 5).

`npx prettier --check packages/renderer/src/app/collection` and
`npx eslint packages/renderer/src/app/collection --max-warnings 0`: Pass.

`npm run test:e2e -- test/e2e/bulk.e2e.ts`: Pass, 2 tests. The run built the renderer and the desktop
app from the final code.

## Full test execution

Command:

`npm run check` (lint incl. `prettier --check .`, then typecheck, then test)

Result:

Pass: lint and Prettier clean, typecheck clean, 73 files / 4 038 tests (root Vitest) and 91 files /
2 934 tests (renderer).

## .taskcheck

Result:

Pass. `.taskcheck` runs `npm run check` (AGENTS.md), which is the run above on d68aea9 plus the round-2
test changes.

## Bugs found

No production defects were found in round 2. All new tests pass against d68aea9.

TW-1 from round 1 (Prettier formatting of `bulk-panel.ts`/`bulk-panel.html`) is fixed in d68aea9:
`npm run check` passes, including `prettier --check .`. The round-1 low-severity "1 documents"
observation is also fixed and tested.

Observation (not a requirement, no finding): if the profile turns read-only while a sent write runs,
the panel is removed, the write still completes, and the destroyed panel no longer emits `changed`.
The tab therefore does not re-read its page for that write. On a read-only profile the tab shows the
documents without editing controls, and the next Run shows the current data, so this has no
requirement impact. The parent worker can decide whether it matters.

## Coverage

Status: verified. The final run is on revision d68aea9 plus the round-2 test files, after all test
additions. Production code was not changed after d68aea9.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: `bulk.util.ts` and `bulk-panel.ts` are new in the task, so their changed-line
coverage equals the whole-file numbers. For `collection-view.ts`, the provider's statement, branch and
function locations (`coverage-final.json`) were intersected with the added lines of
`git diff -U0 dedda46..d68aea9` (lines 37, 111, 166-173, 351-355, 571-572, 581-585). Result: statements
11/11, branches 7/7, functions 4/4. The method counts only locations that start on a changed line.
Per-line hit data for the changed lines was not measured separately.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `bulk-ops-ui`;
  base `dedda46bd91a53436def437df17145b5482d4509`; HEAD `d68aea9bb224c6d69cf5b11dcdd92f1d5a05eb62`;
  task commits a295f33, 855df5a, 88f04df, d68aea9 (supplied by the parent worker; confirmed with
  `git log` and `git diff --stat dedda46 d68aea9`).
- Source/test snapshot identifier (including uncommitted inputs), sha256: bulk-panel.ts `5d33e61e…`,
  bulk-panel.html `edcf6141…`, bulk.util.ts `6b407ad8…`, index.ts `aea65f32…`, collection-view.ts
  `e6b14351…`, collection-view.html `18f55e29…`, bulk-panel.spec.ts `b3d56946…` (uncommitted),
  bulk.util.spec.ts `d82799a0…`, collection-view.spec.ts `3402f59a…` (uncommitted),
  test/e2e/bulk.e2e.ts `272414ff…`. The hashes were taken before and after the coverage run and are
  identical. `git status` also showed `reviews/bulk-ops-ui/review.md` as modified. I did not change it,
  and it is not a measured input.
- Exact included files: `src/app/collection/bulk/bulk.util.ts`, `src/app/collection/bulk/bulk-panel.ts`,
  `src/app/collection/bulk/index.ts` (re-exports only; 0 executable statements, so N/A),
  `src/app/collection/collection-view.ts`. Excluded: `bulk-panel.html`/`.css` and
  `collection-view.html` (templates and styles; v8 does not instrument them, and the component specs
  and the e2e cover their behavior), `test/e2e/bulk.e2e.ts` (test), `docs/ARCHITECTURE.md` (docs),
  `reviews/` (reports). No renames or deletions.
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8` 5.1.0
  (Vitest 5.1.0 via `ng test`), run in `packages/renderer`:
  `npx ng test --include='src/app/collection/**/*.spec.ts' --watch=false --coverage
  --coverage-include='src/app/collection/bulk/bulk.util.ts'
  --coverage-include='src/app/collection/bulk/bulk-panel.ts'
  --coverage-include='src/app/collection/bulk/index.ts'
  --coverage-include='src/app/collection/collection-view.ts' --coverage-reporters=text
  --coverage-reporters=json-summary --coverage-reporters=json`
- Run start/completion time and exit status: 2026-11-17T04:13:35Z to 04:13:52Z; exit 0; 5 files and
  222 tests passed.
- Generated report paths and report hashes/run identifier:
  `packages/renderer/coverage/renderer/coverage-summary.json` (sha256 `1e1a080f…`) and
  `coverage-final.json` (sha256 `399c2d9c…`). This run wrote both at 2026-11-17 05:13:52 +0100.
- Evidence outputs are fresh and inputs stayed unchanged: yes. The file mtimes come from this run, and
  the snapshot hashes match before and after.
- Final run after latest test additions and production fixes: yes.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/collection/bulk/bulk.util.ts` | 29/29 (100%) | 25/26 (96.2%) | 5/5 (100%) | 23/23 (100%) |
| `packages/renderer/src/app/collection/bulk/bulk-panel.ts` | 143/147 (97.3%) | 76/81 (93.8%) | 29/29 (100%) | 129/129 (100%) |
| `packages/renderer/src/app/collection/bulk/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/renderer/src/app/collection/collection-view.ts` (whole file, mostly pre-existing code) | 229/259 (88.4%) | 123/160 (76.9%) | 68/74 (91.9%) | 199/216 (92.1%) |
| **Aggregate (summed counters, 4 files)** | 401/435 (92.2%) | 224/267 (83.9%) | 102/108 (94.4%) | 351/368 (95.4%) |

The aggregate excludes the template and CSS files listed above. No file in scope is missing from the
report.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `bulk.util.ts:40` (`String(error)` for a non-`Error` throw) | Defensive: `parseShellSyntax` throws `ShellSyntaxError` | Justified gap |
| `bulk-panel.ts:120` (`matchedText` with no preview at all) | The value is never shown without a preview | Justified gap |
| `bulk-panel.ts:147` (`setMode` while busy) | Defensive: the mode buttons are disabled while busy (tested for preview and for a sent write) | Justified gap |
| `bulk-panel.ts:197` (`execute` guard without a current preview) | Defensive: Execute is disabled (tested) | Justified gap |
| `bulk-panel.ts:212` (`update === null` in update mode) | Unreachable: the preview key includes the update | Justified gap |
| `bulk-panel.ts:290` (`end()` for a superseded controller) | Only reached when a second operation starts during the first; the UI prevents that | Justified gap |
| `collection-view.ts` 136, 218, 305-314, 418, 438-458, 476-481 and their branches | Pre-existing code, not changed by this task. Every changed-line location is covered (see above) | Out of task scope |

The new `sending`/`writing`/`destroyed` logic in `bulk-panel.ts` (`sent()`, the `end()` reset, the
`close()` guard, the `!this.destroyed` guards) is fully covered, including both sides of each
`destroyed` branch.

## Unable to test

- Templates and CSS (`bulk-panel.html`, `.css`, `collection-view.html`) are not instrumented by the v8
  provider. The component specs (disabled states, titles, status text) and the e2e test exercise their
  behavior. I did not check the visual layout. The e2e writes screenshots to
  `test-results/screenshots/`, and I did not review them.
- The backend `docs.previewMany`/`updateMany`/`deleteMany` (`expectedCount` refusal) are outside this
  task's changed files. Only the e2e here covers them.
- The e2e does not exercise the CR-1 behavior (a long-running write in Electron that the user tries to
  close). The unit specs cover it with held fake responses. A real-time e2e would need a slow write on
  the fixture, which is not deterministic. No follow-up is needed.

## Summary

Tests and task-scoped coverage are sufficient; no production defects were found. Round 2 added 5 tests
for the final write path (`approve` → `request` without a signal, the `writing` output, the toolbar lock
and its read-only reset). All of them pass, along with the collection specs (222), the bulk e2e (2,
against the MongoDB container fixture) and `npm run check` / `.taskcheck`. TW-1 is resolved.

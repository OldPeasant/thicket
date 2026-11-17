# Test Report

Date: 2026-11-17

Task: bulk-ops-ui - M3: Bulk update and delete from the query bar

Scope: `git diff dedda46bd91a53436def437df17145b5482d4509..855df5a8ea526ea063c11c9de4ddb55becff3c1c -- . ':!tasks'`
(task commits a295f33, 855df5a on branch `main`, base and commits supplied by the parent worker),
plus the uncommitted test changes listed below.

Requirements:
- `tasks/bulk-ops-ui.md` acceptance criteria and its two recorded assumptions (type-to-confirm also
  for updates over 1 000; applied filter + collation only, a write only for a preview of the current
  mode/update/query)
- `docs/ARCHITECTURE.md` "Bulk update/delete", "Coverage", "Conventions"
- `AGENTS.md`, parent worker instructions

## Test files changed

- `packages/renderer/src/app/collection/bulk/bulk.util.spec.ts` (new)
- `packages/renderer/src/app/collection/bulk/bulk-panel.spec.ts` (17 tests added)
- `packages/renderer/src/app/collection/collection-view.spec.ts` (4 tests added)
- `test/e2e/bulk.e2e.ts` (lint fix only: the regex on line 129 contained a literal U+202F character,
  which ESLint `no-irregular-whitespace` rejects and which failed `npm run check`. It is now written
  as `/ /g`. The behavior and assertions are unchanged.)

## Tests added or updated

Count: 49 (28 in `bulk.util.spec.ts` incl. `it.each` cases, 17 in `bulk-panel.spec.ts`, 4 in
`collection-view.spec.ts`), plus the one-line lint fix in `test/e2e/bulk.e2e.ts`.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: e2e, updateMany on 1 500 docs requires typing the collection name and updates them | `bulk.e2e.ts` "updateMany on 1 500 documents needs the collection name typed; preview count = result" | `npm run test:e2e -- test/e2e/bulk.e2e.ts` (Electron + Playwright, MongoDB container fixture) | Pass (2 passed) |
| AC2: Preview shows the same count the execution reports | e2e both tests (update 1 500, delete 120); `BulkPanel` "the preview shows the same count the execution reports (update)", "delete at or below 1 000 ...", "asks for the typed name at 1 001 documents, also for a delete", "an update of exactly 1 000 documents needs no typed name" | e2e command above; `cd packages/renderer && npx ng test --include='src/app/collection/**/*.spec.ts' --watch=false` | Pass |
| Type-to-confirm only above 1 000 (boundary 1000 / 1001), for updates and deletes (assumption) | `needsTypedName` boundary test; `BulkPanel` 1 001 delete, 1 000 update, 1 500 update | renderer command above | Pass |
| Update parsed in shell syntax: operators or pipeline; replacement, empty, scalar, malformed refused | `parseUpdate` suite (12 cases incl. `it.each`); `BulkPanel` "an update with a plain field is refused", "pressing Preview with an empty update shows why nothing is sent", pipeline test | renderer command above | Pass |
| Command line shown (`db.coll.updateMany(filter, update, { collation })`), non-identifier names quoted | `describeBulk` suite (11 cases) | renderer command above | Pass |
| Collation passed through to preview and write; no collation key when absent | "sends the filter, the collation and the sample size ...", "sends no collation key when the query has none" | renderer command above | Pass |
| Preview error / retry; loading ends | "a failed preview shows the error, ends the spinner and can be retried" | renderer command above | Pass |
| Cancel of a running preview, late answer ignored; close/destroy cancel | "cancels a running preview ...", "closing the panel during a preview ...", "destroying the panel cancels a running preview" | renderer command above | Pass |
| Stale preview: changed update, filter (also while the preview runs), mode | "cannot run before a preview ...", "a changed filter ...", "a filter applied while the preview runs ...", "switching the mode ..." | renderer command above | Pass |
| Zero matches: nothing to run | "zero matches (update/delete)" | renderer command above | Pass |
| Write errors: CONFLICT (more matches), other error keeps preview, cancel sends nothing, read-only refused | existing CONFLICT and cancel tests; "a failed write shows the error ..."; "a read-only profile refuses the write ..." | renderer command above | Pass |
| CollectionView wiring: button opens/closes the panel on the applied query, close button, read-only hides button and closes panel, page re-read after a bulk write | 4 `CollectionView` tests ("opens the bulk panel on the applied query ...", "the bulk panel close button closes it", "does not offer bulk update/delete on a read-only profile ...", "a bulk delete reads the shown page again") | renderer command above | Pass |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/app/collection/**/*.spec.ts' --watch=false`

Result:

Pass: 5 files, 211 tests (the bulk specs alone: 2 files, 52 tests).

`npm run test:e2e -- test/e2e/bulk.e2e.ts`: Pass, 2 tests (re-run after the lint fix).

## Full test execution

Command:

`npm run check` (= `.taskcheck`: lint, then typecheck, then test). Lint failed, so the other two
steps were run on their own: `npx eslint . --max-warnings 0`, `npm run typecheck`, `npm run test`.

Result:

- `npx eslint . --max-warnings 0`: Pass (after the e2e test fix)
- `npm run typecheck`: Pass
- `npm run test`: Pass (73 files / 4 038 tests and 91 files / 2 923 tests)
- `prettier --check .`: **Fail**. See TW-1.

## .taskcheck

Result:

Fail: `prettier --check .` reports `packages/renderer/src/app/collection/bulk/bulk-panel.html` and
`packages/renderer/src/app/collection/bulk/bulk-panel.ts` (production files, not changed by me).
All test files pass `prettier --check`.

## Bugs found

### Production files of the task fail the Prettier check (`.taskcheck` fails)

Finding ID:

`TW-1`

Test:

`npm run check` (the `prettier --check .` step of `npm run lint`)

Production source:

`packages/renderer/src/app/collection/bulk/bulk-panel.ts`, `packages/renderer/src/app/collection/bulk/bulk-panel.html`

Requirement:

`.taskcheck` must pass before `tasks.py done` (AGENTS.md). Prettier formatting is a project convention (docs/ARCHITECTURE.md "Conventions").

Expected behavior:

`prettier --check .` passes.

Actual behavior:

`[warn] Code style issues found in 2 files` for the two files above, so `npm run check` exits non-zero at lint.

Severity:

Medium (blocks `done`; no runtime effect)

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.` (`npx prettier --write` on the two files.)

No functional production defects were found: every new behavioral test passes.

Low-severity observation (no requirement, no test added): while the preview is stale the status
reads "The preview showed N documents for different settings". With N = 1 it says "1 documents".
The other messages use singular and plural correctly.

## Coverage

Status: verified. Final run on the final test files (after the test additions, Prettier formatting
and the e2e fix). Production code was not changed.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: `bulk.util.ts` and `bulk-panel.ts` are new files, so their changed-line coverage
equals the whole-file numbers. In `collection-view.ts`, every statement that starts on a line added by
the task (167 `ioPanel` signal, 562 `toggleIo`, 572 `bulkChanged`) was executed: 3/3. Method:
statement start lines in `coverage-final.json` intersected with `git diff -U0 dedda46..855df5a` added
lines. This is statement-level; the provider's per-line changed-line coverage was not measured.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `bulk-ops-ui`;
  base `dedda46bd91a53436def437df17145b5482d4509`; HEAD `855df5a8ea526ea063c11c9de4ddb55becff3c1c`;
  task commits a295f33, 855df5a (from the parent worker, confirmed with `git log`/`git diff --stat`).
- Source/test snapshot identifier (including uncommitted inputs), sha256: bulk-panel.ts `187994fd…`,
  bulk-panel.html `da0edd49…`, bulk.util.ts `6b407ad8…`, index.ts `aea65f32…`, collection-view.ts
  `9b9d9c34…`, collection-view.html `86f5dc31…`, bulk-panel.spec.ts `33cb03db…`, bulk.util.spec.ts
  `d82799a0…`, collection-view.spec.ts `a5d388f9…`, test/e2e/bulk.e2e.ts `272414ff…`. Taken before
  and after the final run; identical.
- Exact included files: `src/app/collection/bulk/bulk.util.ts`, `src/app/collection/bulk/bulk-panel.ts`,
  `src/app/collection/bulk/index.ts` (re-exports only; 0 executable statements, so N/A),
  `src/app/collection/collection-view.ts`. Excluded: `bulk-panel.html`/`.css` and
  `collection-view.html` (templates and styles, not instrumented by v8; template behavior is covered by
  the component specs), `test/e2e/bulk.e2e.ts` (test), `docs/ARCHITECTURE.md` (docs). No renames or
  deletions.
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8` 5.1.0
  (Vitest 5.1.0 via `ng test`); `npx ng test --include='src/app/collection/**/*.spec.ts' --watch=false
  --coverage --coverage-include='src/app/collection/bulk/bulk.util.ts'
  --coverage-include='src/app/collection/bulk/bulk-panel.ts'
  --coverage-include='src/app/collection/bulk/index.ts'
  --coverage-include='src/app/collection/collection-view.ts' --coverage-reporters=text-summary
  --coverage-reporters=json-summary --coverage-reporters=json` in `packages/renderer`.
- Run start/completion time and exit status: 2026-11-17T04:02:59Z to 04:03:13Z; exit 0; 211 tests passed.
- Generated report paths and report hashes/run identifier:
  `packages/renderer/coverage/renderer/coverage-summary.json` (sha256 `4d53117b…`) and
  `coverage-final.json` (sha256 `f22fef07…`), both written 05:03:13 +0100 by this run.
- Evidence outputs are fresh and inputs stayed unchanged: yes (mtimes from this run; snapshot hashes
  match before and after).
- Final run after latest test additions and production fixes: yes (TW-1 is not fixed yet. Fixing it
  only reformats code, but the parent should re-run if the fixer changes anything else.)

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/collection/bulk/bulk.util.ts` | 29/29 (100%) | 25/26 (96.2%) | 5/5 (100%) | 23/23 (100%) |
| `packages/renderer/src/app/collection/bulk/bulk-panel.ts` | 126/130 (96.9%) | 68/73 (93.2%) | 28/28 (100%) | 114/114 (100%) |
| `packages/renderer/src/app/collection/bulk/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/renderer/src/app/collection/collection-view.ts` (whole file, mostly pre-existing code) | 222/252 (88.1%) | 116/153 (75.8%) | 67/73 (91.8%) | 193/210 (91.9%) |
| **Aggregate (summed counters, 4 files)** | 377/411 (91.7%) | 209/252 (82.9%) | 100/106 (94.3%) | 330/347 (95.1%) |

The aggregate excludes the template and CSS files listed above. No scoped file is missing from the
report.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `bulk.util.ts:40` (`String(error)` for a non-`Error` throw) | Defensive: `parseShellSyntax` throws `ShellSyntaxError` | Justified gap |
| `bulk-panel.ts:114` (`matchedText` with no preview at all) | Value never shown without a preview | Justified gap |
| `bulk-panel.ts:135` (`setMode` while busy) | Defensive; mode buttons are disabled while busy (tested: disabled during preview) | Justified gap |
| `bulk-panel.ts:183` (`execute` guard without a current preview) | Defensive; Execute is disabled (tested) | Justified gap |
| `bulk-panel.ts:198` (`update === null` in update mode) | Unreachable: the preview key includes the update | Justified gap |
| `bulk-panel.ts:264` (`end()` for a superseded controller) | Only when a second operation starts during the first; the UI disables that | Justified gap |
| `collection-view.ts` 212, 299-304, 408, 428, 437-448, 466-467, 471, 136, 308 | Pre-existing code, not changed by this task | Out of task scope |

## Unable to test

- Templates and CSS (`bulk-panel.html`, `.css`, `collection-view.html`) are not instrumented by the v8
  provider. Their behavior is exercised through the component specs and the e2e test. Visual layout
  was not checked by me: the e2e writes screenshots to `test-results/screenshots/` (`bulk-preview.png`,
  `bulk-confirm.png`, `bulk-delete.png`), which I did not review. No follow-up needed unless the
  reviewer wants a visual check.
- Backend `docs.previewMany`/`updateMany`/`deleteMany` (`expectedCount` refusal) are outside this
  task's changed files; they are covered only end to end through the e2e here.

## Summary

Tests added; production defects were discovered and must be passed to the `fixer` before task
completion. The only defect is TW-1 (Prettier formatting of `bulk-panel.ts` and `bulk-panel.html`),
which makes `.taskcheck` fail. No functional defects were found, and both acceptance criteria pass:
the e2e ran against the container fixture and the unit tests ran.

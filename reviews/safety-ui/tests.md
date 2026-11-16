# Test Report

Date: 2026-11-16

Task: safety-ui (M1: Safety UI: production accent, read-only state, confirm dialog service)

Scope: `2524a5ced5e53202286ca7221f0ad8d72d3c6132..adb7096a134954e92809fac066ff262a1e989a12` on `main`
(task commits 28ef314 "WriteGuard, confirm dialog, read-only control, production accent" and adb7096
"dev page, e2e screenshots in four themes, architecture notes"), plus the uncommitted test files listed
below. Base and commit list supplied by the parent worker and matched against `git log 2524a5c..HEAD`.

Requirements:
- `tasks/safety-ui.md` acceptance criteria and recorded assumptions (type-to-confirm for
  `docs.deleteMany` > 1000 via `count`/`expectedCount`; `CANCELLED` / `READ_ONLY` rejections;
  opt-in `typeToConfirm` for other destructive writes)
- SPEC.md M1 "Safety" (as quoted in the production doc comments), docs/ARCHITECTURE.md "Coverage"
- Parent instructions (confirm dialog, WriteGuard with FakeThicketBridge, read-only refusal,
  WriteControl, describeWrite shell formatting, production accent classes)

## Test files changed

- `packages/renderer/src/app/safety/confirm.service.spec.ts` (new)
- `packages/renderer/src/app/safety/confirm-dialog.spec.ts`
- `packages/renderer/src/app/safety/write-guard.service.spec.ts`
- `packages/renderer/src/app/safety/operation.spec.ts`
- `packages/renderer/src/app/safety/write-control.directive.spec.ts`

No existing test was changed, weakened or skipped; all additions are new `it` blocks (and one new file).
No production code was modified.

## Tests added or updated

Count: 40 (safety + layout selection: 177 -> 217 tests)

- ConfirmService (6): no request shown initially; `answer()` with nothing pending is a no-op; queue shows
  one request at a time and answers each separately; `answer(true)` accepted only with the exact typed
  text (case-sensitive); typed text does not carry over to the next queued request; cancel with the
  name typed still resolves false.
- ConfirmDialog (10): namespace without connection; no target/detail/name field when absent;
  `destructive` class; production focuses Cancel; Escape in the name field aborts even when the name
  matches; Enter outside the name field does not confirm; `aria-invalid` false while empty and when
  matching; operation and type-to-confirm text rendered verbatim (no HTML interpretation); focus is not
  returned to an element removed while the dialog was open; Tab between inner controls is not trapped.
- WriteGuard with `FakeThicketBridge` (16): `count` 1 001 (boundary just above 1000) requires the name
  and `count` wins over `expectedCount`, `answer(true)` without the name sends nothing; deleteMany with
  no known count has no name field/detail; updateMany over 1000 has no name field and is not
  destructive; cancelling a type-to-confirm delete on production sends nothing (dialog shows production
  flag and "Affects 12 431 documents." with narrow no-break space); `coll.drop` opt-in `typeToConfirm`
  sends `confirmed: true`; `db.drop` namespace is the database, `detail`/`destructive` overrides;
  singular "Affects 1 document."; unknown profile is not production (sent without `confirmed`); bulk
  write on unknown profile has no connection; read-only wins over `alwaysConfirm` and bulk writes
  (`run` and `approve`); caller `confirmed: false` is stripped; pre-aborted signal opens no dialog and
  sends nothing; two production writes queue and only the confirmed one is sent; backend error after
  confirming reaches the caller (request carried `confirmed: true`); `needsConfirmation` matrix;
  `admin.killOp` has no namespace.
- describeWrite / shell (6): optional arguments only when present (createCollection options,
  renameCollection without dropTarget, createIndex options, hideIndex, deleteMany collation,
  updateMany without collation, insertMany ordered default, io.import without options); full collMod
  command with a validator; deleteOne filter with expected values; db/collection names escaped as
  string literals (quote, backslash, newline); ISODate printing; default indent and invalid EJSON passthrough.
- WriteControl (2): re-enables and drops hint/`data-readonly` when read-only is cleared or the profile is
  removed; production alone does not disable.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: confirm shows operation text | `ConfirmDialog` "shows the exact operation text, the title, connection and detail", "shows type-to-confirm text verbatim", "shows the namespace without a connection"; `describeWrite` suite; `WriteGuard` "production: nothing is sent before the dialog..." | `cd packages/renderer && npx ng test --include='src/app/safety/**/*.spec.ts' --include='src/app/layout/**/*.spec.ts'` | Pass |
| AC1: cancel aborts | `ConfirmDialog` "cancel aborts", "Escape aborts", "Escape in the name field aborts even with the name typed"; `ConfirmService` "cancelling a type-to-confirm request resolves false"; `WriteGuard` "production: cancel sends nothing...", "cancelling a type-to-confirm delete sends nothing" | same | Pass |
| AC1: type-to-confirm enforced above threshold | `ConfirmDialog` "enforces type-to-confirm", "Enter in the name field confirms only when it matches", "the service refuses answer(true) without the typed name"; `ConfirmService` type-to-confirm tests; `WriteGuard` "deleteMany over 1 000 ...", "exactly 1 000 ...", "1 001 documents (count option)...", "without a known count", "updateMany over 1 000 ..." | same | Pass |
| AC2: `confirmed: true` only after the dialog (fake API) | `WriteGuard` "production: nothing is sent before the dialog", "a caller cannot pre-set confirmed: true", "a caller-supplied confirmed: false is not sent", "bulk writes ask on every profile", "an abort while the dialog is open", "an already aborted signal", "two production writes are confirmed one after the other", "a backend error after confirming", "other destructive writes can opt in" | same | Pass |
| Read-only refusal / read-only signal | `WriteGuard` "read-only profiles are refused with READ_ONLY", "read-only wins over alwaysConfirm and bulk writes", "flag changes take effect"; `WriteControl` suite (4 tests) | same | Pass |
| Production accent classes (shell, status bar, tabs) | `AppShell` "shows the production accent while the active view is production", "hosts the confirm dialog"; `StatusBar` "tints the bar for production and marks read-only connections"; existing tab-bar production test | same | Pass |
| AC3: accent visible in all four theme combinations | `test/e2e/safety.e2e.ts` (4 tests: business/tron x light/dark); screenshots inspected (tron-dark: red sidebar edge, red tab top, red status bar band, production dialog) | `npm run test:e2e -- safety` (builds renderer + desktop, Playwright Electron) | Pass (4 passed). Screenshots went to git-ignored `test-results/screenshots`; the committed copies in `reviews/safety-ui/screenshots/` were not regenerated or modified by this run |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/app/safety/**/*.spec.ts' --include='src/app/layout/**/*.spec.ts'`

Result:

Pass: 12 files, 217 tests (before additions: 11 files, 177 tests, also passing).

## Full test execution

Command:

`npm run check` (eslint, prettier --check, tsc / ngc type checks for all workspaces, root vitest, renderer `ng test`)

Result:

Pass: root vitest 42 files / 2551 tests, renderer 44 files / 811 tests; lint, Prettier and type checks clean.

Also: `npm run test:e2e -- safety` -> 4 passed (17.3 s).

## .taskcheck

Result:

Pass (`.taskcheck` runs `npm run check`, see above).

## Bugs found

None. No test exposed a production defect.

## Coverage

Status: verified (whole-file, task-scoped; renderer workspace).

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured (the configured Angular/Vitest tooling has no changed-line report;
no tooling was added).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `safety-ui`; base
  `2524a5ced5e53202286ca7221f0ad8d72d3c6132`; HEAD `adb7096a134954e92809fac066ff262a1e989a12`; task
  commits 28ef314, adb7096 (from parent, confirmed with `git log 2524a5c..HEAD` / `git diff --stat`).
- Source/test snapshot identifier (including uncommitted inputs): HEAD adb7096 + uncommitted spec files;
  `cat packages/renderer/src/app/safety/*.spec.ts | sha256sum` =
  `f8f67c453d0220cb38109fe9d9ee19b4394f963db90d543b9de32e69fa3c4169` (same before the final coverage
  run and before `npm run check`); `git diff HEAD -- packages | sha256sum` =
  `445253c1e6d2fb5acdccaadd082ccfe740bb9569895f9b079ff8b5a251d177e5`. No production file differs from HEAD.
- Exact included files: `src/app/safety/{confirm-dialog,confirm.service,operation,profile-safety.service,safety.types,write-control.directive,write-guard.service,index}.ts`,
  `src/app/layout/app-shell.ts`, `src/app/layout/status-bar.ts`, `src/app/dev/safety-demo.ts`,
  `src/app/app.routes.ts` (paths relative to `packages/renderer`). Excluded: `confirm-dialog.css`,
  `app-shell.css` (styles, no executable code; verified through e2e screenshots),
  `packages/core/package.json` (export map only; exercised by every test importing
  `@thicket/core/shellsyntax`), `test/e2e/safety.e2e.ts` (test), `docs/ARCHITECTURE.md`, screenshots.
  No renamed or deleted files.
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8` 5.1.0 via
  `@angular/build:unit-test` 22.2.7 (vitest 5.1.0); in `packages/renderer`:
  `npx ng test --include='src/app/safety/**/*.spec.ts' --include='src/app/layout/**/*.spec.ts' --coverage --coverage-reporters=text --coverage-reporters=json-summary --coverage-reporters=json --coverage-include='src/app/safety/*.ts' --coverage-include='src/app/layout/app-shell.ts' --coverage-include='src/app/layout/status-bar.ts' --coverage-include='src/app/dev/safety-demo.ts' --coverage-include='src/app/app.routes.ts'`
- Run start/completion time and exit status: started 2026-11-16 21:51:50 +0100, reports written
  21:51:53 +0100; 12 files / 217 tests passed, no error.
- Generated report paths and report hashes/run identifier: `packages/renderer/coverage/renderer/coverage-summary.json`
  (sha256 `419524678dc50a9c3cb3a25dca575e413eb971b91577befdde66a20bdf12c013`),
  `packages/renderer/coverage/renderer/coverage-final.json`
  (sha256 `51516540d1ae7ac2937d2c0ca4dcd9fe557d9be92ece7be0819d09c10b6802ad`); git-ignored.
- Evidence outputs are fresh and inputs stayed unchanged: report mtimes are within the run; the provider
  rewrote the directory (it only held the two files of this run's reporters); spec hash identical before
  and after.
- Final run after latest test additions and production fixes: yes for the test additions; no production
  fixes were made. Any later production change makes these numbers stale.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `src/app/safety/confirm-dialog.ts` | 121/122 (99.2%) | 60/62 (96.8%) | 15/15 (100%) | 93/93 (100%) |
| `src/app/safety/confirm.service.ts` | 21/21 (100%) | 14/14 (100%) | 4/4 (100%) | 16/16 (100%) |
| `src/app/safety/operation.ts` | 56/57 (98.2%) | 49/51 (96.1%) | 8/8 (100%) | 48/49 (98.0%) |
| `src/app/safety/profile-safety.service.ts` | 28/28 (100%) | 17/17 (100%) | 9/9 (100%) | 21/21 (100%) |
| `src/app/safety/safety.types.ts` | 2/2 (100%) | N/A (0/0) | N/A (0/0) | 2/2 (100%) |
| `src/app/safety/write-control.directive.ts` | 14/14 (100%) | 13/13 (100%) | 3/3 (100%) | 8/8 (100%) |
| `src/app/safety/write-guard.service.ts` | 48/48 (100%) | 53/55 (96.4%) | 7/7 (100%) | 37/37 (100%) |
| `src/app/safety/index.ts` | N/A (0/0, re-exports) | N/A | N/A | N/A |
| `src/app/layout/app-shell.ts` (whole file, mostly pre-existing) | 115/116 (99.1%) | 68/68 (100%) | 23/24 (95.8%) | 84/84 (100%) |
| `src/app/layout/status-bar.ts` (whole file, mostly pre-existing) | 52/52 (100%) | 23/24 (95.8%) | 4/4 (100%) | 31/31 (100%) |
| `src/app/dev/safety-demo.ts` | 0/19 (0%) | 0/2 (0%) | 0/4 (0%) | 0/17 (0%) |
| `src/app/app.routes.ts` (whole file) | 1/5 (20%) | N/A (0/0) | 0/4 (0%) | 1/3 (33.3%) |
| **Aggregate (all 12 files above, summed counters)** | 458/484 (94.6%) | 297/306 (97.1%) | 73/82 (89.0%) | 341/361 (94.5%) |
| Safety folder only (8 files) | 290/292 (99.3%) | 206/212 (97.2%) | 46/46 (100%) | 225/226 (99.6%) |

Baseline before the new tests (same command): aggregate 450/484 statements, 278/306 branches, 73/82
functions, 339/361 lines; safety folder branches 187/212 -> now 206/212.
No scoped file was missing from the report. Not in the aggregate: the CSS files and
`packages/core/package.json` (excluded above).

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `src/app/dev/safety-demo.ts:9-66` | Development page for the screenshots (`#/dev/safety`), not product behavior | Exercised by `test/e2e/safety.e2e.ts` (4 passed); unit test not added (dev-only code, e2e is the meaningful check) |
| `src/app/app.routes.ts:17-28` (lazy `loadComponent` callbacks) | Route `dev/safety` loads the demo | Covered by the e2e run that navigates to `#/dev/safety`; the other callbacks are pre-existing routes |
| `src/app/safety/operation.ts:134` (`default` case) | Fallback for a write method without a formatter | Unreachable for the typed `WriteMethodName` union (all methods have a case); justified gap |
| `src/app/safety/operation.ts` 1 more branch (`docs[0] ?? '{}'`) | Defensive fallback when `docs` is empty in the single-insert path | Unreachable (`length === 1` guarantees `docs[0]`); justified gap |
| `src/app/safety/confirm-dialog.ts:142` (`activeElement instanceof HTMLElement` false) | Focus restore when nothing focusable was active (e.g. SVG element) | Low risk; not added |
| `src/app/safety/confirm-dialog.ts:192` (`!first \|\| !last` return in Tab trap) | Defensive: Cancel is always enabled, so the list is never empty | Unreachable in the current template; justified gap |
| `src/app/safety/write-guard.service.ts:115` (`?? 'This connection'`) | READ_ONLY message for a read-only profile with no name | Unreachable: read-only is only true for a registered profile, which has a name |
| `src/app/safety/write-guard.service.ts:147` (`TITLES[method] ?? method`) | Title fallback for a write method without a title | Every current write method has a title; justified gap |
| `src/app/layout/app-shell.ts:114` (anonymous function, pre-existing) and `status-bar.ts:171` (`conn ? ... : ''`, pre-existing) | Pre-existing code outside this task's change | Not in the task's changed lines; left as is |

## Unable to test

- Visual rendering of the accent with the Business/Tron tokens (no hard-coded colors) cannot be asserted
  in jsdom-style component tests; it was checked through the e2e screenshots (run here, 4 passed, one
  screenshot inspected). Comparing the committed `reviews/safety-ui/screenshots/` pixel-for-pixel was not
  done (no snapshot assertions exist in the e2e spec). No follow-up needed for this task.
- WriteGuard is not yet wired into real write UIs or `ProfileSafetyService.set()` into the connection UI
  (connection-ui task, per the recorded assumption); end-to-end behavior with a real production profile is
  therefore not testable in this task.

## Summary

Tests added and all validation passed. 40 new tests (no production defects found); focused safety/layout
specs, `npm run check` (`.taskcheck`) and the safety e2e spec pass. Task-scoped coverage of the safety
folder is 99.3% statements / 97.2% branches / 100% functions / 99.6% lines; remaining gaps are
unreachable defensive branches or dev-only code exercised by e2e.

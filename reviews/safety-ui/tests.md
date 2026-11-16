# Test Report

Date: 2026-11-16

Task: safety-ui (M1: Safety UI: production accent, read-only state, confirm dialog service)

Scope: `0239837314bf174c40a4550fb62ae1629a45bb9a..fdf58691787965e2dac03ec5a937dc58fc39ac0b` on `main`
(base = `git merge-base HEAD origin/main`, supplied by the parent worker). Task commits: 2544986
"WriteGuard, confirm dialog, read-only control, production accent", 40d0392 "dev page, e2e screenshots in
four themes, architecture notes", f158e95 "test-writer tests and report, code review", e894462 "fix review
findings CR-1..CR-6", b1f5b98 "final test-writer tests for the review fixes, reports", fdf5869 "document
confirm(request, signal?) and modal behavior (review CR-2), fix report". Task code = changes under
`packages/`, `test/`, `docs/` in that range. This is the final-revision pass. It replaces the earlier
report, which measured 24cd7c4 (the pre-rebase hash of e894462) plus the then-uncommitted specs that were
later committed in b1f5b98.

Change since the previous run: fdf5869 touches only `docs/ARCHITECTURE.md` (the `confirm(request, signal?)`
and modal-behavior notes) and `reviews/safety-ui/fixes.md`. `git diff 24cd7c4 HEAD -- packages/renderer
packages/core/package.json test/e2e` shows only the four spec files committed in b1f5b98. Their sha256
hashes match the hashes the previous report recorded, so no production code or test changed in between.
The documented behavior (an aborted signal withdraws the request, the rest of the window becomes inert
while a request is shown, tab shortcuts are ignored) is already covered by the tests listed below. No
docs-validation test is needed.

Requirements:
- `tasks/safety-ui.md` acceptance criteria and recorded assumptions (type-to-confirm for
  `docs.deleteMany` > 1000 via `count`/`expectedCount`; `CANCELLED` / `READ_ONLY` rejections;
  opt-in `typeToConfirm` for other destructive writes; dev route `#/dev/safety` for screenshots)
- `reviews/safety-ui/review.md` findings CR-1..CR-6 and `reviews/safety-ui/fixes.md`
- SPEC.md M1 "Safety", docs/ARCHITECTURE.md "Safety UI" notes, "End-to-end tests" and "Coverage"
- Parent instructions for this run

## Test files changed

None in this run. The task's test files (all committed at HEAD) are:

- `packages/renderer/src/app/safety/confirm-dialog.spec.ts`
- `packages/renderer/src/app/safety/confirm.service.spec.ts`
- `packages/renderer/src/app/safety/operation.spec.ts`
- `packages/renderer/src/app/safety/write-control.directive.spec.ts`
- `packages/renderer/src/app/safety/write-guard.service.spec.ts`
- `packages/renderer/src/app/layout/app-shell.spec.ts`
- `packages/renderer/src/app/layout/status-bar.spec.ts`
- `test/e2e/safety.e2e.ts`

No production code was modified, and no test was weakened, skipped or removed.

## Tests added or updated

Count: 0

I checked the acceptance criteria against the existing tests again (see the next section) and found no
real gap. The only change since the last run is documentation, and the behavior it describes is already
tested, so no tests were added.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: confirm shows operation text | `ConfirmDialog` "shows the exact operation text, the title, connection and detail", "shows type-to-confirm text verbatim", "the accessible description is the operation text itself (no aria-label on it)"; `describeWrite` suite incl. "prints agg.run options and the agg.createView collation", "agg.run prints given falsy options..."; `WriteGuard` "production: nothing is sent before the dialog; confirmed: true only after confirming" | `cd packages/renderer && npx ng test --include='src/app/safety/**/*.spec.ts' --include='src/app/layout/**/*.spec.ts' --coverage ...` (full command under Coverage) | Pass |
| AC1: cancel aborts | `ConfirmDialog` "cancel aborts", "Escape aborts", "Escape in the name field aborts...", "Escape pressed with focus on <body> cancels", "a backdrop click keeps focus in the dialog, so Escape still cancels", "Escape inside the dialog cancels only the shown request, not the next queued one"; `ConfirmService` cancel and withdrawal tests; `WriteGuard` "production: cancel sends nothing and rejects with CANCELLED", "cancelling a type-to-confirm delete sends nothing", "an abort while the dialog is open closes it and sends nothing", "an already aborted signal opens no dialog and sends nothing" | same | Pass |
| AC1: type-to-confirm enforced above threshold | `ConfirmDialog` "enforces type-to-confirm", "Enter in the name field confirms only when it matches", "the service refuses answer(true) without the typed name"; `ConfirmService` type-to-confirm tests incl. "withdrawing the shown request clears the typed name"; `WriteGuard` "deleteMany over 1 000 documents needs the collection name typed", "deleteMany of exactly 1 000 documents does not need the name", "deleteMany of 1 001 documents (count option)...", "deleteMany without a known count does not ask for the name", "updateMany over 1 000 documents does not ask for the name", "other destructive writes can opt in to type-to-confirm" | same | Pass |
| AC2: `confirmed: true` only after the dialog (fake API) | `WriteGuard (with the fake API)` suite using `FakeThicketBridge` / `provideFakeThicket`: "production: nothing is sent before the dialog; confirmed: true only after confirming", "non-production single writes are sent at once, without confirmed", "a caller cannot pre-set confirmed: true to skip the dialog", "a caller-supplied confirmed: false is not sent either", "bulk writes ask on every profile and carry confirmed: true", "alwaysConfirm asks...", "approve() returns the params to send without sending them", "two production writes are confirmed one after the other", "a backend error after confirming reaches the caller", "read-only wins over alwaysConfirm and bulk writes" | same | Pass |
| Dialog is modal and withdrawn on abort (CR-1, CR-3; ARCHITECTURE.md note from fdf5869) | `AppShell` "while the confirm dialog is open, the rest of the window is inert and shortcuts do nothing"; `ConfirmDialog` "modal keyboard handling" tests (8); `ConfirmService` withdrawal tests; `WriteGuard` abort tests | same | Pass |
| Read-only signal / write controls (incl. CR-5 `title`) | `WriteGuard` "read-only profiles are refused with READ_ONLY before anything is sent", "flag changes take effect on the next write"; `WriteControl` suite (7 tests) | same | Pass |
| Production accent classes (shell, status bar, tabs) | `AppShell` "shows the production accent while the active view is production"; `StatusBar` "tints the bar for production and marks read-only connections"; tab-bar production test | same | Pass |
| AC3: accent visible in all four theme combinations | `test/e2e/safety.e2e.ts` "production accent and confirm dialog in {business,tron} {light,dark}" | `npm run test:e2e -- test/e2e/safety.e2e.ts` (builds renderer + desktop, Playwright Electron; `xvfb-run` is not installed, so the harness used `--ozone-platform=headless` as docs/ARCHITECTURE.md describes) | Pass (4 passed, 17.0 s). Screenshots go to the git-ignored `test-results/`. The committed `reviews/safety-ui/screenshots/` are unchanged (git status clean for them) and were not compared pixel by pixel |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/app/safety/**/*.spec.ts' --include='src/app/layout/**/*.spec.ts' --coverage ...` (the same run as the coverage measurement)

Result:

Pass: 12 files, 237 tests.

## Full test execution

Command:

`npm run check` (eslint, prettier --check, tsc / ngc type checks for all workspaces, root vitest, renderer `ng test`)

Result:

Pass: lint and Prettier clean, type checks clean, root vitest 44 files / 2684 tests, renderer 44 files /
831 tests.

Also: `npm run test:e2e -- test/e2e/safety.e2e.ts` -> 4 passed.

## .taskcheck

Result:

Pass. `.taskcheck` runs `npm run check` when `package.json` exists. That is the run above.

## Bugs found

None. No test exposed a production defect.

Note for the parent: `reviews/safety-ui/review.md` shows as modified in the working tree during this run.
This test-writer did not edit it.

## Coverage

Status: verified (whole-file, task-scoped; renderer workspace).

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured. The configured Angular/Vitest tooling has no changed-line report, and
no tooling was added.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `safety-ui`; base
  `0239837314bf174c40a4550fb62ae1629a45bb9a` (`git merge-base HEAD origin/main`); HEAD
  `fdf58691787965e2dac03ec5a937dc58fc39ac0b`; task commits 2544986, 40d0392, f158e95, e894462, b1f5b98,
  fdf5869 (supplied by the parent and checked with `git log --oneline 0239837..HEAD` and
  `git diff --stat 0239837..HEAD`).
- Source/test snapshot identifier (including uncommitted inputs): HEAD fdf5869 with no uncommitted
  source or test changes (`git diff --quiet HEAD -- packages test docs` succeeded after all runs). Spec
  sha256: `confirm-dialog.spec.ts` b97e333a8dfc8ba3bd0bbffbdb820a5654b0d363f3f8df7a19ac221241a4bb15,
  `confirm.service.spec.ts` 496d4b8a3da89c595f6a7a4473a2db7b789d853a49a50199a4905464eb4bfc7e,
  `operation.spec.ts` 9aca1a34b4888f415820b0c6646860fc1509de6b44705169bcd8cd72caf17d9d,
  `write-control.directive.spec.ts` f122ccbf5c8926a41ca103a3431d508ce6e67953d9ef19c5a441451eefbcf287,
  `write-guard.service.spec.ts` 4a7289d5a2dada2eddf74c3c9f06cae3d4ad9bac58fd0f1870d4bb9dee51f981,
  `app-shell.spec.ts` e906014921d193f7ea916f56f58016988cf242dcb8be64e41148a7777d2d806f,
  `status-bar.spec.ts` ae7685a2340487edd30a312750e676895915c5d694213e677dbf2c2fcda8ae67.
- Exact included files (relative to `packages/renderer`): `src/app/safety/{confirm-dialog,confirm.service,operation,profile-safety.service,safety.types,write-control.directive,write-guard.service,index}.ts`,
  `src/app/layout/app-shell.ts`, `src/app/layout/status-bar.ts`, `src/app/dev/safety-demo.ts`,
  `src/app/app.routes.ts`. Excluded: `confirm-dialog.css` and `app-shell.css` (styles with no executable
  code, checked through the e2e run); `packages/core/package.json` (export map only, exercised by every
  test that imports `@thicket/core/shellsyntax`); spec files and `test/e2e/safety.e2e.ts` (tests);
  `docs/ARCHITECTURE.md` and `reviews/` (documentation). No renamed or deleted files.
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8` via
  `@angular/build:unit-test` (vitest 5.1.0), in `packages/renderer`:
  `npx ng test --include='src/app/safety/**/*.spec.ts' --include='src/app/layout/**/*.spec.ts' --coverage --coverage-reporters=text --coverage-reporters=json-summary --coverage-reporters=json --coverage-include='src/app/safety/*.ts' --coverage-include='src/app/layout/app-shell.ts' --coverage-include='src/app/layout/status-bar.ts' --coverage-include='src/app/dev/safety-demo.ts' --coverage-include='src/app/app.routes.ts'`
- Run start/completion time and exit status: build finished 2026-11-16 22:10:38 +0100, tests started at
  22:10:38 and the reports were written at 22:10:41 +0100. Exit 0; 12 files / 237 tests passed.
- Generated report paths and report hashes/run identifier: `packages/renderer/coverage/renderer/coverage-summary.json`
  (sha256 `2d83d664482934f4c47045d40ab16ac4f0ffc52448de31a3113adfa3ee78a950`) and
  `packages/renderer/coverage/renderer/coverage-final.json`
  (sha256 `63b6cc7089b61fc60a9511cab703ef4fe50badc4b513bafe004a3fc62d1502cf`). Both are git-ignored.
- Evidence outputs are fresh and inputs stayed unchanged: both report mtimes are 22:10:41.37 +0100, which
  falls inside this run, and the directory holds only those two files. The hashes match the previous
  run's hashes. That is expected because production code, specs and the command are byte-identical, and
  V8 coverage JSON contains no timestamps. The mtimes, not the hashes, show that this run produced the
  files.
- Final run after latest test additions and production fixes: yes. There have been no production or test
  changes since e894462 / b1f5b98, and this run is on the final revision fdf5869.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `src/app/safety/confirm-dialog.ts` | 141/142 (99.3%) | 80/82 (97.6%) | 21/21 (100%) | 108/108 (100%) |
| `src/app/safety/confirm.service.ts` | 36/37 (97.3%) | 21/22 (95.5%) | 7/7 (100%) | 29/29 (100%) |
| `src/app/safety/operation.ts` | 73/74 (98.6%) | 63/65 (96.9%) | 8/8 (100%) | 60/61 (98.4%) |
| `src/app/safety/profile-safety.service.ts` | 28/28 (100%) | 17/17 (100%) | 9/9 (100%) | 21/21 (100%) |
| `src/app/safety/safety.types.ts` | 2/2 (100%) | N/A (0/0) | N/A (0/0) | 2/2 (100%) |
| `src/app/safety/write-control.directive.ts` | 15/15 (100%) | 15/15 (100%) | 3/3 (100%) | 9/9 (100%) |
| `src/app/safety/write-guard.service.ts` | 48/48 (100%) | 53/55 (96.4%) | 7/7 (100%) | 37/37 (100%) |
| `src/app/safety/index.ts` | N/A (0/0, re-exports) | N/A | N/A | N/A |
| `src/app/layout/app-shell.ts` (whole file, partly pre-existing) | 125/126 (99.2%) | 74/74 (100%) | 24/25 (96.0%) | 88/88 (100%) |
| `src/app/layout/status-bar.ts` (whole file, partly pre-existing) | 52/52 (100%) | 23/24 (95.8%) | 4/4 (100%) | 31/31 (100%) |
| `src/app/dev/safety-demo.ts` | 0/19 (0%) | 0/2 (0%) | 0/4 (0%) | 0/17 (0%) |
| `src/app/app.routes.ts` (whole file) | 1/5 (20%) | N/A (0/0) | 0/4 (0%) | 1/3 (33.3%) |
| **Aggregate (all 12 files above, summed counters)** | 521/548 (95.1%) | 346/356 (97.2%) | 83/92 (90.2%) | 386/406 (95.1%) |
| Safety folder only (8 files) | 343/346 (99.1%) | 249/256 (97.3%) | 55/55 (100%) | 266/267 (99.6%) |

The provider's "All files" totals (521/548, 346/356, 83/92, 386/406) match the summed aggregate. Every
scoped file appears in the report. The aggregate leaves out the CSS files and `packages/core/package.json`
(excluded above).

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `src/app/dev/safety-demo.ts:9-66` | Dev page for the screenshots (`#/dev/safety`), not product behavior | Exercised by `test/e2e/safety.e2e.ts` (4 passed in this run); no unit test because it is dev-only code |
| `src/app/app.routes.ts:17-28` (lazy `loadComponent` callbacks) | Route `dev/safety` loads the demo | Covered by the e2e run, which navigates to `#/dev/safety`; the other callbacks belong to pre-existing routes |
| `src/app/safety/confirm.service.ts:74` (`index < 0` return in `withdraw`) | Abort of a request that is no longer queued | Unreachable: `answer()` detaches the abort listener, and the listener is `once`. The "abort after the answer changes nothing" test covers the observable behavior. Justified gap |
| `src/app/safety/confirm-dialog.ts:150` (`activeElement instanceof HTMLElement` false) | Focus restore when the previously focused element is not an HTMLElement (e.g. SVG) | Low risk; no test added |
| `src/app/safety/confirm-dialog.ts:231` (`!first \|\| !last` return in Tab trap) | Defensive: Cancel is always enabled, so the list is never empty | Unreachable with the current template; justified gap |
| `src/app/safety/operation.ts:150` (switch `default`) | Fallback for a write method without a formatter | Unreachable for the typed `WriteMethodName` union; justified gap |
| `src/app/safety/operation.ts:54` (`docs[0] ?? '{}'`) | Defensive fallback in the single-insert path | Unreachable because `length === 1` guarantees `docs[0]`; justified gap |
| `src/app/safety/write-guard.service.ts:115` (`?? 'This connection'`) | READ_ONLY message for a read-only profile without a name | Unreachable: read-only is only true for a registered profile, and a registered profile has a name |
| `src/app/safety/write-guard.service.ts:147` (`TITLES[method] ?? method`) | Title fallback for a method without a title | Every current write method has a title; justified gap |
| `src/app/layout/app-shell.ts` (one function: `viewChild.required` internal) and `status-bar.ts:171` (`conn ? ... : ''` false arm) | Pre-existing code outside this task's change | Left as is |

## Unable to test

- The jsdom component tests cannot check how the accent renders with the Business/Tron tokens (no
  hard-coded colors). The e2e run covers it (4 passed). The committed screenshots in
  `reviews/safety-ui/screenshots/` were not compared pixel by pixel because the e2e spec has no snapshot
  assertions. No follow-up needed for this task.
- This run used Electron's headless Ozone platform because `xvfb-run` is not installed. The screenshots
  render, but they come from the headless platform, not an X display.
- jsdom does not implement `inert`, so the AppShell unit test only checks the attribute, not real browser
  pointer and focus blocking. The e2e spec does not use the keyboard behind the open dialog. Low risk;
  optional follow-up in a later e2e task.
- WriteGuard is not yet wired into real write UIs, and `ProfileSafetyService.set()` is not yet wired into
  the connection UI (connection-ui task, per the recorded assumption). End-to-end behavior with a real
  production profile can't be tested in this task.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. The final revision fdf5869
only changes documentation (no production or test changes since the previous run), and no new tests were
needed. Results: focused safety/layout specs (237) pass, `npm run check` / `.taskcheck` pass (root 2684,
renderer 831), and the safety e2e spec passes in all four theme combinations (4). Fresh task-scoped
coverage of the safety folder is 99.1% statements, 97.3% branches, 100% functions and 99.6% lines. The
remaining gaps are unreachable defensive branches, pre-existing code, or dev-only code that the e2e run
covers.

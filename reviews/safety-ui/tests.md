# Test Report

Date: 2026-11-16

Task: safety-ui (M1: Safety UI: production accent, read-only state, confirm dialog service)

Scope: `95e744c3e2dacf3953e50db9852e363213a1ab56..24cd7c440cebf708e410319fdbb0d7be287b5520` on `main`
(base = `git merge-base HEAD origin/main`, supplied by the parent worker). Task commits: ecfa408
"WriteGuard, confirm dialog, read-only control, production accent", 971aea8 "dev page, e2e screenshots in
four themes, architecture notes", 9f22957 "test-writer tests and report, code review", 24cd7c4 "fix review
findings CR-1..CR-6". Task code = changes under `packages/`, `test/`, `docs/` in that range, plus the
uncommitted test files listed below. This is the final-revision run after the CR-1..CR-6 fixes; it
supersedes the earlier report (which measured the pre-fix revision).

Requirements:
- `tasks/safety-ui.md` acceptance criteria and recorded assumptions (type-to-confirm for
  `docs.deleteMany` > 1000 via `count`/`expectedCount`; `CANCELLED` / `READ_ONLY` rejections;
  opt-in `typeToConfirm` for other destructive writes; dev route `#/dev/safety` for screenshots)
- `reviews/safety-ui/review.md` findings CR-1..CR-6 and the behavior `reviews/safety-ui/fixes.md` says was
  implemented (modal dialog, signal withdrawal, agg options, WriteControl `title`)
- SPEC.md M1 "Safety", docs/ARCHITECTURE.md "Coverage"
- Parent instructions for this run

## Test files changed

- `packages/renderer/src/app/safety/confirm-dialog.spec.ts`
- `packages/renderer/src/app/safety/confirm.service.spec.ts`
- `packages/renderer/src/app/safety/operation.spec.ts`
- `packages/renderer/src/app/safety/write-control.directive.spec.ts`

All changes are additions (new `it` blocks and one new `describe` block). No existing test was changed,
weakened or skipped. No production code was modified.

## Tests added or updated

Count: 14 (safety + layout selection: 223 -> 237 tests; renderer suite 817 -> 831)

Discrepancy found while checking the fixes: `fixes.md` (CR-1, CR-2) says the dialog tests "cover backdrop
click plus Escape, backdrop refocus, Tab from outside, no handling with no request shown, and Ctrl+Tab not
trapped" and that "a test checks that the described element's text is the operation", but commit 24cd7c4
does not touch `confirm-dialog.spec.ts` and none of these tests existed at HEAD. Only the AppShell-level
CR-1 test (inert background, shortcuts ignored) was present. The tests below close that gap; the
production behavior they check was correct.

- ConfirmDialog (9), CR-1/CR-2:
  - `the accessible description is the operation text itself (no aria-label on it)` (CR-2)
  - `a backdrop click keeps focus in the dialog, so Escape still cancels` (mousedown default prevented,
    focus moves from `<body>` to the dialog)
  - `a backdrop click leaves focus on the control inside the dialog`
  - `Escape pressed with focus on <body> cancels`
  - `Tab pressed with focus on <body> moves focus into the dialog`
  - `other keys and Ctrl+Tab on <body> are left alone`
  - `with no dialog shown, document keys are not handled`
  - `Ctrl/Meta/Alt+Tab on the last control is not trapped`
  - `Escape inside the dialog cancels only the shown request, not the next queued one` (regression guard:
    the in-dialog and document Escape handlers must not both answer)
- ConfirmService (3), CR-3: withdrawing the shown request clears the typed name (a following
  type-to-confirm request with the same name is not auto-accepted); withdrawing a waiting request keeps
  the name typed into the shown one; withdrawing the last request closes the dialog.
- describeWrite (1), CR-4: `agg.run` prints given falsy options (`allowDiskUse: false`, `maxTimeMS: 0`)
  and no options object when none are given; `agg.createView` without collation has three arguments.
- WriteControl (1), CR-5: an empty bound `title` leaves no `title` attribute while writable; read-only
  still shows the hint and disables.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: confirm shows operation text | `ConfirmDialog` "shows the exact operation text, the title, connection and detail", "shows type-to-confirm text verbatim", "the accessible description is the operation text itself"; `describeWrite` suite incl. "prints agg.run options and the agg.createView collation", "agg.run prints falsy options..."; `WriteGuard` "production: nothing is sent before the dialog..." | `cd packages/renderer && npx ng test --include='src/app/safety/**/*.spec.ts' --include='src/app/layout/**/*.spec.ts'` | Pass |
| AC1: cancel aborts | `ConfirmDialog` "cancel aborts", "Escape aborts", "Escape in the name field aborts...", "Escape pressed with focus on <body> cancels", "a backdrop click keeps focus in the dialog, so Escape still cancels", "Escape inside the dialog cancels only the shown request"; `ConfirmService` cancel + withdrawal tests; `WriteGuard` "production: cancel sends nothing", "an abort while the dialog is open closes it and sends nothing" | same | Pass |
| AC1: type-to-confirm enforced above threshold | `ConfirmDialog` "enforces type-to-confirm", "Enter in the name field confirms only when it matches", "the service refuses answer(true) without the typed name"; `ConfirmService` type-to-confirm tests incl. "withdrawing the shown request clears the typed name"; `WriteGuard` "deleteMany over 1 000", "exactly 1 000", "1 001 documents", "without a known count", "updateMany over 1 000" | same | Pass |
| AC2: `confirmed: true` only after the dialog (fake API) | `WriteGuard` (with `FakeThicketBridge`) "production: nothing is sent before the dialog", "a caller cannot pre-set confirmed: true", "a caller-supplied confirmed: false is not sent", "bulk writes ask on every profile", "an abort while the dialog is open closes it and sends nothing", "an already aborted signal", "two production writes are confirmed one after the other", "a backend error after confirming", "other destructive writes can opt in" | same | Pass |
| Dialog is modal (CR-1): background inert, tab shortcuts ignored, focus kept | `AppShell` "while the confirm dialog is open, the rest of the window is inert and shortcuts do nothing"; the 8 new `ConfirmDialog` "modal keyboard handling" tests | same | Pass |
| Read-only signal / write controls (incl. CR-5 `title`) | `WriteGuard` read-only tests; `WriteControl` suite (7 tests incl. "keeps the control own title...", "an empty bound title leaves no title attribute...") | same | Pass |
| Production accent classes (shell, status bar, tabs) | `AppShell` "shows the production accent while the active view is production"; `StatusBar` "tints the bar for production and marks read-only connections"; tab-bar production test | same | Pass |
| AC3: accent visible in all four theme combinations | `test/e2e/safety.e2e.ts` (business/tron x light/dark) | `npm run test:e2e -- test/e2e/safety.e2e.ts` (builds renderer + desktop, Playwright Electron) | Pass (4 passed, 18.3 s). Screenshots written to git-ignored `test-results/`; the committed `reviews/safety-ui/screenshots/` were not modified by this run (git status clean for them) and were not compared pixel-by-pixel |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/app/safety/**/*.spec.ts' --include='src/app/layout/**/*.spec.ts'`

Result:

Pass: 12 files, 237 tests (223 at HEAD before the additions).

## Full test execution

Command:

`npm run check` (eslint, prettier --check, tsc / ngc type checks for all workspaces, root vitest, renderer `ng test`)

Result:

Pass: root vitest 42 files / 2551 tests; renderer 44 files / 831 tests; lint, Prettier and type checks clean.

Also: `npm run test:e2e -- test/e2e/safety.e2e.ts` -> 4 passed.

## .taskcheck

Result:

Pass (`sh .taskcheck` -> `npm run check`, same counts as above).

## Bugs found

None. No test exposed a production defect.

Non-code finding for the parent worker: `reviews/safety-ui/fixes.md` claims dialog-level tests for CR-1 and
CR-2 that were not in commit 24cd7c4 (see "Tests added or updated"). They are added now; the parent should
note this when recording the fixer evidence. Separately, `reviews/safety-ui/review.md` shows as modified in
the working tree during this run; this test-writer did not edit it.

## Coverage

Status: verified (whole-file, task-scoped; renderer workspace).

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured (the configured Angular/Vitest tooling has no changed-line report;
no tooling was added).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `safety-ui`; base
  `95e744c3e2dacf3953e50db9852e363213a1ab56` (`git merge-base HEAD origin/main`); HEAD
  `24cd7c440cebf708e410319fdbb0d7be287b5520`; task commits ecfa408, 971aea8, 9f22957, 24cd7c4
  (`git log 95e744c..HEAD`, `git diff --stat 95e744c HEAD`).
- Source/test snapshot identifier (including uncommitted inputs): HEAD 24cd7c4 + four uncommitted spec
  files, sha256: `confirm-dialog.spec.ts` b97e333a8dfc8ba3bd0bbffbdb820a5654b0d363f3f8df7a19ac221241a4bb15,
  `confirm.service.spec.ts` 496d4b8a3da89c595f6a7a4473a2db7b789d853a49a50199a4905464eb4bfc7e,
  `operation.spec.ts` 9aca1a34b4888f415820b0c6646860fc1509de6b44705169bcd8cd72caf17d9d,
  `write-control.directive.spec.ts` f122ccbf5c8926a41ca103a3431d508ce6e67953d9ef19c5a441451eefbcf287
  (identical before and after the coverage run and `npm run check`). `git diff --quiet HEAD` on the
  changed production files: no difference.
- Exact included files (relative to `packages/renderer`): `src/app/safety/{confirm-dialog,confirm.service,operation,profile-safety.service,safety.types,write-control.directive,write-guard.service,index}.ts`,
  `src/app/layout/app-shell.ts`, `src/app/layout/status-bar.ts`, `src/app/dev/safety-demo.ts`,
  `src/app/app.routes.ts`. Excluded: `confirm-dialog.css`, `app-shell.css` (styles, no executable code;
  checked through the e2e screenshots), `packages/core/package.json` (export map only; exercised by every
  test importing `@thicket/core/shellsyntax`), spec files, `test/e2e/safety.e2e.ts` (test),
  `docs/ARCHITECTURE.md`, `reviews/`. No renamed or deleted files.
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8` via
  `@angular/build:unit-test` (vitest 5.1.0), in `packages/renderer`:
  `npx ng test --include='src/app/safety/**/*.spec.ts' --include='src/app/layout/**/*.spec.ts' --coverage --coverage-reporters=text --coverage-reporters=json-summary --coverage-reporters=json --coverage-include='src/app/safety/*.ts' --coverage-include='src/app/layout/app-shell.ts' --coverage-include='src/app/layout/status-bar.ts' --coverage-include='src/app/dev/safety-demo.ts' --coverage-include='src/app/app.routes.ts'`
- Run start/completion time and exit status: started 2026-11-16 22:04:10 +0100, reports written
  22:04:13 +0100; exit 0; 12 files / 237 tests passed.
- Generated report paths and report hashes/run identifier: `packages/renderer/coverage/renderer/coverage-summary.json`
  (sha256 `2d83d664482934f4c47045d40ab16ac4f0ffc52448de31a3113adfa3ee78a950`),
  `packages/renderer/coverage/renderer/coverage-final.json`
  (sha256 `63b6cc7089b61fc60a9511cab703ef4fe50badc4b513bafe004a3fc62d1502cf`); git-ignored.
- Evidence outputs are fresh and inputs stayed unchanged: report mtimes (22:04:13) fall within this run;
  the directory holds only this run's two JSON reports; spec hashes and production files unchanged.
- Final run after latest test additions and production fixes: yes (after the CR-1..CR-6 fixes in 24cd7c4
  and after all tests added in this run). Any later production change makes these numbers stale.

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

Before this run's additions the fix commit already had the covered logic exercised indirectly through
AppShell; the new tests target the CR-1/CR-2 behavior directly. No scoped file was missing from the report.
Not in the aggregate: the CSS files and `packages/core/package.json` (excluded above).

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `src/app/dev/safety-demo.ts:9-66` | Dev page for the screenshots (`#/dev/safety`), not product behavior | Exercised by `test/e2e/safety.e2e.ts` (4 passed in this run); no unit test (dev-only code) |
| `src/app/app.routes.ts:17-28` (lazy `loadComponent` callbacks) | Route `dev/safety` loads the demo | Covered by the e2e run that navigates to `#/dev/safety`; other callbacks are pre-existing routes |
| `src/app/safety/confirm.service.ts:74` (`index < 0` return in `withdraw`) | Abort of a request that is no longer queued | Unreachable: `answer()` detaches the abort listener and the listener is `once`; the "abort after the answer changes nothing" test covers the observable behavior. Justified gap |
| `src/app/safety/confirm-dialog.ts:150` (`activeElement instanceof HTMLElement` false) | Focus restore when the previously focused element is not an HTMLElement (e.g. SVG) | Low risk; not added |
| `src/app/safety/confirm-dialog.ts:231` (`!first \|\| !last` return in Tab trap) | Defensive: Cancel is always enabled, so the list is never empty | Unreachable in the current template; justified gap |
| `src/app/safety/operation.ts:49` switch `default` (line 150) | Fallback for a write method without a formatter | Unreachable for the typed `WriteMethodName` union; justified gap |
| `src/app/safety/operation.ts:54` (`docs[0] ?? '{}'`) | Defensive fallback in the single-insert path | Unreachable (`length === 1` guarantees `docs[0]`); justified gap |
| `src/app/safety/write-guard.service.ts:115` (`?? 'This connection'`) | READ_ONLY message for a nameless read-only profile | Unreachable: read-only is only true for a registered profile, which has a name |
| `src/app/safety/write-guard.service.ts:147` (`TITLES[method] ?? method`) | Title fallback for a method without a title | Every current write method has a title; justified gap |
| `src/app/layout/app-shell.ts:121` (`viewChild.required` internal function) and `status-bar.ts:171` (`conn ? ... : ''` false arm) | Pre-existing code outside this task's change | Left as is |

## Unable to test

- Visual rendering of the accent with the Business/Tron tokens (no hard-coded colors) cannot be asserted in
  the jsdom component tests; it is covered by the e2e run (4 passed). The committed screenshots in
  `reviews/safety-ui/screenshots/` were not compared pixel-by-pixel (the e2e spec has no snapshot
  assertions). No follow-up needed for this task.
- Real browser `inert` semantics (pointer and focus blocking) are only asserted as the attribute in the
  AppShell unit test; jsdom does not implement `inert`. The e2e spec does not exercise keyboard use behind
  the open dialog. Low risk; optional follow-up in a later e2e task.
- WriteGuard is not yet wired into real write UIs, nor `ProfileSafetyService.set()` into the connection UI
  (connection-ui task, per the recorded assumption), so end-to-end behavior with a real production profile
  is not testable in this task.

## Summary

Tests added and all validation passed. 14 new tests for the CR-1..CR-5 fixes (including the dialog-level
CR-1/CR-2 tests that `fixes.md` described but that were missing from the fix commit); no production defects
found. Focused safety/layout specs (237), `npm run check` / `.taskcheck` and the safety e2e spec (4) pass.
Task-scoped coverage of the safety folder at 24cd7c4: 99.1% statements / 97.3% branches / 100% functions /
99.6% lines; remaining gaps are unreachable defensive branches, pre-existing code, or dev-only code covered
by e2e.

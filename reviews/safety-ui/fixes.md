# Fix Report

Date: 2026-11-16

Task: safety-ui - M1: Safety UI: production accent, read-only state, confirm dialog service

Scope: current task. Round 1: findings CR-1 to CR-6 of the first review round (all approved for fixing by the parent worker). Round 2: findings CR-1 and CR-2 of the second review round in `reviews/safety-ui/review.md` (reviewed revision 24cd7c4, now rebased as e894462).

# Round 1 (first review, CR-1 to CR-6)

## Fixed findings

### CR-1 — Confirm dialog is not modal for the keyboard

Files changed:
- `packages/renderer/src/app/layout/app-shell.ts`
- `packages/renderer/src/app/safety/confirm-dialog.ts`
- `packages/renderer/src/app/safety/confirm-dialog.css`
- `packages/renderer/src/app/layout/app-shell.spec.ts`
- `packages/renderer/src/app/safety/confirm-dialog.spec.ts`

Problem:
Ctrl/Cmd+W, Ctrl+Tab and Ctrl+PageUp/PageDown pressed in the open dialog reached AppShell's document handler and closed or switched the tab behind it. The background was not inert, and a backdrop click moved focus to `<body>`, after which Escape did nothing and Tab left the dialog.

Fix:
- AppShell gets a `modal` computed from `ConfirmService.current()`. While it is true, the tab shortcuts are still consumed (`preventDefault`, so Ctrl+W never closes the window) but do not touch the tabs. Sidebar, splitter, `.work` and the status bar get `[attr.inert]`.
- ConfirmDialog: the backdrop's `mousedown` calls `preventDefault` and refocuses the dialog if focus is outside it. The dialog has `tabindex="-1"`, so clicks on its text keep focus inside, and `.dialog:focus` has no outline. A `document:keydown` fallback handles Escape (cancel) and Tab (focus moves into the dialog) when focus is outside the dialog. The Tab trap ignores Ctrl/Meta/Alt+Tab.
- Tests: the AppShell test checks that the background is inert, that shortcuts pressed inside the dialog and on `<body>` leave the tabs unchanged, and that everything is restored after the answer. The dialog tests cover backdrop click plus Escape, backdrop refocus, Tab from outside, no handling with no request shown, and Ctrl+Tab not trapped.

Validation:
- `cd packages/renderer && npx ng test --include='src/app/safety/**/*.spec.ts' --include='src/app/layout/**/*.spec.ts'` — Pass (12 files, 223 tests)

### CR-2 — `aria-label="Operation"` replaces the dialog description

Files changed:
- `packages/renderer/src/app/safety/confirm-dialog.ts`
- `packages/renderer/src/app/safety/confirm-dialog.spec.ts`

Problem:
The `aria-label` on the `<pre>` that `aria-describedby` references replaced the operation text as the accessible description.

Fix:
Removed the `aria-label`. The `aria-describedby` target now has only the operation text. A test checks that the described element's text is the operation and that it has no `aria-label` or `aria-labelledby`.

Validation:
- focused ng test command above — Pass

### CR-3 — An aborted write leaves its confirm dialog open

Files changed:
- `packages/renderer/src/app/safety/confirm.service.ts`
- `packages/renderer/src/app/safety/write-guard.service.ts`
- `packages/renderer/src/app/safety/confirm.service.spec.ts`
- `packages/renderer/src/app/safety/write-guard.service.spec.ts`

Problem:
`ConfirmService` could not withdraw a pending request, so the dialog stayed open after the caller's signal aborted.

Fix:
`ConfirmService.confirm(request, signal?)` now takes an optional signal:
- If the signal is already aborted, it resolves `false` and shows nothing.
- If the signal aborts later, the request is removed from the queue and resolves `false`. If it was the shown request, the typed text resets and the next request (or nothing) is shown.
- The abort listener is removed once the request is answered.

`WriteGuard.approve` passes its signal. New service tests cover a withdrawn shown request, a withdrawn waiting request, an already aborted signal, and an abort after the answer. The existing WriteGuard abort test now also asserts that the dialog closes on abort (the assertion is stronger; nothing was weakened).

Validation:
- focused ng test command above — Pass

### CR-4 — `describeWrite` omits options for `agg.run` and `agg.createView`

Files changed:
- `packages/renderer/src/app/safety/operation.ts`
- `packages/renderer/src/app/safety/operation.spec.ts`

Problem:
`agg.run` dropped `collation`, `hint`, `allowDiskUse`, `maxTimeMS` and `batchSize`, and `agg.createView` dropped `collation`.

Fix:
- `agg.run` adds a second `aggregate()` argument `{ collation, hint, allowDiskUse, maxTimeMS, batchSize }` with only the options that are present. EJSON values are printed in shell syntax.
- `agg.createView` adds `{ collation: ... }` as the fourth `createView` argument.
- Tests cover all options, a string hint, and the view collation.

Validation:
- focused ng test command above — Pass

### CR-5 — `WriteControl` removes a control's own `title`

Files changed:
- `packages/renderer/src/app/safety/write-control.directive.ts`
- `packages/renderer/src/app/safety/write-control.directive.spec.ts`

Problem:
`[attr.title]` evaluated to `null` on writable profiles, which removed any static host `title`.

Fix:
Added a `title` input to the directive. A static `title="..."` or bound `[title]` on the host goes to this input. The binding is now `readOnly() ? hint : title() || null`. The test covers a static and a bound title: both are shown while writable, replaced by the hint while read-only, and restored afterwards (including a changed bound value).

Validation:
- focused ng test command above — Pass

### CR-6 — Splitter comment sits above the production rule

Files changed:
- `packages/renderer/src/app/layout/app-shell.css`

Problem:
The splitter comment described the `:host(.production) .sidebar` rule instead of `.splitter`.

Fix:
Moved the splitter comment back directly above the `.splitter` rule. The production rule and its comment now come before it.

Validation:
- `npm run check` (lint and prettier) — Pass

## Not fixed

None.

## Validation summary

Focused tests:
- `cd packages/renderer && npx ng test --include='src/app/safety/**/*.spec.ts' --include='src/app/layout/**/*.spec.ts'` — Pass (12 files, 223 tests)

Full test suite:
- `npm run check` (repo root: eslint, prettier, typecheck, root vitest 42 files / 2551 tests, renderer ng test 44 files / 817 tests) — Pass
- `npm run test:e2e -- test/e2e/safety.e2e.ts test/e2e/layout.e2e.ts` — Pass (10 passed). The committed screenshots in `reviews/safety-ui/screenshots/` were not changed.

Lint/type-check/build:
- Covered by `npm run check` — Pass (one prettier formatting issue in the new operation.spec.ts test was fixed with `npx prettier --write`)

`.taskcheck`:
- Pass (`sh .taskcheck`, which runs `npm run check`)

Remaining unresolved findings:
0

### Round 1 status

All validated findings fixed and validation passed.

# Round 2 (second review, CR-1 and CR-2)

## Fixed findings

### CR-2 (round 2, P3) — ARCHITECTURE.md documents the old `ConfirmService.confirm` signature

Files changed:
- `docs/ARCHITECTURE.md`

Problem:
The "Write safety in the renderer" section still said `ConfirmService.confirm(request) → Promise<boolean>` and did not mention withdrawal on abort or the inert background.

Fix:
The line now reads `ConfirmService.confirm(request, signal?) → Promise<boolean>`. It tells callers to pass their abort signal (as `WriteGuard` does): aborting it withdraws the request, so the dialog closes or never opens and the promise resolves `false`. It also says that while a request is shown, `AppShell` makes the rest of the window `inert` and ignores the tab shortcuts. Checked against the code: `confirm.service.ts` (`confirm(request, signal?)`, `withdraw()`, already aborted signal resolves `false`) and `app-shell.ts` (`modal` computed from `ConfirmService.current()`, `[attr.inert]` on sidebar, splitter, `.work` and status bar, and shortcuts that skip the tab action while `modal()`).

Validation:
- `npm run check` (includes prettier) — Pass

## Not fixed

### CR-1 (round 2, P2) — Dialog regression tests not in the reviewed revision

Status:
Invalid (no code change needed; resolved by commit b1f5b98)

Reason:
The finding is about the review snapshot, where the tests were only in the working tree. Commit b1f5b98 ("safety-ui: final test-writer tests for the review fixes, reports") adds 118 lines to `packages/renderer/src/app/safety/confirm-dialog.spec.ts`. These are the accessible description test (no `aria-label` on the operation text) and the "modal keyboard handling" tests: backdrop click keeps focus so Escape still cancels, backdrop click leaves focus on the inner control, Escape and Tab from `<body>`, other keys and Ctrl+Tab on `<body>` left alone, no handling without a dialog, Ctrl/Meta/Alt+Tab not trapped, and Escape cancelling only the shown request. `git status` showed a clean tree before this fix, so nothing is left uncommitted. These tests pass (see below).

## Validation summary

Focused tests:
- `cd packages/renderer && npx ng test --include='src/app/safety/**/*.spec.ts' --include='src/app/layout/**/*.spec.ts' --watch=false` — Pass (12 files, 237 tests)

Full test suite:
- `npm run check` (repo root: lint, prettier, type check, root vitest 44 files / 2684 tests, renderer ng test 44 files / 831 tests) — Pass

Lint/type-check/build:
- Covered by `npm run check` — Pass

`.taskcheck`:
- Pass (`.taskcheck` runs `npm run check`, which passed above)

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.

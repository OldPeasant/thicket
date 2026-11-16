# Fix Report

Date: 2026-11-16

Task: safety-ui - M1: Safety UI: production accent, read-only state, confirm dialog service

Scope: current task; findings CR-1 to CR-6 from `reviews/safety-ui/review.md` (all approved for fixing by the parent worker)

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

## Final status

All validated findings fixed and validation passed.

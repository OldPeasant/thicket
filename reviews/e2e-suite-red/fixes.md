# Fix Report

Date: 2026-11-17

Task: e2e-suite-red - Test: fix failing e2e tests (layout Compass heading, sidebar drag, LDAP fixture start)

Scope: current task; finding CR-2 from `reviews/e2e-suite-red/review.md`, as directed by the parent worker. CR-1 is a documentation and evidence matter that the parent handles, so this fix did not change it.

## Fixed findings

### CR-2 - Document-level pointermove host listener triggers a change-detection pass on every pointer move

Files changed:
- `packages/renderer/src/app/layout/app-shell.ts`
- `packages/renderer/src/app/layout/app-shell.spec.ts`

Problem:
The host bindings `(document:pointermove)`, `(document:pointerup)` and `(document:pointercancel)` on AppShell went through Angular's listener wrapping. In this zoneless app, every pointer event anywhere in the window scheduled an application tick, even when no splitter drag was running.

Fix:
Removed the three document host bindings. `dragStart` (which only proceeds for a primary-button press) now calls `listenToDrag()`. That method attaches plain `pointermove`, `pointerup` and `pointercancel` listeners to the injected `DOCUMENT`. Before attaching, it removes any listeners that are already there, so a second press during a drag does not leave duplicates. `dragEnd` removes the listeners for the dragging pointer's release or cancel. A `DestroyRef.onDestroy` hook also removes them if the component is destroyed. `dragMove` and `dragEnd` are unchanged: other pointer ids are ignored, pointerup takes the release position, and pointercancel keeps the last move. The preview is still rendered because `SidebarWidthService.preview` sets a signal, which schedules change detection by itself. The explanatory comment about why the document is used now sits on `listenToDrag`, and a note about change detection was added.

Added the regression test "listens on the document only during a drag, without duplicates (fixer)". It counts the active document pointer listeners and checks that:
- none are attached before a drag;
- none are attached after a secondary-button press;
- exactly one of each is attached during a drag, also after a second press;
- the preview renders from a document move;
- all are removed after pointerup and after pointercancel;
- all are removed when the shell is destroyed mid-drag.

All existing sidebar drag specs pass without changes.

Validation:
- `cd packages/renderer && npx ng test --include=src/app/layout/app-shell.spec.ts` - Pass (73 tests)
- `npm run check` - Pass

## Not fixed

### CR-1 - On affected hosts the LDAP e2e test is skipped rather than passing, and the cause is unconfirmed

Status:
Out of scope

Reason:
The parent worker handles this as a documentation and evidence disposition and told the fixer not to change it. The fixer made no code changes for CR-1.

## Validation summary

Focused tests:
- `cd packages/renderer && npx ng test --include=src/app/layout/app-shell.spec.ts` - Pass, 73 passed

Full test suite:
- `npm run check` (unit tests) - Pass: root vitest 4457 passed (87 files), renderer `ng test` 3398 passed (102 files)

Lint/type-check/build:
- `npm run check` (eslint --max-warnings 0, prettier --check, tsc and ngc type checks) - Pass

`.taskcheck`:
- Pass. `.taskcheck` runs `npm run check`, which passed as shown above.

Remaining unresolved findings:
1 (CR-1, handled by the parent worker as a disposition)

## Final status

All validated findings fixed and validation passed.

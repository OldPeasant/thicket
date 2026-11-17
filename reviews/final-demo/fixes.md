# Fix Report

Date: 2026-11-17

Task: final-demo — Release: full demo script end to end

Scope: current task; findings CR-1, CR-2 (reviews/final-demo/review.md) and TW-1
(reviews/final-demo/tests.md). Only `test/e2e/demo/demo.e2e.ts` changed; no production code.

## Fixed findings

### CR-1 — Production checkbox below the fold in the Tron dark step-02 screenshot

Files changed:
- `test/e2e/demo/demo.e2e.ts`

Problem:
`step-02-production.png` scrolled the Production checkbox into view once, in Business light,
before `shot()` switched themes. Tron dark's larger fonts pushed it below the visible area.

Fix:
`shot(window, name, scrollTo?)` takes an optional locator and calls `scrollIntoViewIfNeeded()`
on it after each theme switch, before that theme's screenshot. Step 2 passes the Production
checkbox; step 10 (`step-10-ssh-x509-form.png`, which had the same one-time scroll for
`field-ssh`) passes the SSH checkbox. The two one-time scroll calls were removed.

Validation:
- `npm run lint` — Pass
- `npm run typecheck` (the root tsconfig includes `test/e2e/**/*.ts`) — Pass
- e2e run with new screenshots — not run here (the parent rebuilds the AppImage and runs it)

### CR-2 — A fixture that started is not stopped when the other one fails

Files changed:
- `test/e2e/demo/demo.e2e.ts`

Problem:
`beforeAll` started the TLS replica set and the SSH/X.509 fixture with `Promise.all`. If one
rejected, `server`/`bastion` were never assigned, so `afterAll` could not stop the one that
had started, and its containers leaked.

Fix:
Uses `Promise.allSettled`. If either start rejects, it stops whichever fixture started
(through `Promise.allSettled`, so a failing stop does not hide the original error), then
rethrows the first rejection reason. `server` and `bastion` are only assigned when both start.

Validation:
- `npm run lint` — Pass
- `npm run typecheck` — Pass

### TW-1 — Which AppImage the test runs is not visible

Files changed:
- `test/e2e/demo/demo.e2e.ts`

Problem:
`findAppImage()` silently picks `$THICKET_APPIMAGE` or the newest AppImage, so a stale build
can't be seen in the test output.

Fix:
After the skip checks, the test adds a test annotation (`type: 'appimage'`) and a console line
with the AppImage path and its mtime (ISO 8601). It still skips when no AppImage exists, and
there is no hard staleness check, as requested.

Validation:
- `npm run lint` — Pass
- `npm run typecheck` — Pass

## Not fixed

None.

## Validation summary

Focused tests:
- The e2e demo was not run by the fixer, as instructed. The parent rebuilds the AppImage, runs
  `xvfb-run -a npm run test:e2e -- demo`, and checks the regenerated Tron dark
  step-02/step-10 screenshots.

Full test suite:
- Not run (only an e2e file changed; `npm run test` does not run e2e).

Lint/type-check/build:
- `npm run lint` (eslint --max-warnings 0 + prettier --check) — Pass
- `npm run typecheck` (root tsconfig including test/e2e, plus all workspaces) — Pass

`.taskcheck`:
- Not run by the fixer. Its lint and typecheck parts passed above, and the parent runs it before `done`.

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed (lint and typecheck). The parent still needs to run the e2e demo against a rebuilt AppImage.

# Fix Report

Date: 2026-11-17

Task: e2e-screenshot-repaint - Test: screenshots after view switches don't hang on headless Linux

Scope: current task; findings CR-1 to CR-4 from `reviews/e2e-screenshot-repaint/review.md`, approved by
the parent worker, plus test-writer observation TW-1 (a locator matching nothing must fail fast).

## Fixed findings

### CR-1 — Element screenshot fallback silently captures the wrong thing when the element is not visible

Files changed:
- `test/e2e/harness/screenshot.ts`
- `test/e2e/screenshot.e2e.ts`

Problem:
Any `TimeoutError` from `locator.screenshot()` led to the repaint fallback. For a hidden or missing
element this wrote a whole-window capture (`boundingBox()` null) or an empty box with no error.
`boundingBox()` without a timeout could also wait until the test timeout for a locator that matches
nothing (TW-1).

Fix:
After a `TimeoutError` for a Locator target, the helper uses the fallback only if the element is
visible (`isVisible()`) and has a box (`boundingBox({ timeout: 2_000 })`, new `BOX_TIMEOUT`).
Otherwise, or if either call throws, it rethrows the original `TimeoutError` and writes no file. Page
targets keep the whole-window fallback.
In the test, the test-writer's `falls back to a repaint capture of the element` test (it relied on a
`visibility:hidden` box taking the fallback, which is now wrong) is now `an element that is not visible
fails with the TimeoutError, not a fallback capture`. It asserts a rejection with `name: 'TimeoutError'`
in under 7 s, with no file written. A new test, `a locator that matches nothing fails fast with the
TimeoutError`, asserts the same in under 8 s. Page-level fallback stays covered by
`the repaint fallback captures the current view` (`capturePageWithRepaint`).

Validation:
- `npx playwright test screenshot.e2e --output=/tmp/fixer-e2e --reporter=list` — Pass (8 passed, 19.1 s; hidden element 5.7 s, missing locator 6.4 s)

### CR-2 — Harness failure screenshots still call `page.screenshot()` directly

Files changed:
- `test/e2e/harness/fixtures.ts`

Problem:
`screenshotWindows()` used `page.screenshot({ timeout: 5_000 })`, which contradicts the documented rule
and has no repaint fallback.

Fix:
It now calls `screenshot(app, page, path)` (imported from `./screenshot`) and keeps the try/catch and
the warning. There is no import cycle: `screenshot.ts` imports only Playwright/Electron types and `node:fs`/`node:path`.

Validation:
- `npx tsc -p tsconfig.json` — Pass
- `npx playwright test harness-helpers --output=/tmp/fixer-e2e-hh --reporter=line` — 10 passed, 2 failed. Both failures are the known `test-results/` path assertions (`harness-helpers.e2e.ts:164`, `:210`), caused only by the `--output` override (same as the reviewer's and test-writer's runs). In the `screenshotWindows saves a PNG...` test the `window 0` PNG was written through the helper and attached. The default-output run belongs to the parent's full `npm run test:e2e`.

### CR-3 — Packaged smoke script still launches headless Ozone with the 1x1 default screen

Files changed:
- `apps/desktop/scripts/smoke-packaged.mjs`

Problem:
The headless launch passed only `--ozone-platform=headless`, so the window would be clamped to 1x1.

Fix:
Added `--ozone-override-screen-size=1920,1080` next to it, with a comment explaining the 1x1 default
screen.

Validation:
- `npx eslint test/e2e apps/desktop` — Pass
- `npx prettier --check test/e2e apps/desktop/scripts` — Pass
- Packaged smoke run itself: Not run (needs a packaged build; the parent said not to rebuild)

### CR-4 — "Started headless" test checks the test process's args, not the launched app

Files changed:
- `test/e2e/screenshot.e2e.ts`

Problem:
The test checked `headlessArgs()` in the test process, not what the app received.

Fix:
It now asserts that `electronApp.process().spawnargs` contains `--ozone-platform=headless` and
`--ozone-override-screen-size=1920,1080`. The unused `headlessArgs` import was removed.

Validation:
- `npx playwright test screenshot.e2e --output=/tmp/fixer-e2e --reporter=list` — Pass (`the app is started headless with a real screen size`)

## Not fixed

None.

## Validation summary

Focused tests:
- `npx playwright test screenshot.e2e --output=/tmp/fixer-e2e --reporter=list` — Pass, 8 passed
- `npx playwright test harness-helpers --output=/tmp/fixer-e2e-hh --reporter=line` — 10 passed, 2 failed (only the `--output`-induced `test-results/` path assertions, see CR-2)

Full test suite:
- Not run. The parent's full `npm run test:e2e` was running in this clone, and the parent asked for no full e2e run.

Lint/type-check/build:
- `npx tsc -p tsconfig.json` — Pass
- `npx eslint test/e2e apps/desktop` — Pass
- `npx prettier --check test/e2e apps/desktop/scripts` — Pass
- Build: not run (parent's instruction; the app was already built)

`.taskcheck`:
- Not run (left to the parent worker)

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.

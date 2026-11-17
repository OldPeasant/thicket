# Code Review

Date: 2026-11-17

Task: e2e-screenshot-repaint - Test: screenshots after view switches don't hang on headless Linux

Scope: committed task changes `c74ea81..0370640` (commits 5a7801c, 0370640). During the review the branch was rebased onto newer main; the rebased task commits 2416ed36 and 0758062a have the same `git patch-id --stable` (de30338e...) as the reviewed diff, so this review applies to them too. Uncommitted changes to `test/e2e/screenshot.e2e.ts` (test-writer work in progress) were seen in the working tree and are not part of this review.

Requirements:
- tasks/e2e-screenshot-repaint.md acceptance criteria (3)
- docs/ARCHITECTURE.md "End-to-end tests"
- AGENTS.md (project notes, evidence rules)
- Parent agent context (root cause: headless Ozone 1x1 default screen)

Git range:
- Branch: main
- HEAD: 0758062addc8afc0c9114ec96fa97b4e688f641b (rebased; originally reviewed at 0370640)
- Base/start: c74ea8166f401f147ac6917a4a7a5ec65cbc789d (after the rebase: 240c9b11)
- Commits reviewed: 2

Summary: 0 P0, 0 P1, 1 P2, 3 P3

Checks run by the reviewer (no rebuild, full e2e suite not run, as the parent agent asked):
- `npx tsc -p tsconfig.json --noEmit` -> no errors
- `npx eslint test/e2e apps/desktop/test` -> no findings
- `npx playwright test screenshot.e2e --output /tmp/review-e2e-screenshot-out2` -> 7 passed. The working tree included the test-writer's uncommitted tests. The spec unsets DISPLAY/WAYLAND_DISPLAY itself.
- `npx playwright test screenshot.e2e harness-helpers --output /tmp/review-e2e-screenshot-out` -> 17 passed, 2 failed. Both failures (`harness-helpers.e2e.ts:155`, `:207`) check that output goes under `test-results/`, so my `--output` override caused them, not the code. I used `--output` so I would not wipe the `test-results/` of the e2e run in the background.

Acceptance criteria assessment:
1. Harness e2e test with view switches, marker colours, no timeout, headless: met by `test/e2e/screenshot.e2e.ts`. It checks five view switches with a distinct marker colour each, a capture time under 4 s (so Playwright did not hit its 5 s timeout), and that each PNG differs from the previous one. It removes DISPLAY/WAYLAND_DISPLAY/THICKET_TEST_HEADLESS in `beforeAll`. `electronApp` is test-scoped, so the app really is launched headless.
2. Existing suites use the helper: every `window.screenshot` / `locator.screenshot` call in `test/e2e/**/*.e2e.ts` now goes through `screenshot()` (verified by grep). Whether `npm run test:e2e` passes headless must come from the parent's background run; this review cannot confirm it.
3. docs/ARCHITECTURE.md: updated with the switch, the helper, and why it is needed.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | Element screenshot fallback silently captures the wrong thing when the element is not visible**
    - File: `test/e2e/harness/screenshot.ts:46-54`
    - Category: Correctness
    - Problem: Every `TimeoutError` from `locator.screenshot()` (5 s) leads to the fallback. A locator screenshot also times out when the element exists but never becomes visible or stable, not only when no frame comes. The fallback then uses `target.boundingBox()`. If that returns `null` (for example, a `display:none` element), `rect ?? undefined` captures the whole window and writes it to `path` with no error. If it returns a box for an invisible element, an empty box is captured. Before this change, a screenshot of an element that never appeared failed the test.
    - Why it matters: A suite such as `bulk.e2e.ts:109` / `:169` (`screenshot(electronApp, panel, ...)`) can pass and save a misleading full-window or empty image when the panel is not shown. That hides a real UI regression. These screenshots are used as demo/release evidence (`final-demo`).
    - Suggested fix: In the fallback, throw if `boundingBox()` is `null` for a Locator target instead of capturing the full window. Consider also checking `await target.isVisible()` before falling back, or rethrowing when the element is not visible. Then the fallback only covers the "no new frame" case it was written for.

## P3 Low

- [ ] **CR-2 | Harness failure screenshots still call `page.screenshot()` directly**
    - File: `test/e2e/harness/fixtures.ts:48`
    - Category: Quality
    - Problem: `screenshotWindows()` (failure artifacts) still uses `page.screenshot({ timeout: 5_000 })`. The new docs say "always `screenshot()` ... never `page.screenshot()`". The code is not wrong: it is best-effort, catches errors, and the screen-size switch makes it work. But it contradicts the rule just written down.
    - Why it matters: Failure screenshots are the main debugging aid for headless CI runs. If Playwright's capture times out there, no image is saved, while the helper's fallback would have produced one.
    - Suggested fix: Use `screenshot(app, page, path)` in `screenshotWindows`, or state in the docs that failure artifacts are a deliberate exception.

- [ ] **CR-3 | Packaged smoke script still launches headless Ozone with the 1x1 default screen**
    - File: `apps/desktop/scripts/smoke-packaged.mjs:32`
    - Category: Integration
    - Problem: The script passes only `['--ozone-platform=headless']` and then calls `page.screenshot()` (line 57). This is the root cause the task fixed in `test/e2e/harness/app.ts` and `apps/desktop/test/helpers.ts`. The docs list those two places as using the same switches, so the third headless launch path was missed.
    - Why it matters: Without a display, the packaged smoke check can get a 1x1 window and hang or produce a blank screenshot, the same failure this task fixed. The file is outside the task's `touches`, so this could be a follow-up task.
    - Suggested fix: Add `--ozone-override-screen-size=1920,1080` there too, or create a follow-up task for it.

- [ ] **CR-4 | "Started headless" test checks the test process's args, not the launched app**
    - File: `test/e2e/screenshot.e2e.ts:146`
    - Category: Tests
    - Problem: `expect(headlessArgs()).toContain('--ozone-platform=headless')` checks what the harness would pass now. It does not check what the app received. The window-size assertion that follows covers the important part, so this is minor.
    - Suggested fix: Assert on `electronApp.process().spawnargs` (should contain both the `--ozone-platform=headless` and the `--ozone-override-screen-size` switches), so the test shows the app really ran on the headless backend with the screen-size override.

## Review conclusion

Material issues found; fix before completing the task. The acceptance criteria are met as far as the reviewer can verify. CR-1 should be fixed or explicitly accepted by the parent worker, because the fallback can hide a missing element behind a successful screenshot. The P3 findings are optional cleanups or follow-ups.

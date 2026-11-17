# Code Review

Date: 2026-11-17

Task: e2e-screenshot-repaint - Test: screenshots after view switches don't hang on headless Linux

Scope: round 2. Committed task changes `c74ea81..HEAD` without `tasks/` and `reviews/`. The final code revision is 99a03cbc (fixes for round-1 findings CR-1..CR-4). HEAD 763a0972 only adds `tasks/e2e-suite-red.md`, so it changes no code. The task commits are 2416ed36, 0758062a, 5bc11db9 and 99a03cbc, on top of 240c9b11. The other files in `git diff c74ea81..HEAD` (packages/backend, test/integration) come from other tasks merged into main (raw-cmd-read-pref and others) and are not part of this review. An uncommitted change to `test/e2e/screenshot.e2e.ts` (+43 lines, apparently test-writer round-2 work in progress) was in the working tree during this review. It is not reviewed here, and the test runs below used the committed 8 tests (line numbers match 99a03cbc).

Requirements:
- tasks/e2e-screenshot-repaint.md acceptance criteria (3)
- docs/ARCHITECTURE.md "End-to-end tests"
- AGENTS.md (evidence rules, quality gate)
- reviews/e2e-screenshot-repaint/review.md (round 1) and fixes.md
- Parent agent context: full `npm run test:e2e` (real display) gave 57 passed / 3 failed twice; follow-up task tasks/e2e-suite-red.md

Git range:
- Branch: main
- HEAD: 763a0972a4b1ed7740cb5fae395a7353112c9dd5 (final code revision 99a03cbc7d2d85feec57a5bc2b56b191912ee126)
- Base/start: c74ea8166f401f147ac6917a4a7a5ec65cbc789d
- Commits reviewed: 4 task commits (2416ed36, 0758062a, 5bc11db9, 99a03cbc), plus 763a0972 (task file only)

Summary: 0 P0, 0 P1, 1 P2, 1 P3

Commands run by the reviewer (no rebuild, no full e2e suite, as the parent agent asked):
- `npx tsc -p tsconfig.json` -> pass (no output)
- `npx eslint test/e2e apps/desktop` -> pass (no findings)
- `npx playwright test screenshot.e2e --output=/tmp/cr2-shot --reporter=list` -> 8 passed (19.8 s). The spec removes DISPLAY/WAYLAND_DISPLAY itself, so the app runs headless. The hidden-element and missing-locator tests reject in 5.7 s each.
- `npx playwright test layout.e2e --output=/tmp/cr2-layout --reporter=list` (real display) -> 5 passed, 1 failed: `layout.e2e.ts:36` (`page-heading` not found on the Compass import page). The two layout screenshot tests that now use the helper passed. The sidebar drag test (`:61`) passed in this run. The failure artifact `window 0` was written through `screenshot()`, which confirms the CR-2 change works.

## Round-1 findings and how they were resolved

- CR-1 (P2, element fallback captured the whole window or an empty box for hidden or missing elements): resolved. `screenshot.ts:48-59` falls back for a Locator only when `visibleBox()` returns a box. `visibleBox()` (`:105-112`) uses `isVisible()` (no wait) and then `boundingBox({ timeout: 2_000 })`, and it returns null on any error, including a strict-mode violation. Otherwise the original `TimeoutError` is rethrown and no file is written. Page targets keep the whole-window fallback. Two tests cover this: a hidden element and a locator that matches nothing. Both check that the rejection is a `TimeoutError`, that it comes within a time bound, and that no file was written. The docs bullet was updated to match.
- CR-2 (P3, failure screenshots used `page.screenshot()`): resolved. `fixtures.ts:49` calls `screenshot(app, page, path)`, keeping the try/catch. There is no import cycle. Confirmed in the layout run above.
- CR-3 (P3, packaged smoke script had the 1x1 headless screen): resolved. `smoke-packaged.mjs:34` adds `--ozone-override-screen-size=1920,1080`. The script still calls `page.screenshot()` (`:59`). That is acceptable: it is not an e2e suite, and the screen size was the root cause. The packaged run itself was not executed (it needs a packaged build).
- CR-4 (P3, the "started headless" test checked the test process's args): resolved. The test now checks `electronApp.process().spawnargs` for both switches.

## Criterion 2 failure attribution

The parent attributes the 3 failures in the real-display run to causes outside this task. That attribution is correct:
- `git diff --stat c74ea81..99a03cbc -- test/e2e/ldap.e2e.ts packages/renderer apps/desktop/src` is empty. The task changed no app code, no renderer page and no LDAP fixture/spec.
- In `layout.e2e.ts` the task changed only the two screenshot tests (import + `screenshot()` call). The test at `:36` is unchanged. At base c74ea81, `packages/renderer/src/app/connections/import/` already had no `page-heading` test id (`git grep` at c74ea81 finds none), so this failure was there before the task.
- The sidebar drag test (`:61`) is unchanged, does not take a screenshot, and with a real display does not get the headless switches. It passed in my run, so it looks flaky or environment-dependent rather than a regression.
- The LDAP failure is a container start problem, and no LDAP code was touched.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-5 | Criterion 2 ("`npm run test:e2e` passes headless") is not met as written and has no headless evidence**
    - File: `tasks/e2e-screenshot-repaint.md:16`
    - Category: Tests
    - Problem: The only full-suite evidence is two real-display runs (57 passed / 3 failed). No headless full run exists, and the suite is red, for reasons this task did not cause (see above). The first half of the criterion is met: grep shows no `window.screenshot` / `locator.screenshot` calls left in `test/e2e/**/*.e2e.ts`. The remaining direct `page.screenshot` calls are in `apps/desktop/test/theme.electron.spec.ts:119` (vitest `test:electron` suite, not `test:e2e`) and the packaged smoke script.
    - Why it matters: Ticking the criterion would claim a passing headless suite that nobody saw (AGENTS.md "Evidence"). Also, `tasks/e2e-suite-red.md` has `deps: []` and touches `test/e2e/layout.e2e.ts`, a file this task also changed.
    - Suggested fix: Do not record criterion 2 as passed. Record it with `tasks.py verify e2e-screenshot-repaint 2 --skip "<reason>"`. The reason should cover: the real-display runs gave 57/3, the failures predate the task (layout `:36` and the import page are unchanged since c74ea81, sidebar drag passes on re-run, LDAP container start), the fix is tracked in e2e-suite-red, and a headless full run needs env prefixes that are not allowed here. Add a matching `assume`. If possible, also run the full suite headless (DISPLAY/WAYLAND_DISPLAY unset) before `done`, so the headless half has evidence for the screenshot suites.

## P3 Low

- [ ] **CR-6 | The element-crop fallback path has no test at the reviewed revision**
    - File: `test/e2e/screenshot.e2e.ts` (at 99a03cbc), path `test/e2e/harness/screenshot.ts:55-60`
    - Category: Tests
    - Problem: After the CR-1 fix, the old fallback test (a hidden box) correctly turned into a "rejects" test. Since then, no committed test reaches `capturePageWithRepaint(app, page, rect)` with a `rect`, that is, a visible element whose Playwright capture timed out. The page fallback and `capturePageWithRepaint` without a rect are still covered.
    - Why it matters: The rect rounding and crop are the code the element fallback depends on (bulk.e2e uses element screenshots), and a regression there would go unnoticed.
    - Suggested fix: Commit a test that forces a visible element's Playwright capture to time out (for example, a continuously animating element, so it is never "stable") and checks that the PNG is the element's size. The uncommitted working-tree change seems to add such a test. Re-review once it is committed.

## Review conclusion

No material issues found in the code. All four round-1 findings are correctly fixed. Type check, lint and the screenshot spec pass, and the helper works for failure artifacts. Before completing, the parent worker must record criterion 2 as skipped with a reason, not as passed (CR-5), and should commit the element-fallback test (CR-6).

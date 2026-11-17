# Code Review

Date: 2026-11-17

Task: e2e-screenshot-repaint - Test: screenshots after view switches don't hang on headless Linux

Scope: round 3, the whole task at the final code revision fde210bb (after main was rebased in). Committed task changes `9dfc8ad2..fde210bb` (`git merge-base HEAD origin/main` = 9dfc8ad2), without `tasks/` and `reviews/`. Task code commits: f5e0a7ea (helper, headless screen size, suites use it), 88bad449 (architecture notes), dc8a585a (test-writer tests), 1ef7f55d (round-1 fixes CR-1..CR-4), fde210bb (round-2 reports and the element-fallback test for CR-6). d0572543, fd88d5a6 and 1da0495b only change `tasks/`. Since round 2 (reviewed at 99a03cbc, rebased as 1ef7f55d) the code changes are: (a) the new test in `test/e2e/screenshot.e2e.ts` ("a visible element whose capture times out falls back to a repaint capture of just that element", +46 lines, identical to `git diff 99a03cbc 1a0af601 -- test/`), and (b) the rebase conflict resolution in `apps/desktop/scripts/smoke-packaged.mjs`, where main's rewritten script (spawn + CDP) was kept and CR-3 was applied again. `git diff 1a0af601 fde210bb` for the task's own files (`test/e2e/harness/**`, `test/e2e/screenshot.e2e.ts`, the converted suites, `apps/desktop/test/helpers.ts`) is empty. All other differences between 1a0af601 and fde210bb come from other tasks merged into main. The working tree was clean apart from this report.

Requirements:
- tasks/e2e-screenshot-repaint.md acceptance criteria (3)
- docs/ARCHITECTURE.md "End-to-end tests" and the packaging notes on `smoke-packaged.mjs`
- AGENTS.md (evidence rules, quality gate)
- Round-1/round-2 reports in reviews/e2e-screenshot-repaint/ (fixes.md, tests.md, earlier review.md)
- Parent agent context: criterion 2 will be recorded with `verify --skip` plus an `assume`, and follow-up task tasks/e2e-suite-red.md (now `deps: [e2e-screenshot-repaint]`)

Git range:
- Branch: main
- HEAD: fde210bb9d8401fb15877b0d76639fc450d8e863 (final code revision)
- Base/start: 9dfc8ad2f4ca38ddc78939d7dbfc8b17781cfae5 (`git merge-base HEAD origin/main`)
- Commits reviewed: 8 (5 with code: f5e0a7ea, 88bad449, dc8a585a, 1ef7f55d, fde210bb; 3 that only change `tasks/`)

Summary: 0 P0, 0 P1, 2 P2, 2 P3

Commands run by the reviewer (no rebuild, no full e2e suite, as the parent agent asked):
- `npx playwright test screenshot.e2e --output=/tmp/cr3-shot2 --reporter=list` at fde210bb -> 9 passed (24.2 s). The new fallback test took 6.9 s. The spec removes DISPLAY/WAYLAND_DISPLAY itself, so the app runs headless.
- `npx tsc -p tsconfig.json` -> pass (no output)
- `npx eslint test/e2e` -> pass (no findings)
- `grep -rnE "\.screenshot\(" test/e2e apps/desktop` -> direct calls in `test/e2e/schema-analysis.e2e.ts:93` (see CR-7), `test/e2e/smoke/installer.smoke.ts:128` (the `test:smoke` config, not `test:e2e`, and it has no `ElectronApplication`), `apps/desktop/scripts/smoke-packaged.mjs:178` and `apps/desktop/test/theme.electron.spec.ts:119` (vitest `test:electron`).

## Review of the round-3 changes

New test `screenshot.e2e.ts:194-238`:
- It does exercise the element fallback. Playwright's element screenshot waits until the element is "stable", meaning its box is the same in two consecutive animation frames. The test's `requestAnimationFrame` loop moves the box between left 20 and 23 px on every frame, so it is never stable and the 5 s Playwright timeout always fires. The box is visible and laid out, so `visibleBox()` returns a rect and `capturePageWithRepaint(app, page, rect)` runs. `elapsed >= 5_000` shows that the timeout path ran. The 240x60 (plus or minus 1) PNG size shows that the capture was cropped to the element, not the whole window. The centre pixel `rgb(20,160,90)` shows that it captured the element. The returned buffer is compared with the written file.
- Deterministic: the box alternates on every frame, so a stability check can never pass. The 3 px shift and the crop taken at `boundingBox()` time leave the centre pixel (120, 30) inside the green box in either position. The box (top 100) does not overlap the 40 px marker bar. The cssText regex allows the space that the browser adds when it normalizes `left: 20px`.
- The rAF loop keeps running until the app closes. That is harmless, because each test gets a fresh app from the harness fixture.
- The upper bound `elapsed < 9_000` leaves about 2 s of headroom over the measured 6.9 s (see CR-8).

Rebase resolution in `apps/desktop/scripts/smoke-packaged.mjs:46-48,97,150`: correct. `HEADLESS_ARGS` (`--ozone-platform=headless`, `--ozone-override-screen-size=1920,1080`) has a comment explaining the 1x1 screen and is used at both headless launches. These are the RunAsNode probe and the main CDP spawn. Main's behaviour is otherwise kept (`--remote-debugging-port=0`, `--inspect=0`, env). Adding the screen size to the probe is harmless: with the RunAsNode fuse off, the probe starts the GUI app, which gets the same screen as the main launch. The switches match `test/e2e/harness/app.ts:27` and `apps/desktop/test/helpers.ts:32`. The script still calls `page.screenshot()` (`:178`). As in round 2, that is acceptable: the script is not an e2e suite, and the screen size was the root cause. The packaged run was not executed, because it needs a packaged build.

## Findings from earlier rounds and their dispositions

- CR-1 (P2, round 1, the element fallback captured the whole window or an empty box): resolved in 1ef7f55d. Tests: the hidden-element and no-match tests, both still passing.
- CR-2 (P3, round 1, failure screenshots used `page.screenshot()`): resolved. `fixtures.ts` uses `screenshot()`.
- CR-3 (P3, round 1, packaged smoke script had the 1x1 headless screen): resolved. It was re-applied correctly on main's rewritten script during the rebase (see above).
- CR-4 (P3, round 1, the "started headless" test checked the test process's args): resolved. The test checks `electronApp.process().spawnargs`.
- CR-5 (P2, round 2, criterion 2 not met as written, no headless full-suite evidence): disposition accepted. Criterion 2 is to be recorded with `tasks.py verify e2e-screenshot-repaint 2 --skip "<reason>"`, plus an `assume`. The red suite is tracked in tasks/e2e-suite-red.md, which now depends on this task. The round-2 attribution still holds: the 3 failures in the real-display runs (layout `:36` page-heading, sidebar drag, LDAP container start) predate the task or are unrelated to it. Kept open below until the skip is recorded. It must not be ticked as passed. The skip reason should also mention CR-7, if CR-7 is not fixed.
- CR-6 (P3, round 2, no test for the element-crop fallback): resolved in fde210bb by the new test reviewed above (passes, really reaches the rect path).

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-5 | Criterion 2 ("`npm run test:e2e` passes headless") is not met as written; record it as skipped, not passed**
    - File: `tasks/e2e-screenshot-repaint.md:16`
    - Category: Tests
    - Problem: The only full-suite evidence is two real-display runs (57 passed / 3 failed). There is no headless full run. The failures were not caused by this task (round-2 analysis).
    - Why it matters: Ticking the criterion would claim a passing headless suite that nobody saw (AGENTS.md "Evidence").
    - Suggested fix (agreed disposition): use `verify ... 2 --skip` with the reason (57/3 on a real display, the failures predate the task, tracked in e2e-suite-red, and a headless full run is not possible here), plus a matching `assume`. Nothing changes in code.

- [ ] **CR-7 | A suite merged from main takes a direct `window.screenshot()`, so "existing suites use the helper" no longer holds at fde210bb**
    - File: `test/e2e/schema-analysis.e2e.ts:93`
    - Category: Correctness
    - Problem: `await window.screenshot({ path: join(SHOTS, 'schema-analysis.png') });`. This suite (ddda1f0d, task schema-analysis) arrived on main while this task was in flight and came in with the rebase. It is part of `test:e2e` (`**/*.e2e.ts`). After a view switch (opening the schema panel) it takes exactly the kind of screenshot that hangs headless. The first half of criterion 2 and the ARCHITECTURE.md rule ("never `page.screenshot()`") are not true for the merged tree.
    - Why it matters: Under headless Ozone this call can hang for the 30 s default action timeout or come out stale. That is the failure this task exists to remove, and the schema-analysis step is also a candidate demo screenshot.
    - Suggested fix: Import `screenshot` from `./harness`, take the `electronApp` fixture in that test, and call `await screenshot(electronApp, window, join(SHOTS, 'schema-analysis.png'))`. The `mkdir` can go, because the helper creates the folder. This is a one-line change in a file this task does not list in `touches`, so either do it here (and note it) or add it to tasks/e2e-suite-red.md and mention it in the criterion-2 skip reason. Running `schema-analysis.e2e` needs MongoDB containers.

## P3 Low

- [ ] **CR-8 | The new fallback test's upper bound leaves about 2 s of headroom**
    - File: `test/e2e/screenshot.e2e.ts:229`
    - Category: Tests
    - Problem: `expect(elapsed).toBeLessThan(9_000)`. The elapsed time is the 5 s Playwright timeout plus `isVisible`, `boundingBox`, 3 x 400 ms repaint rounds and IPC. It measured 6.9 s here on an idle machine. The "not visible" test has a similar fixed cost and measured 6.2 s (round 2: 5.7 s).
    - Why it matters: On a loaded CI runner the extra round-trips can grow by a second or more. That would turn a timing margin into a flaky failure that says nothing about a hang (a real hang would hit the 60 s test timeout anyway).
    - Suggested fix: Raise the bound to about 12-15 s. It still tells "fallback ran once" apart from a hang or retry loop.

- [ ] **CR-9 | The packaged smoke script keeps a direct `page.screenshot()`**
    - File: `apps/desktop/scripts/smoke-packaged.mjs:178`
    - Category: Quality
    - Problem: After the rebase the script attaches over CDP (no `ElectronApplication`), so the harness helper cannot be used there. It relies only on the screen-size switch (CR-3).
    - Why it matters: This is informational. If the packaged smoke test ever hangs headless at the screenshot, a timeout or a `webContents.invalidate()` through CDP would be the next step. It is not required by this task.
    - Suggested fix: No change needed now. Optionally pass `{ timeout: 10_000 }` so that a hang fails fast. Disposition can be "accepted, out of scope".

## Review conclusion

No material issues found in the task's own code. The helper, the round-1 fixes, the new element-fallback test (it really exercises the rect fallback and is deterministic) and the smoke-packaged rebase resolution are correct, and type check, lint and the 9-test screenshot spec pass at fde210bb. Two items still need action before `done`. First, record criterion 2 as skipped with a reason, not as passed (CR-5). Second, convert, or explicitly hand off to e2e-suite-red, the direct `window.screenshot()` that the rebase brought in from main in `test/e2e/schema-analysis.e2e.ts:93` (CR-7). CR-8 and CR-9 are optional.

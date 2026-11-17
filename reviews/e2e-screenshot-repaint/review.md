# Code Review

Date: 2026-11-17

Task: e2e-screenshot-repaint - Test: screenshots after view switches don't hang on headless Linux

Scope: round 4, the whole task at the final code revision 57d430f0. Committed task changes `25ee4e5a..57d430f0` (`git merge-base HEAD origin/main` = 25ee4e5a), without `tasks/` and `reviews/`. Main was rebased in again since round 3, so the hashes changed: the round-3 code commits are now 0116f1d1 (helper, headless screen size, suites use it), 738ec4d4 (architecture notes), e01faffa (test-writer tests), 09d6a3ee (round-1 fixes CR-1..CR-4) and 6d663f73 (round-2 reports and the element-fallback test). 83cd92bb, eb6d09c0 and e6f645a4 only change `tasks/`. The only new code is commit 57d430f0 (CR-7, CR-8), which changes `test/e2e/schema-analysis.e2e.ts` and `test/e2e/screenshot.e2e.ts`. To confirm that nothing else changed, I compared patch-ids: `git diff 25ee4e5a..6d663f73 -- . ':!tasks' ':!reviews'` and the round-3 diff `git diff 9dfc8ad2..fde210bb -- . ':!tasks' ':!reviews'` have the same `git patch-id --stable` (e96389eb...). The base moved from 9dfc8ad2 to 25ee4e5a only through the `verify` and `assume` commits for this task. `git diff fde210bb 57d430f0 -- . ':!tasks' ':!reviews'` contains only the two files above (+6/-6). The working tree was clean apart from this report.

Requirements:
- tasks/e2e-screenshot-repaint.md acceptance criteria (3), the recorded evidence (`python tasks.py verify e2e-screenshot-repaint`) and the criterion-2 assumption
- docs/ARCHITECTURE.md "End-to-end tests"
- AGENTS.md (evidence rules, quality gate)
- reviews/e2e-screenshot-repaint/fixes.md (round 2) and the round-3 review.md
- Parent agent instructions for round 4 (scope 57d430f0, criterion 2 recorded as skipped)

Git range:
- Branch: main
- HEAD: 57d430f08f152c1ba2ce2eb8ff98630638711885 (final code revision)
- Base/start: 25ee4e5a7f522de4d92a4147bbc5b4ac023c90c2 (`git merge-base HEAD origin/main`)
- Commits reviewed: 9 (6 with code: 0116f1d1, 738ec4d4, e01faffa, 09d6a3ee, 6d663f73, 57d430f0; 3 that only change `tasks/`). Re-read in detail this round: 57d430f0.

Summary: 0 P0, 0 P1, 0 P2, 1 P3

Commands I ran at 57d430f0 (no rebuild and no full e2e suite, as the parent agent asked; the app was already built for this revision):
- `npx playwright test screenshot.e2e schema-analysis.e2e --output=/tmp/cr4-shot --reporter=list` -> 10 passed (26.7 s). The element-fallback test took 6.7 s. schema-analysis passed in 1.4 s (MongoDB container fixture). It ran first in the worker, before the screenshot spec's `beforeAll` removes DISPLAY, so it ran with a display. The helper path it uses is covered headless by the screenshot spec.
- `npx tsc -p tsconfig.json` -> pass (no output)
- `npx eslint test/e2e` -> pass (no output)
- `grep -rnE "\.screenshot\(" test/e2e apps/desktop` (excluding `harness/`) -> only `test/e2e/smoke/installer.smoke.ts:128` (the `test:smoke` config, no `ElectronApplication`), `apps/desktop/test/theme.electron.spec.ts:119` (vitest `test:electron`) and `apps/desktop/scripts/smoke-packaged.mjs:178` (CR-9). No `test:e2e` suite calls `page.screenshot()` directly any more.

## Review of the round-4 changes (57d430f0)

- `test/e2e/schema-analysis.e2e.ts`: the test now takes the `electronApp` fixture and calls `await screenshot(electronApp, window, join(SHOTS, 'schema-analysis.png'))` (`:92`). The `mkdir` import and call are gone. That is correct, because the helper creates the output folder ("a page screenshot creates the output folder" test, passing). The path and file name are unchanged. tsc reports no unused imports. The suite passes. This resolves CR-7.
- `test/e2e/screenshot.e2e.ts:232`: the upper bound is now `15_000` ms, and the comment says why. It still tells a single fallback run (about 6-7 s) apart from a hang, which would run into the test timeout. This resolves CR-8.
- Suites that use the helper: aggregation, bulk, collection, conflict, demo/demo, doc-paging, document-edit, explain, indexes, io, layout, m1/demo, safety, schema-analysis, shell, sidebar and validator. That is 17 suites, plus the harness failure screenshots in `fixtures.ts`.

## Findings and their dispositions (CR-1..CR-9 from earlier rounds, CR-10 new)

- CR-1 (P2, round 1, the element fallback captured the whole window or an empty box): resolved in 09d6a3ee (rebased from 1ef7f55d). Covered by the hidden-element and no-match tests, which pass.
- CR-2 (P3, round 1, failure screenshots used `page.screenshot()`): resolved. `fixtures.ts` uses `screenshot()`.
- CR-3 (P3, round 1, the packaged smoke script had a 1x1 headless screen): resolved. `HEADLESS_ARGS` in `smoke-packaged.mjs` is unchanged since round 3.
- CR-4 (P3, round 1, the "started headless" test checked the test process's args): resolved. The test checks `electronApp.process().spawnargs`, and it passes.
- CR-5 (P2, round 2, criterion 2 not met as written): resolved by the agreed disposition. `python tasks.py verify e2e-screenshot-repaint` shows criterion 2 as `[~]` skipped, not ticked. The reason gives the real-display result (57 passed, 3 failed), says the 3 failures (layout page-heading, sidebar drag, LDAP container) do not take screenshots and are tracked in e2e-suite-red, and says no headless full-suite run was done because the session could not unset DISPLAY. The matching ASSUMPTION is recorded in the task notes, and tasks/e2e-suite-red.md depends on this task and includes a headless run. Nothing is claimed as passed that nobody saw. See CR-10 for one inaccuracy in the skip text.
- CR-6 (P3, round 2, no test for the element-crop fallback): resolved in 6d663f73. The test passes again here (6.7 s).
- CR-7 (P2, round 3, `schema-analysis.e2e.ts` took a direct `window.screenshot()`): resolved in 57d430f0 (see above).
- CR-8 (P3, round 3, a tight 9 s bound in the fallback test): resolved in 57d430f0 (15 s).
- CR-9 (P3, round 3, `smoke-packaged.mjs:178` keeps `page.screenshot()`): accepted as out of scope. The script attaches over CDP and has no `ElectronApplication`, so it cannot use the helper. It is not an e2e suite, and the root cause (the 1x1 screen) is fixed there. No change.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-10 | The criterion-2 skip reason was written before CR-7 was fixed, so its suite count and grep claim are out of date**
    - File: `tasks/e2e-screenshot-repaint.md:17`
    - Category: Tests
    - Problem: The skip (recorded 06:29) says "All 16 suites that took screenshots ... now use screenshot(...); grep shows no .screenshot( call outside harness/". At that time `schema-analysis.e2e.ts:93` still called `window.screenshot()`. It was converted 4 minutes later in 57d430f0 (06:33), and 17 suites use the helper now. The statement is true for the final code, but the evidence does not mention schema-analysis or the commit that made it true.
    - Why it matters: This is minor. A human who checks the evidence against the history would find the grep claim false for the revision it was recorded at. The skip itself, and what it does not claim, are correct.
    - Suggested fix: Optional. Re-record criterion 2 with the same `--skip` reason, changed to "17 suites (schema-analysis converted in 57d430f0)", and the 10-passed result from `npx playwright test screenshot.e2e schema-analysis.e2e`. No code change.

## Review conclusion

No material issues found. Commit 57d430f0 resolves CR-7 and CR-8 correctly, and the rest of the task diff is the same as the code reviewed in round 3 (same patch-id). Criterion 2 is recorded as skipped with a reason and an assumption, so CR-5 is resolved by its agreed disposition, and CR-9 is accepted as out of scope. Type check, lint and the screenshot and schema-analysis specs (10 passed) pass at 57d430f0. CR-10 is an optional wording fix to the evidence text.

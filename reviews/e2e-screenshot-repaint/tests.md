# Test Report

Date: 2026-11-17

Task: e2e-screenshot-repaint - Test: screenshots after view switches don't hang on headless Linux (round 2, final code after the fixer)

Scope: `git diff c74ea8166f401f147ac6917a4a7a5ec65cbc789d..HEAD -- . ':!tasks' ':!reviews'`, final code
revision 99a03cbc7d2d85feec57a5bc2b56b191912ee126. The task owns these commits: 2416ed36 (helper, headless screen
size, suites switched), 0758062a (docs), 5bc11db9 (round-1 tests), and 99a03cbc (fixes CR-1..CR-4). The
parent supplied this list, and I checked it with `git show --stat`. The range also includes commits from
other tasks that were rebased under this one (raw-cmd-read-pref backend/integration files). They are not
part of this task and are excluded. Measured at HEAD 95a4d480aefe865c70bc4345bb93feee6b31eb01. The only
commits after 99a03cbc are `tasks/` commits (763a0972, 6524195b, 95a4d480), and
`git diff --stat 99a03cbc..HEAD -- . ':!tasks' ':!reviews'` is empty. Uncommitted input: this round's test
addition in `test/e2e/screenshot.e2e.ts` (sha256 f5a2fa1ce0e993706e51a04640d48e3ed4cb3103f08e96a17d52c5306f0582e8).

Requirements:
- tasks/e2e-screenshot-repaint.md acceptance criteria 1-3
- docs/ARCHITECTURE.md "End-to-end tests" (screenshot helper rule) and "Coverage"
- reviews/e2e-screenshot-repaint/fixes.md (final behaviour: the element fallback runs only for visible
  elements that have a box, and a hidden element or no match rethrows the TimeoutError;
  `screenshotWindows` uses the helper; smoke-packaged screen-size switch; the headless test checks spawnargs)
- parent agent instructions for round 2

## Test files changed

- `test/e2e/screenshot.e2e.ts`

## Tests added or updated

Count: 1 added (this round)

- `a visible element whose capture times out falls back to a repaint capture of just that element`:
  CR-1 removed the round-1 fallback test, which used a hidden box. After that, nothing tested the branch
  the fix keeps: a visible locator with a box whose Playwright capture times out, followed by
  `capturePageWithRepaint()` with the element rect. The new test uses a visible 240x60 box that moves
  3 px on every animation frame. Playwright's element screenshot never sees it stable and times out.
  The test asserts that:
  - the call takes at least 5 s, which proves the timeout and fallback path ran, and less than 9 s;
  - the file holds the returned PNG;
  - the PNG is the element's size (240x60 +/- 1 px), not the whole window;
  - the PNG shows the element's colour.

  If the helper rethrew for visible elements, or captured the whole window, this test would fail.

Existing tests that cover the rest of the final behaviour (no changes needed):
- `an element that is not visible fails with the TimeoutError, not a fallback capture` (CR-1)
- `a locator that matches nothing fails fast with the TimeoutError` (TW-1)
- `the app is started headless with a real screen size`, which checks `electronApp.process().spawnargs` (CR-4)
- `screenshotWindows saves a PNG of the window under test-results/ and attaches it` in
  `harness-helpers.e2e.ts`, which now goes through the helper (CR-2). The parent reports that it passed
  in the full `npm run test:e2e` run with the default output folder.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: after several view switches each screenshot shows the new view and none times out, headless with DISPLAY/WAYLAND_DISPLAY unset | `each screenshot after a view switch shows the new view`, `the app is started headless with a real screen size`, `an element screenshot shows the element in its current state`, `the repaint fallback captures the current view`, `a page screenshot creates the output folder and writes the returned PNG` | `npx playwright test screenshot.e2e --output=/tmp/tw2-e2e-screenshot-final --reporter=line` | Pass (9/9); also `--repeat-each=3` -> 27/27 |
| Helper: a visible element whose capture times out falls back to a repaint capture of the element rect | `a visible element whose capture times out falls back to a repaint capture of just that element` (new) | same | Pass (7.0 s: 5 s timeout + repaint rounds) |
| Helper: a hidden element or a locator with no match rethrows the TimeoutError and writes no file (CR-1, TW-1) | `an element that is not visible fails with the TimeoutError, not a fallback capture`, `a locator that matches nothing fails fast with the TimeoutError` | same | Pass (5.8 s, 6.1 s) |
| Helper: errors other than a timeout are rethrown | `errors other than a timeout are rethrown, not hidden by the fallback` | same | Pass |
| Harness failure screenshots use the helper (CR-2) | `screenshotWindows saves a PNG ...` (harness-helpers.e2e.ts) | parent's `npm run test:e2e` (default output folder) | Pass, as reported by the parent. I did not rerun it: with `--output` its `test-results/` path assertion fails by design |
| AC2: existing suites use the helper; `npm run test:e2e` passes headless | `grep -rn "\.screenshot(" test/e2e` finds no direct call outside `harness/screenshot.ts` | parent's `npm run test:e2e` | Fail as reported by the parent: 57 passed, 3 failed (`layout.e2e.ts:36`, `:61`, `ldap.e2e.ts`; not screenshot-related, follow-up `tasks/e2e-suite-red.md`). I did not rerun it (parent instruction) |
| Packaged smoke uses the headless screen size (CR-3) | none | - | Not run: needs a packaged build, and the parent said not to rebuild |
| AC3: docs/ARCHITECTURE.md explains the helper | documentation | - | Not testable |

## Focused test execution

Command:

`npx playwright test screenshot.e2e --output=/tmp/tw2-e2e-screenshot --reporter=list`

Result:

Pass: 9 passed (32.2 s), 2026-11-17 06:25:14 to 06:25:47 +01:00

Command:

`npx playwright test screenshot.e2e --repeat-each=3 --output=/tmp/tw2-e2e-screenshot-rep --reporter=line`

Result:

Pass: 27 passed (1.2 min). This checks that the new timing-dependent test is stable.

Command (final run, after Prettier reformatted the spec; same test logic):

`npx playwright test screenshot.e2e --output=/tmp/tw2-e2e-screenshot-final --reporter=line`

Result:

Pass: 9 passed (23.1 s), started 2026-11-17 06:27:17 +01:00

Static checks (on the final file):

- `npx tsc -p tsconfig.json`: Pass
- `npx eslint test/e2e`: Pass
- `npx prettier --check test/e2e`: Pass. The first check flagged my new test's line wrapping, and
  `npx prettier --write test/e2e/screenshot.e2e.ts` fixed it before the final run.

## Full test execution

Command:

`npm run test:e2e`

Result:

Not run by me (parent instruction: no full e2e suite). The parent's run on this revision: 57 passed, 3
failed (`layout.e2e.ts:36`, `layout.e2e.ts:61`, `ldap.e2e.ts`). The failures are outside the screenshot
helper and are tracked in `tasks/e2e-suite-red.md`. `harness-helpers.e2e.ts` passed in that run.

## .taskcheck

Result:

Not run. It runs `npm run check` (lint, type check, Vitest unit tests). This round changed only an e2e
spec, and I ran its type check, lint and formatting directly above. The parent runs `.taskcheck` before
`done`.

## Bugs found

No production defects found in the task's harness code.

Observation (outside this task's diff, no finding): `apps/desktop/scripts/smoke-packaged.mjs:59` and
`apps/desktop/test/theme.electron.spec.ts:119` still call `page.screenshot()` directly. Neither file is
in `test/e2e`, which is what AC2 names ("existing e2e suites"). The smoke script now gets the headless
screen size (CR-3), and that switch alone lets the window paint. The parent decides whether these need
follow-up.

## Coverage

Status: unavailable. The task-changed production files are Playwright e2e harness code and launch
scripts. The project's only coverage tooling is Vitest with `@vitest/coverage-v8` (docs/ARCHITECTURE.md
"Coverage"), and it instruments only code that the workspace Vitest projects run. These files run under
the Playwright test runner, and the core of the helper (`invalidate()` / `capturePage()` loop, window
size check) runs inside the Electron main process through `JSHandle.evaluate()`, which no configured
provider instruments. No Playwright or Electron coverage provider is configured, and adding one is a
configuration change outside the test-writer's authority.

Metric: whole-file coverage of task-changed production files: not measured.
Changed-line coverage: not measured (no provider for these files).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: e2e-screenshot-repaint; base c74ea8166f401f147ac6917a4a7a5ec65cbc789d; measured HEAD 95a4d480aefe865c70bc4345bb93feee6b31eb01 (code identical to 99a03cbc); task commits 2416ed36, 0758062a, 5bc11db9, 99a03cbc (from the parent, checked with `git show --stat`)
- Source/test snapshot identifier (including uncommitted inputs): HEAD 95a4d480 plus `test/e2e/screenshot.e2e.ts` sha256 f5a2fa1ce0e993706e51a04640d48e3ed4cb3103f08e96a17d52c5306f0582e8; `test/e2e/harness/screenshot.ts` sha256 9bf407cda2086cdae33944f367736226f1606e6e394982863ae02540646b61ca (unchanged before and after the final run); `test/e2e/harness/fixtures.ts` sha256 09fef9d8b449374ef1a5a2d5c645800a8cbb824cbebfb93af4e7781ee6f34965
- Exact included files; renamed/deleted/excluded files and reasons: in scope `test/e2e/harness/screenshot.ts`, `test/e2e/harness/app.ts`, `test/e2e/harness/fixtures.ts`, `test/e2e/harness/index.ts`, `apps/desktop/test/helpers.ts`, `apps/desktop/scripts/smoke-packaged.mjs`. Excluded: the e2e suites (tests), `docs/ARCHITECTURE.md` (docs), and the backend/integration files of other tasks in the range (raw-cmd-read-pref and import.ts; not task-owned). No renames or deletions
- Provider/version, command, working directory, and test selection: none (no provider for Playwright/Electron code). Behaviour was verified with Playwright 1.65.1 (`npx playwright test screenshot.e2e`), working directory is the repo root
- Run start/completion time and exit status: no coverage run
- Generated report paths and report hashes/run identifier: none
- Evidence outputs are fresh and inputs stayed unchanged: the test runs above are on the snapshot listed, and the hashes were the same before and after the final run
- Final run after latest test additions and production fixes: yes for tests (final run after the fixer's 99a03cbc and this round's addition); no coverage run

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `test/e2e/harness/screenshot.ts` | N/A (not measured) | N/A | N/A | N/A |
| `test/e2e/harness/app.ts` | N/A (not measured) | N/A | N/A | N/A |
| `test/e2e/harness/fixtures.ts` | N/A (not measured) | N/A | N/A | N/A |
| `test/e2e/harness/index.ts` | N/A (not measured) | N/A | N/A | N/A |
| `apps/desktop/test/helpers.ts` | N/A (not measured) | N/A | N/A | N/A |
| `apps/desktop/scripts/smoke-packaged.mjs` | N/A (not measured) | N/A | N/A | N/A |

No aggregate is reported because no file was measured.

These branches were checked by inspection and by the tests that exercise them, not by instrumentation:

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `test/e2e/harness/screenshot.ts:49-50` Playwright capture succeeds | AC1, current view without a hang | `each screenshot after a view switch ...`, `an element screenshot ...`, `a page screenshot ...` |
| `test/e2e/harness/screenshot.ts:52` non-TimeoutError rethrow | failures must not be hidden | `errors other than a timeout are rethrown ...` |
| `test/e2e/harness/screenshot.ts:55-58` locator: visible + box -> fallback with rect | fallback shows the current element | new test `a visible element whose capture times out falls back ...` |
| `test/e2e/harness/screenshot.ts:57`, `105-111` hidden or no match -> rethrow (incl. `visibleBox` catch / null) | CR-1, TW-1 | `an element that is not visible fails ...`, `a locator that matches nothing fails fast ...` |
| `test/e2e/harness/screenshot.ts:60-62` Page target timeout -> whole-window fallback | fallback for a window that never sends a frame | Not reached through `screenshot()`: a page capture times out only when the window paints no frame, and the headless screen size prevents that in this harness. `capturePageWithRepaint()` itself is tested directly (`the repaint fallback captures the current view`). Gap left on purpose |
| `test/e2e/harness/screenshot.ts:44` `setContentSize(1280, 800)` for a window under 100 px | defensive | Not reachable without removing the harness's launch switch; left untested |
| `test/e2e/harness/fixtures.ts:49` `screenshotWindows` -> helper (CR-2) | failure screenshots | `screenshotWindows saves a PNG ...` (parent's full run) |
| `apps/desktop/scripts/smoke-packaged.mjs:34` screen-size switch (CR-3) | packaged smoke paints headless | Not run: needs a packaged build |

## Unable to test

- Packaged smoke script (CR-3): it needs a packaged build, and I was told not to rebuild. Follow-up:
  confirm it in the next packaged smoke run.
- AC2 full `npm run test:e2e`: I did not run it (instruction). The parent's run has 3 failures that are
  not screenshot-related, tracked in `tasks/e2e-suite-red.md`. The parent decides how AC2 is recorded.
- `harness-helpers.e2e.ts` `test-results/` path tests: these fail under `--output` by design, so they
  need the default-output run (the parent's full run, where they passed).
- Coverage: no provider for Playwright/Electron harness code (see Coverage).

## Summary

Tests added and focused validation passed (9/9, plus 27/27 with `--repeat-each=3`); no production
defects found. The new test closes the one real gap left by the CR-1 fix: the fallback path for a
visible element with a box. AC2's full suite is still red for 3 tests that are not screenshot-related,
so the parent has to record that result. Coverage is unavailable for Playwright harness code.

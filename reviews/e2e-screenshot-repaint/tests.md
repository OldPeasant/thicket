# Test Report

Date: 2026-11-17

Task: e2e-screenshot-repaint - Test: screenshots after view switches don't hang on headless Linux

Scope: `git diff c74ea8166f401f147ac6917a4a7a5ec65cbc789d..HEAD`, task commits 5a7801c and 0370640.
While testing, main was rebased under the task: the same commits are now 2416ed36 and 0758062a (HEAD
0758062addc8afc0c9114ec96fa97b4e688f641b, parent 240c9b11). `git patch-id --stable` of
`git diff c74ea81 0370640` and `git diff 240c9b11 0758062a` are identical
(de30338ecadc77180bf13417722a90a4f149ff22), so the tested code change is the same.
Uncommitted input: this report's test additions in `test/e2e/screenshot.e2e.ts`
(sha256 3a8847a9bcde717d98125fad5ba8c8d1debb821d12e7cc6b44c06d0199b5c2a3).

Requirements:
- tasks/e2e-screenshot-repaint.md acceptance criteria 1-3
- docs/ARCHITECTURE.md (e2e section, Coverage section)
- parent agent instructions (gaps to consider: timeout fallback end to end, locator + rect fallback,
  non-timeout errors rethrown, output folder creation)

## Test files changed

- `test/e2e/screenshot.e2e.ts`

## Tests added or updated

Count: 3 added (in the `screenshot() on headless Linux` describe, which unsets DISPLAY,
WAYLAND_DISPLAY and THICKET_TEST_HEADLESS for the app it starts):

- `when Playwright times out, screenshot() falls back to a repaint capture of the element` - a laid-out
  `visibility:hidden` 240x60 box: Playwright's element screenshot times out (TimeoutError after 5 s),
  the helper falls back to `capturePageWithRepaint()` with the element's bounding box; asserts the PNG
  is the element's size (not the whole window), the file is written, the nested output folder is
  created, and the file holds the returned PNG. Exercises the timeout branch, the locator + rect path
  and the rect rounding in `capturePageWithRepaint()` end to end.
- `a page screenshot creates the output folder and writes the returned PNG` - nested non-existent
  folder for a page capture; file content equals the returned buffer; the marker colour is shown.
- `errors other than a timeout are rethrown, not hidden by the fallback` - an ambiguous locator
  (`button`, several matches): the strict-mode error is rethrown within 4 s (no 5 s timeout, no repaint
  rounds) and no file is written.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: after several view switches each screenshot shows the new view, none times out, headless with DISPLAY/WAYLAND_DISPLAY unset | `each screenshot after a view switch shows the new view`, `the app is started headless with a real screen size`, `an element screenshot shows the element in its current state`, `the repaint fallback captures the current view` (existing) | `npx playwright test screenshot.e2e --output=/tmp/tw-e2e-screenshot-results` | Pass (7/7) |
| Helper fallback on Playwright timeout (element rect), output folder, returned PNG = file | the 2 new fallback/folder tests | same | Pass |
| Non-timeout errors are not swallowed by the fallback | `errors other than a timeout are rethrown, not hidden by the fallback` | same | Pass |
| headlessArgs adds `--ozone-override-screen-size=1920,1080` with the headless switch | `headlessArgs` describe in `harness-helpers.e2e.ts` (existing, updated by the task) | `npx playwright test screenshot.e2e harness-helpers --output=/tmp/tw-e2e-screenshot-results` | Pass |
| AC2: existing suites use the helper; `npm run test:e2e` passes headless | not run by the test-writer (parent's full run was in progress in this clone; instructed not to run the full suite) | - | Not run: parent runs the full `npm run test:e2e` |
| AC3: docs/ARCHITECTURE.md e2e section explains the helper | documentation, no executable behavior | - | Not testable |

## Focused test execution

Command:

`npx playwright test screenshot.e2e harness-helpers --output=/tmp/tw-e2e-screenshot-results`

Result:

Fail as a run (17 passed, 2 failed), but the 2 failures are caused only by the `--output` override:
`screenshotWindows saves a PNG of the window under test-results/ and attaches it` and
`a failing test leaves a window screenshot and the app output under test-results/` assert the output
path starts with `test-results/`. `--output` was used so this run would not wipe the `test-results/`
of the parent's concurrent full e2e run (Playwright clears its output folder at start). These two tests
are outside the task diff; they should be confirmed by the parent's full run with the default output
folder. All `headlessArgs` and `screenshot.e2e` tests passed.

Command:

`npx playwright test screenshot.e2e --output=/tmp/tw-e2e-screenshot-results --reporter=list`

Result:

Pass - 7 passed (12.6 s); the timeout-fallback test takes 6.8 s (5 s Playwright timeout + 3 x 400 ms
repaint rounds), the others are under 2 s.

Static checks:

- `npx tsc -p tsconfig.json` - Pass
- `npx eslint test/e2e` - Pass
- `npx prettier --check test/e2e` - Pass

## Full test execution

Command:

`npm run test:e2e`

Result:

Not run by the test-writer: the parent's full headless run was in progress in this clone and the
instructions forbid a rebuild or a second full run.

## .taskcheck

Result:

Not run (`npm run check` covers lint, type check and Vitest unit tests; the task changes only e2e
harness files, whose type check, lint and formatting were run directly above). The parent runs
`.taskcheck` before `done`.

## Bugs found

No production defects found.

Observation (not a defect against the criteria, no test added): for a locator that matches no element,
`locator.screenshot()` times out after 5 s and the fallback then calls `locator.boundingBox()`, which
waits with Playwright's default action timeout (none in this config) - so `screenshot()` of a missing
element would hang until the test timeout instead of failing quickly. A caller error, not a case the
task requires; the parent may decide whether to pass a timeout to `boundingBox()`.

## Coverage

Status: unavailable - the changed production files are Playwright e2e harness code
(`test/e2e/harness/screenshot.ts`, `test/e2e/harness/app.ts`, `apps/desktop/test/helpers.ts`). The
project's only coverage tooling is Vitest with `@vitest/coverage-v8` (docs/ARCHITECTURE.md
"Coverage"), which instruments workspace unit tests, not code run by the Playwright runner; and the
helper's core runs inside the Electron main process via `evaluate()`. No coverage provider is
configured for Playwright, and adding one is outside the test-writer's authority.

Metric: whole-file coverage of task-changed production files - not measured.
Changed-line coverage: not measured.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: e2e-screenshot-repaint; base c74ea8166f401f147ac6917a4a7a5ec65cbc789d; HEAD 0758062addc8afc0c9114ec96fa97b4e688f641b; task commits from the parent (5a7801c, 0370640, rebased to 2416ed36, 0758062a with the same patch-id)
- Source/test snapshot identifier (including uncommitted inputs): HEAD 0758062a plus `test/e2e/screenshot.e2e.ts` sha256 3a8847a9bcde717d98125fad5ba8c8d1debb821d12e7cc6b44c06d0199b5c2a3; `test/e2e/harness/screenshot.ts` sha256 43f1e301ce9240d2b57ebe235ccaa28ea8dbf43501647dce63da9fd0a6aa8e21
- Exact included files; renamed/deleted/excluded files and reasons: in scope `test/e2e/harness/screenshot.ts`, `test/e2e/harness/app.ts`, `test/e2e/harness/index.ts`, `apps/desktop/test/helpers.ts`; excluded: the e2e suites (tests), `docs/ARCHITECTURE.md` (docs); no renames or deletions
- Provider/version, command, working directory, and test selection: none (no Playwright coverage provider); behavior verified with Playwright 1.65.1, commands above, repo root
- Run start/completion time and exit status: no coverage run
- Generated report paths and report hashes/run identifier: none
- Evidence outputs are fresh and inputs stayed unchanged: test runs were on the snapshot above
- Final run after latest test additions and production fixes: yes (tests); no coverage run

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `test/e2e/harness/screenshot.ts` | N/A (not measured) | N/A | N/A | N/A |
| `test/e2e/harness/app.ts` | N/A (not measured) | N/A | N/A | N/A |
| `test/e2e/harness/index.ts` | N/A (not measured) | N/A | N/A | N/A |
| `apps/desktop/test/helpers.ts` | N/A (not measured) | N/A | N/A | N/A |

Behavioral coverage of the branches by inspection (not instrumented):

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `test/e2e/harness/screenshot.ts` `screenshot()` timeout catch + fallback with locator rect | fallback must show the current state when Playwright hangs | new test `when Playwright times out, screenshot() falls back ...` |
| `test/e2e/harness/screenshot.ts` non-TimeoutError rethrow | failures must not be hidden | new test `errors other than a timeout are rethrown ...` |
| `test/e2e/harness/screenshot.ts` `mkdir` of the output folder | screenshots into new folders (final-demo) | both new tests use nested new folders |
| `test/e2e/harness/screenshot.ts` `setContentSize(1280, 800)` when the window is under 100 px | defensive; with `--ozone-override-screen-size` the window is never collapsed | not reachable without breaking the harness's launch args; left untested |
| `test/e2e/harness/screenshot.ts` fallback when `boundingBox()` is null (element gone) | caller error | not tested; see observation under Bugs found |
| `apps/desktop/test/helpers.ts` `headlessArgs()` | same switch as the harness copy | no test of its own in the diff; identical logic to the tested `test/e2e/harness/app.ts` copy; used by the desktop app's own tests |

## Unable to test

- AC2 full `npm run test:e2e` headless: not run here (concurrent parent run); the parent must record its result.
- The two `test-results/`-path tests in `harness-helpers.e2e.ts` could not pass with `--output` redirected; they need the parent's default-output run.
- Coverage: no coverage tooling for Playwright e2e code (see Coverage).

## Summary

Tests added and all focused validation passed (apart from two path assertions that fail only because
of the redirected `--output`); no production defects found. The full `npm run test:e2e` run (AC2) and
`.taskcheck` remain for the parent.

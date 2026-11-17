# Test Report

Date: 2026-11-17

Task: e2e-screenshot-repaint - Test: screenshots after view switches don't hang on headless Linux (round 3, final code revision 57d430f08f152c1ba2ce2eb8ff98630638711885)

Scope: `git diff 25ee4e5a7f522de4d92a4147bbc5b4ac023c90c2..57d430f08f152c1ba2ce2eb8ff98630638711885 -- . ':!tasks' ':!reviews'`.
The base is `git merge-base HEAD origin/main` = 25ee4e5a7f522de4d92a4147bbc5b4ac023c90c2, after main was rebased in.
The task owns these commits, as checked with `git log` / `git show --stat`:
- 0116f1d1: helper, headless screen size, suites switched
- 738ec4d4: docs
- e01faffa: round-1 tests
- 09d6a3ee: fixes CR-1..CR-4, plus the rebase resolution of `smoke-packaged.mjs`
- 6d663f73: round-2 test
- 57d430f0: CR-7 and CR-8

After the rebase, every commit in the range belongs to this task. The rebase removed the unrelated
backend files that round 2 had to exclude. Measured at HEAD 57d430f0 with a clean working tree. This
round has no uncommitted inputs.

What changed since round 2 (99a03cbc / 6d663f73):
- `apps/desktop/scripts/smoke-packaged.mjs`: the rebase conflict was resolved with
  `HEADLESS_ARGS = ['--ozone-platform=headless', '--ozone-override-screen-size=1920,1080']`. Both
  launches use it: the run-as-node probe at line 97 and the CDP launch at line 150.
- `test/e2e/schema-analysis.e2e.ts`: now calls `screenshot(electronApp, window, path)` in place of
  `mkdir` plus `window.screenshot` (CR-7).
- `test/e2e/screenshot.e2e.ts`: the fallback test's upper time bound changed from 9 s to 15 s (CR-8).
  The lower bound (>= 5 s, which proves the timeout and fallback path ran) and the checks on the
  element size and colour are unchanged.

Requirements:
- tasks/e2e-screenshot-repaint.md acceptance criteria 1-3
- docs/ARCHITECTURE.md "End-to-end tests" (screenshot helper rule) and "Coverage"
- reviews/e2e-screenshot-repaint/fixes.md (CR-1..CR-4, CR-7, CR-8)
- parent agent instructions for round 3

## Test files changed

None this round. I edited no test file. The test changes in 57d430f0 were made by the fixer, and I
reviewed and ran them.

## Tests added or updated

Count: 0

The existing tests still cover the final behaviour, so I found no real gap:
- `schema-analysis.e2e.ts` now goes through the helper (CR-7). Its own test ran and passed, and it
  writes its screenshot with `screenshot()`.
- After CR-8, the fallback test still proves that the fallback path ran (elapsed time >= 5 s, so
  Playwright's 5 s timeout was hit). It still checks that the PNG is the element's rectangle in the
  element's colour. A hang would still fail it, through the 15 s bound or the test timeout.
- `grep -rn "\.screenshot(" test/e2e` finds a direct call only in `test/e2e/harness/screenshot.ts`
  and in `test/e2e/smoke/installer.smoke.ts:128`. The installer smoke test is not a `*.e2e.ts` suite
  (the Playwright config sets `testMatch: '**/*.e2e.ts'`). It attaches over CDP without an
  `ElectronApplication`, so it cannot use the helper. It is outside this task's diff.
- `smoke-packaged.mjs` HEADLESS_ARGS: no automated test exists, and running the script needs a
  packaged build (see "Unable to test").

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: after several view switches each screenshot shows the new view and none times out, headless with DISPLAY/WAYLAND_DISPLAY unset | `the app is started headless with a real screen size`, `each screenshot after a view switch shows the new view`, `an element screenshot shows the element in its current state`, `a page screenshot creates the output folder and writes the returned PNG`, `the repaint fallback captures the current view` | `npx playwright test screenshot.e2e schema-analysis.e2e harness-helpers --output=/tmp/tw3-e2e-screenshot` | Pass |
| Helper: a visible element whose capture times out falls back to a repaint capture of the element rect (CR-8 bound) | `a visible element whose capture times out falls back to a repaint capture of just that element` | same | Pass (6.7 s) |
| Helper: a hidden element or a locator with no match rethrows the TimeoutError (CR-1, TW-1) | `an element that is not visible fails with the TimeoutError, not a fallback capture`, `a locator that matches nothing fails fast with the TimeoutError` | same | Pass (5.7 s, 5.5 s) |
| Helper: errors other than a timeout are rethrown | `errors other than a timeout are rethrown, not hidden by the fallback` | same | Pass |
| AC2 (part): schema-analysis suite uses the helper (CR-7) | `schema analysis: shares per type, click a value or a type to set the filter` | same | Pass (1.6 s) |
| headlessArgs adds the headless switches (harness) | `headlessArgs › ...` (3 tests) | same | Pass |
| Harness failure screenshots use the helper (CR-2) | `screenshotWindows saves a PNG of the window under test-results/ and attaches it` | same | Fail by design under `--output`: line 164 asserts the PNG path starts with `test-results/`, and `--output` moves it to `/tmp`. The `window 0` PNG was produced and attached before that assertion. It needs a default-output run, and the parent's earlier `npm run test:e2e` run passed it |
| Failure fixture leaves a screenshot under test-results/ | `a failing test leaves a window screenshot and the app output under test-results/` | same | Fail by design under `--output` (line 210 asserts `test-results/`); not screenshot logic |
| AC2: all suites use the helper; `npm run test:e2e` passes headless | grep (above) | parent's `npm run test:e2e` | Not run by me (instruction: no full suite). As the parent reported: 57 passed, 3 failed, none screenshot-related (`layout.e2e.ts:36`, `:61`, `ldap.e2e.ts`; `tasks/e2e-suite-red.md`) |
| Packaged smoke uses the headless screen size (CR-3, HEADLESS_ARGS after the rebase) | none | - | Not run: needs a packaged build (no rebuild allowed) |
| AC3: docs/ARCHITECTURE.md explains the helper | documentation | - | Not testable |

## Focused test execution

Command:

`npx playwright test screenshot.e2e schema-analysis.e2e harness-helpers --output=/tmp/tw3-e2e-screenshot`

Result:

Fail (exit 1), as expected under `--output`: 20 passed and 2 failed (27.9 s, 22 tests, 1 worker,
started at about 06:33:35 +01:00). The two failures are the `harness-helpers.e2e.ts` tests at lines 155
and 207. They assert that their output lies under `test-results/`, which `--output=/tmp/...` changes
by design. All screenshot.e2e (9/9), schema-analysis (1/1) and the other harness-helpers tests (10/10)
passed.

Static checks (each run as a separate command, exit 0):

- `npx tsc -p tsconfig.json`: Pass. The root tsconfig includes `test/e2e/**/*.ts`.
- `npx eslint test/e2e`: Pass, no output.
- `npx prettier --check test/e2e`: Pass ("All matched files use Prettier code style!").

## Full test execution

Command:

`npm run test:e2e`

Result:

Not run (parent instruction: no full suite, and another agent may be running Playwright). The parent's
earlier run, before the rebase: 57 passed, 3 failed. None of the failures are screenshot-related, and
they are tracked in `tasks/e2e-suite-red.md`.

## .taskcheck

Result:

Not run. It runs `npm run check` (lint, type check, Vitest unit tests). This round changed no file, and
the type check, e2e lint and formatting checks were run directly above. The parent runs `.taskcheck`
before `done`.

## Bugs found

No production defects found.

Observation (outside this task's diff, no finding): `apps/desktop/test/theme.electron.spec.ts:119`,
`apps/desktop/scripts/smoke-packaged.mjs:178` and `test/e2e/smoke/installer.smoke.ts:128` call
`page.screenshot()` directly. None of them is a `test/e2e/*.e2e.ts` suite. The two smoke scripts attach
over CDP, without an `ElectronApplication`. The smoke script gets the headless screen size through
`HEADLESS_ARGS`.

## Coverage

Status: unavailable. The task-changed production files are Playwright e2e harness code and a Node
launch script. The project's only coverage tooling is Vitest with `@vitest/coverage-v8`
(docs/ARCHITECTURE.md "Coverage"), and it instruments only code that the workspace Vitest projects
run. These files run under the Playwright test runner or as a standalone Node script. The core of the
helper (`invalidate()` / `capturePage()` loop, window-size check) runs inside the Electron main
process through `JSHandle.evaluate()`, which no configured provider instruments. No Playwright or
Electron coverage provider is configured, and adding one would be a configuration change outside the
test-writer's authority.

Metric: whole-file coverage of task-changed production files: not measured.
Changed-line coverage: not measured (no provider for these files).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: e2e-screenshot-repaint; base 25ee4e5a7f522de4d92a4147bbc5b4ac023c90c2 (`git merge-base HEAD origin/main`); measured HEAD 57d430f08f152c1ba2ce2eb8ff98630638711885; task commits 0116f1d1, 738ec4d4, e01faffa, 09d6a3ee, 6d663f73, 57d430f0 (`git log`, `git show --stat`; every non-`tasks/` commit in base..HEAD)
- Source/test snapshot identifier (including uncommitted inputs): HEAD 57d430f0 with a clean tree. sha256 values: `test/e2e/harness/screenshot.ts` 9bf407cda2086cdae33944f367736226f1606e6e394982863ae02540646b61ca, `test/e2e/screenshot.e2e.ts` c45096594b8a0de46c6652727185a21fe920bc39d0244f2260f76ba4b4ca591c, `test/e2e/schema-analysis.e2e.ts` 6729b1d9d24b15836874a678f7308425478b08c2f6387a9df360f4483b16a830, `test/e2e/harness-helpers.e2e.ts` 0fcf1a46ddc58715ab36bd2d1ebae5a249bd5d76e2191da9b125d487cf7f5281, `apps/desktop/scripts/smoke-packaged.mjs` f98632ba439bc9cff81d8fcdb814f67af57bcb8edaa2d3385039f07d173895e5, `test/e2e/harness/app.ts` 8f7877b34674858598d4927a637dcc81390e752d11513594b6f33e479202cbec, `test/e2e/harness/fixtures.ts` 09fef9d8b449374ef1a5a2d5c645800a8cbb824cbebfb93af4e7781ee6f34965, `test/e2e/harness/index.ts` 1f906096281232f92d9d176788f2c1cd99b25f6450c80d4c023c29c516597f64, `apps/desktop/test/helpers.ts` bc86076be4f46c8bcdac8a1cd0dd8676291d1b26ef682cb8bbc3870fa6b51814
- Exact included files; renamed/deleted/excluded files and reasons: in scope `test/e2e/harness/screenshot.ts`, `test/e2e/harness/app.ts`, `test/e2e/harness/fixtures.ts`, `test/e2e/harness/index.ts`, `apps/desktop/test/helpers.ts`, `apps/desktop/scripts/smoke-packaged.mjs`. Excluded: the `*.e2e.ts` suites (tests) and `docs/ARCHITECTURE.md` (docs). No renames or deletions
- Provider/version, command, working directory, and test selection: none (no provider for Playwright/Electron code). Behaviour was verified with `npx playwright test screenshot.e2e schema-analysis.e2e harness-helpers --output=/tmp/tw3-e2e-screenshot` from the repo root
- Run start/completion time and exit status: no coverage run. The test run took 27.9 s, about 06:33:35 to 06:34 +01:00, and exited 1 (the 2 expected `--output` failures)
- Generated report paths and report hashes/run identifier: none for coverage; Playwright output in `/tmp/tw3-e2e-screenshot`
- Evidence outputs are fresh and inputs stayed unchanged: the hashes above were the same before the run (06:33:31) and after the static checks (06:34:17), and `git status` stayed clean
- Final run after latest test additions and production fixes: yes, on the final revision 57d430f0; no coverage run

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
| `test/e2e/harness/screenshot.ts:49-50` Playwright capture succeeds | AC1, current view without a hang | `each screenshot after a view switch ...`, `an element screenshot ...`, `a page screenshot ...`, schema-analysis test |
| `test/e2e/harness/screenshot.ts:52` non-TimeoutError rethrow | failures must not be hidden | `errors other than a timeout are rethrown ...` |
| `test/e2e/harness/screenshot.ts:55-58` locator: visible + box -> fallback with rect | fallback shows the current element | `a visible element whose capture times out falls back ...` |
| `test/e2e/harness/screenshot.ts:57`, `105-111` hidden or no match -> rethrow | CR-1, TW-1 | `an element that is not visible fails ...`, `a locator that matches nothing fails fast ...` |
| `test/e2e/harness/screenshot.ts:60-62` Page target timeout -> whole-window fallback | fallback for a window that never sends a frame | Not reached through `screenshot()`: the headless screen size prevents a page capture from timing out in this harness. `capturePageWithRepaint()` is tested directly (`the repaint fallback captures the current view`). Gap left on purpose |
| `test/e2e/harness/screenshot.ts:44` `setContentSize(1280, 800)` for a window under 100 px | defensive | Not reachable without removing the harness launch switch; left untested |
| `test/e2e/harness/fixtures.ts:49` `screenshotWindows` -> helper (CR-2) | failure screenshots | `screenshotWindows saves a PNG ...`: this run shows the PNG was produced and attached, but the test fails at its `test-results/` path assertion under `--output`. Full pass in the parent's default-output run |
| `apps/desktop/scripts/smoke-packaged.mjs:48, 97, 150` HEADLESS_ARGS on both launches (CR-3, rebase resolution) | packaged smoke paints headless | Checked by inspection. Not run: needs a packaged build |

## Unable to test

- Packaged smoke script (`HEADLESS_ARGS` after the rebase): it needs a packaged build, and I was told
  not to rebuild. Follow-up: confirm it in the next packaged smoke run, for example in release CI.
- AC2 full `npm run test:e2e` headless: not run (instruction). The parent records AC2 as skipped with an
  assumption. `tasks/e2e-suite-red.md` includes a headless run.
- The two `harness-helpers.e2e.ts` `test-results/` path tests: they fail under `--output` by design and
  need a default-output run.
- Coverage: no provider for Playwright/Electron harness code (see Coverage).

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. I added no tests in round
3: the existing tests cover the final behaviour, including the schema-analysis switch to the helper
(CR-7) and the wider fallback bound (CR-8). On 57d430f0, screenshot.e2e passed 9/9, schema-analysis
1/1 and harness-helpers 10/12; the 2 harness-helpers failures are expected under `--output`. tsc,
eslint and prettier are clean. Coverage is unavailable for Playwright harness code. AC2's full
headless suite and the packaged smoke run remain unverified, as listed above.

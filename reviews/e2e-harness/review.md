# Code Review

Date: 2026-11-16

Task: e2e-harness - M0: Playwright end-to-end harness for the Electron app

Scope: the whole task diff on the final code, `git diff 256ba63..493a462` (the base is `git merge-base HEAD origin/main`). Committed changes only. This is the second review. It re-checks the earlier findings CR-1 to CR-3 against the fixes and the test-writer's additions.

Requirements:
- tasks/e2e-harness.md: the 3 acceptance criteria and recorded assumptions #1 to #3
- SPEC.md (e2e with Playwright's Electron support, `npm run test:e2e`)
- docs/ARCHITECTURE.md ("End-to-end tests", layout, test commands)
- AGENTS.md (evidence rules, secrets policy)
- reviews/e2e-harness/fixes.md, reviews/e2e-harness/tests.md (claims cross-checked against the code)

Git range:
- Branch: main
- HEAD: 493a462
- Base/start: 256ba63f444fc3985593a0f437941f469979bcf6
- Commits reviewed: 4 (e612866, 1d4f585, 175eb87, 493a462)
- Uncommitted changes: none (`git status --short` is empty)

Summary: 0 P0, 0 P1, 1 P2, 1 P3

## Status of earlier findings

- CR-1 (no test of the screenshot-on-failure path): resolved in code. `test/e2e/harness-helpers.e2e.ts:205-239` runs a nested Playwright process on `test/e2e/failure-fixture/` and checks four things: the failing test has status `failed`; it has a `window 0` PNG attachment and an `app output` attachment; exactly one `failure-window-0.png` exists, in the failing test's folder under the outer `test-results/` folder; the passing test has no screenshot. The root config's `**/*.e2e.ts` match does not pick up `*.fixture.ts`, and `git check-ignore -v` confirms that both `test-results/...` and `test/e2e/failure-fixture/test-results/...` are ignored by `.gitignore:7`. Criterion evidence is still to be recorded (see CR-1 below).
- CR-2 (`playwright-core` import in the root harness): fixed. `test/e2e/harness/app.ts:7` and `test/e2e/harness/fixtures.ts:1-7` now import from `@playwright/test`. No file under `test/e2e` imports `playwright-core`.
- CR-3 (launch helpers duplicated): addressed as suggested. Each copy now has a "keep in sync" comment pointing to the other (`test/e2e/harness/app.ts:13-14`, `apps/desktop/test/helpers.ts:18-19`).

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | Criterion 1 names `xvfb-run` on Linux, but no recorded run used it, and the two helper reports disagree on how the app ran**
    - File: `tasks/e2e-harness.md:14`, `reviews/e2e-harness/tests.md:53`, `reviews/e2e-harness/fixes.md:62`
    - Category: Tests
    - Problem: `python tasks.py verify e2e-harness` shows all three criteria unverified. Criterion 1 is "`npm run test:e2e` builds the app and a smoke test sees the main window title (xvfb-run on Linux)". tests.md says the run used the session's Wayland display and was "Not run under `xvfb-run`". fixes.md says there was "no xvfb-run on this host and no display, so the harness used headless Ozone". Neither run is the configuration the criterion names, and the two reports contradict each other about the display mode.
    - Why it matters: the AGENTS.md Evidence rules require running what the criterion names. A display-session run or a headless-Ozone run is not evidence for the xvfb-run configuration. Recording either one as if it were would be a claimed-without-evidence criterion.
    - Suggested fix: if `xvfb-run` is available, run `xvfb-run -a npm run test:e2e` and record the command and its pass count for criteria 1 to 3. If it is not available, record what actually ran (`npm run test:e2e` with the display mode actually used and the pass count). Then mark the xvfb-run part with `verify --skip` plus a `tasks.py assume` line, and don't tick it as met. For criterion 3, the evidence can cite the nested-run test `a failing test leaves a window screenshot and the app output under test-results/` together with `git check-ignore -v test-results/x.png`.

## P3 Low

- [ ] **CR-2 | Missing comma in the tsconfig description**
    - File: `tsconfig.json:2`
    - Category: Quality
    - Problem: the description reads "Type checks the root config files test/integration and test/e2e". Without a comma after "root config files", it reads as though "test/integration" were a config file.
    - Why it matters: this is minor, but the comment exists only to explain what the file covers.
    - Suggested fix: "Type checks the root config files, test/integration and test/e2e; ...".

## Notes (not findings)

- I verified these myself on 493a462. Each passed:
  - `npx tsc -p tsconfig.json`
  - `npx eslint --max-warnings 0 test/e2e playwright.config.ts apps/desktop/test/helpers.ts`
  - `npx prettier --check test/e2e playwright.config.ts tsconfig.json apps/desktop/test/helpers.ts`

  `npx playwright test --list` listed 17 tests in 3 files. I did not run `npm run test:e2e`, because a test-writer was running it at the same time.
- The design matches criteria 2 and 3:
  - a fresh `mkdtemp` userData folder for each test, passed as `THICKET_USER_DATA` and deleted afterwards;
  - a snapshot of the real userData folder compared after `app.close()` for every `electronApp` test;
  - Electron's own `appData` + `getName()` cross-checked in `smoke.e2e.ts`;
  - screenshots and app output attached only when `testInfo.status !== testInfo.expectedStatus`.
- `harness-helpers.e2e.ts` changes `process.env` inside the worker (`withEnv`) and restores it in `finally`. With `workers: 1` and no `fullyParallel`, this cannot leak into a concurrent app launch.
- I found no secrets in the diff. The TLS CA for mongo fixtures is generated at test time and written to a temp file with mode 0600.

## Review conclusion

No material issues found in the code. Before `done`, record criterion evidence that matches the configuration actually run (CR-1). CR-2 is an optional cleanup.

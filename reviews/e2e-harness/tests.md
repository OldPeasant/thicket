# Test Report

Date: 2026-11-16

Task: e2e-harness - M0: Playwright end-to-end harness for the Electron app

Scope: base `d2cfcda47be09358ba6bee618ec86aaadc71ce68` .. HEAD `1d4f585aebc298b5be4ee5ec73135ff84dfbf82a` (branch `main`). The parent supplied the task commits `cf3eddf` (harness, `npm run test:e2e`) and `f16d56d` (tsconfig formatting). During this pass the local history was rewritten on top of the runner's heartbeat commit `256ba63`; the same two commits are now `e612866` and `1d4f585`. `git diff --stat f16d56d..HEAD` shows only `tasks/e2e-harness.md`, so the code under test is the same. Changed files in `git diff d2cfcda..HEAD`: `playwright.config.ts`, `test/e2e/harness/{app,fixtures,mongo,index}.ts`, `test/e2e/smoke.e2e.ts`, `test/e2e/harness.e2e.ts`, `package.json`, `package-lock.json`, `tsconfig.json`, `eslint.config.mjs`, `.gitignore`, `.prettierignore`, `docs/ARCHITECTURE.md` (plus the `tasks/` heartbeat). This pass adds the test files listed below. They are uncommitted, and the parent commits them.

Requirements:
- `tasks/e2e-harness.md` acceptance criteria and the recorded assumptions: `@playwright/test` 1.65.1 as the runner; specs are `*.e2e.ts`; "no writes to the real userData" means a snapshot (paths, sizes, mtimes) of Electron's default userData folder taken before launch and compared after close; the mongo fixture reuses int-harness `startFixture` and is skipped without Docker/Podman
- `docs/ARCHITECTURE.md` "End-to-end tests" and "Coverage"; `AGENTS.md` project notes and Evidence rules

## Test files changed

- `test/e2e/harness-helpers.e2e.ts` (new)
- `test/e2e/failure-fixture/playwright.config.ts` (new). This config is only for the nested failure run. The root config's `**/*.e2e.ts` match doesn't pick it up.
- `test/e2e/failure-fixture/failing.fixture.ts` (new). One test in it fails on purpose and one passes. Only the nested run uses this file.

## Tests added or updated

Count: 12 (all in `harness-helpers.e2e.ts`). No existing test was changed.

- `headlessArgs` (Linux only):
  - `adds the headless Ozone switch when there is no display`
  - `uses the display when DISPLAY or WAYLAND_DISPLAY is set`
  - `THICKET_TEST_HEADLESS=1 forces headless even with a display; other values do not`

  These tests set `process.env` inside the test process and restore it afterwards.
- `realUserDataDir` (Linux only):
  - `is $XDG_CONFIG_HOME/<app name> when XDG_CONFIG_HOME is set`
  - `falls back to ~/.config/<app name> when XDG_CONFIG_HOME is unset or empty`
- `snapshotDir`, run against real temporary folders:
  - `returns null for a folder that does not exist`
  - `returns an empty snapshot for an empty folder and equal snapshots when nothing changed`
  - `detects a created folder in place of a missing one`
  - `detects a new, a deleted and a nested file`
  - `detects a rewrite with a different size or only a different modification time`

  These tests check that the AC2 guard really detects writes.
- `screenshotWindows saves a PNG of the window under test-results/ and attaches it`: launches the real built app and calls the helper. It then checks that `failure-window-0.png` exists, is not empty and sits under `<repo>/test-results/`, and that a `window 0` image attachment exists.
- `a failing test leaves a window screenshot and the app output under test-results/`: this is the end-to-end check for AC3. It runs a nested Playwright Test process (`node node_modules/@playwright/test/cli.js test --config test/e2e/failure-fixture/playwright.config.ts --reporter=json`) whose output folder is inside the outer test's `test-results/` folder. It checks:
  - the deliberately failing test has status `failed`;
  - that test has a `window 0` PNG attachment and an `app output` attachment;
  - exactly one `failure-window-0.png` exists, in the failing test's folder;
  - the passing test got no screenshot.

  This test would fail if the harness stopped taking screenshots on failure. It would also fail if the harness took screenshots for passing tests.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: `npm run test:e2e` builds the app and a smoke test sees the main window title (xvfb-run on Linux) | `smoke.e2e.ts › the main window opens with the title Thicket` (existing); the title is also checked in the new screenshot tests | `npm run test:e2e`: runs the renderer build, then the desktop build, then `playwright test`, using the session's display (a Wayland session, see the app output). Not run under `xvfb-run`. The no-display fallback (`--ozone-platform=headless`) is covered by the `headlessArgs` tests, but no app was launched without a display. | Pass: 17 passed (15.8 s). The xvfb-run variant was not run because this session has a display. |
| AC2: each test gets a fresh temporary userData directory, with no writes to the real one | `smoke.e2e.ts › the app uses the fresh temporary userData folder, not the real one` and `› every test gets its own empty userData folder (1)/(2)` (existing); the `realUserDataDir` and `snapshotDir` tests (new). The guard itself runs after every `electronApp` test, including the 2 new app-launching tests. | `npm run test:e2e` | Pass |
| AC3: a screenshot on failure is saved under test-results/ (git-ignored) | `a failing test leaves a window screenshot and the app output under test-results/`, `screenshotWindows saves a PNG ...`; also `git check-ignore -q test-results` | `npm run test:e2e`; `git check-ignore -q test-results && echo ignored` | Pass (the command printed `ignored`) |
| Assumption: the mongo fixture from int-harness works, and is skipped without a runtime | `harness.e2e.ts › the mongo fixture starts a reachable MongoDB server from the integration harness` (existing) | `npm run test:e2e` (a container runtime answered here) | Pass. The test ran and was not skipped. The skip path was not exercised because a runtime was available. |

## Focused test execution

Command:

`npx playwright test test/e2e/harness-helpers.e2e.ts`

Result:

Pass: 12 passed (15.3 s). The first attempt had 2 failures, and both were mistakes in my tests: Playwright copies an attached file into `attachments/` under a hashed name, so the attachment path is not the `failure-window-0.png` path. I fixed the tests. This is not a production bug.

## Full test execution

Command:

`npm run test:e2e`

Result:

Pass: 17 passed (15.8 s), 1 worker. I deleted `test-results/` before the run. This was the final run on the final test files.

Command:

`npm run check` (eslint plus prettier, tsc, vitest root projects plus `ng test`)

Result:

Pass, on the final test files. The root vitest run had 33 files and 2099 tests; the renderer had 27 files and 437 tests. The first attempt failed on lint in my new file (non-null assertions and a dynamic `delete`). I fixed that with a `defined()` helper and `Reflect.deleteProperty`.

## .taskcheck

Result:

Pass. `.taskcheck` runs `npm run check`, and that passed as recorded above.

## Bugs found

None. No production or harness defect was found.

## Coverage

Status: not applicable. Coverage instrumentation is not configured for Playwright e2e in this project. The configured provider (Vitest with `@vitest/coverage-v8`, see `docs/ARCHITECTURE.md` "Coverage") only covers the Vitest projects, and those don't include `test/e2e/` or `playwright.config.ts`. Adding e2e coverage tooling would mean configuration changes outside a test-writer's authority. No coverage numbers are reported, and none are substituted from other runs.

Metric: whole-file coverage of task-changed production files: not measured, for the reason above.
Changed-line coverage: not measured.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: task `e2e-harness`; base `d2cfcda47be09358ba6bee618ec86aaadc71ce68`; HEAD `1d4f585aebc298b5be4ee5ec73135ff84dfbf82a`. The parent supplied the commits `cf3eddf` and `f16d56d`, which were rewritten as `e612866` and `1d4f585` with identical code (`git diff --stat f16d56d..HEAD` shows only `tasks/`).
- Source/test snapshot identifier (including uncommitted inputs): HEAD `1d4f585` plus these uncommitted files (sha256):
  - `test/e2e/harness-helpers.e2e.ts`: `86b546496550776f9849bdcf5700853433e8d591502ca53a64d0f529785b51a6`
  - `test/e2e/failure-fixture/failing.fixture.ts`: `6f75736e91fac40b79734b701c7db53be637a6bf380d2da79d0eea1579f2caca`
  - `test/e2e/failure-fixture/playwright.config.ts`: `f7f2cf2f1e18f8a74c274f05b5532ce2a34ef32acf1d13df3d46286a20e6482b`
- Exact included files; renamed/deleted/excluded files and reasons: none were measured. The task code consists of test infrastructure: `playwright.config.ts` and `test/e2e/harness/*.ts`. These run inside the Playwright runner, and no coverage provider is configured for that runner. `package.json`, `tsconfig.json`, `eslint.config.mjs`, `.gitignore`, `.prettierignore` and `docs/ARCHITECTURE.md` are configuration or documentation.
- Provider/version, command, working directory, and test selection: none (not applicable)
- Run start/completion time and exit status: none (not applicable)
- Generated report paths and report hashes/run identifier: none
- Evidence outputs are fresh and inputs stayed unchanged: the test results above come from the final file snapshot. No coverage output exists.
- Final run after latest test additions and production fixes: yes for the tests (`npm run test:e2e`, `npm run check`). Coverage is not applicable. There were no production fixes.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `test/e2e/harness/app.ts` | N/A (no e2e coverage provider) | N/A | N/A | N/A |
| `test/e2e/harness/fixtures.ts` | N/A (no e2e coverage provider) | N/A | N/A | N/A |
| `test/e2e/harness/mongo.ts` | N/A (no e2e coverage provider) | N/A | N/A | N/A |
| `test/e2e/harness/index.ts` | N/A (re-exports only) | N/A | N/A | N/A |
| `playwright.config.ts` | N/A (configuration) | N/A | N/A | N/A |

Behavior-level gaps, found by reading the code because no instrumentation exists:

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `test/e2e/harness/app.ts` `realUserDataDir` win32/darwin branches | Finding the real userData folder on Windows and macOS | Not testable on this Linux host. The tests skip those platforms. |
| `test/e2e/harness/fixtures.ts` `mongo` fixture, `unavailable` → `testInfo.skip` | Skip when no Docker/Podman answers | Not exercised because a runtime answered. Simulating a missing runtime would mean changing the environment (DOCKER_HOST), and env-prefixed commands are blocked in this session. Low risk: the code is a straightforward branch. |
| `test/e2e/harness/mongo.ts` TLS branch (`spec.tls`, CA file, `removeCerts`) | Starting TLS fixtures for e2e | No e2e test uses a TLS fixture yet. The underlying `startFixture` and the certificates are covered by int-harness tests. Left for the first e2e task that needs TLS. |
| `test/e2e/harness/fixtures.ts` `app.close().catch(() => kill)` | Teardown when the app doesn't close cleanly | A defensive branch that can't reasonably be triggered deterministically. |
| AC1 under `xvfb-run` / no display | Linux CI without a display | This session has a display. The `headlessArgs` switch selection is tested, but no app was launched headless. |

## Unable to test

- Running AC1 under `xvfb-run -a` or without a display: not run because the session has a display and env-prefixed commands are blocked. Follow-up: run it once in CI or on a host without a display.
- The skip path of the mongo fixture when no container runtime is available: not exercised (see above).
- `realUserDataDir` on Windows and macOS: Linux-only host.

## Summary

Tests added and all validation passed. Coverage is not applicable because no coverage instrumentation is configured for Playwright e2e. No production defects were found.

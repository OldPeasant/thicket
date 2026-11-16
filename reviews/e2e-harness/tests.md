# Test Report

Date: 2026-11-16

Task: e2e-harness - M0: Playwright end-to-end harness for the Electron app

Scope: base `d2cfcda47be09358ba6bee618ec86aaadc71ce68` .. HEAD `493a46271fa97cd4cbc31f84e830a48c5eb8b21e` (branch `main`, confirmed with `git rev-parse HEAD`). This is the second test pass, on the final revision. Task commits: `e612866` (harness, `npm run test:e2e`), `1d4f585` (tsconfig formatting), `175eb87` (helper tests and review reports from the first pass) and `493a462` (fixer). Since the first pass (HEAD `1d4f585` plus the then-uncommitted test files), the only code changes are in `493a462`:
- `test/e2e/harness/app.ts`: `_electron` and `ElectronApplication` are now imported from `@playwright/test` instead of `playwright-core`, and a keep-in-sync comment was added;
- `test/e2e/harness/fixtures.ts`: the `ElectronApplication` and `Page` types are now imported from `@playwright/test` (merged into the existing import);
- `apps/desktop/test/helpers.ts`: a keep-in-sync comment only.

The test files from the first pass are now committed in `175eb87` and have the same content (the sha256 values below match the first pass). Task-changed files in `git diff d2cfcda..493a462` (without `tasks/` and `reviews/`): `playwright.config.ts`, `test/e2e/harness/{app,fixtures,mongo,index}.ts`, `test/e2e/smoke.e2e.ts`, `test/e2e/harness.e2e.ts`, `test/e2e/harness-helpers.e2e.ts`, `test/e2e/failure-fixture/{playwright.config,failing.fixture}.ts`, `apps/desktop/test/helpers.ts` (comment only), `package.json`, `package-lock.json`, `tsconfig.json`, `eslint.config.mjs`, `.gitignore`, `.prettierignore`, `docs/ARCHITECTURE.md`. The only uncommitted change in the working tree when this pass started was `reviews/e2e-harness/review.md`, which is not a test input.

Requirements:
- `tasks/e2e-harness.md` acceptance criteria and the recorded assumptions: `@playwright/test` 1.65.1 as the runner; specs are `*.e2e.ts`; "no writes to the real userData" means a snapshot (paths, sizes, mtimes) of Electron's default userData folder taken before launch and compared after close; the mongo fixture reuses int-harness `startFixture` and is skipped without Docker/Podman
- `docs/ARCHITECTURE.md` "End-to-end tests" and "Coverage"; `AGENTS.md` project notes and Evidence rules

## Test files changed

None in this pass. The first pass added these files (committed in `175eb87`):

- `test/e2e/harness-helpers.e2e.ts`
- `test/e2e/failure-fixture/playwright.config.ts`. This config is only for the nested failure run. The root config's `**/*.e2e.ts` match doesn't pick it up.
- `test/e2e/failure-fixture/failing.fixture.ts`. One test in it fails on purpose and one passes. Only the nested run uses this file.

## Tests added or updated

Count: 0 in this pass (12 from the first pass, all in `harness-helpers.e2e.ts`). The changes in `493a462` only switch the import source of the same Playwright API and add comments, so no new behavior needs tests. The existing tests already exercise both changed imports: `_electron.launch` runs in every app-launching test, and the type imports are checked by `tsc` in `npm run check`. No existing test was changed.

The 12 tests from the first pass:

- `headlessArgs` (Linux only): `adds the headless Ozone switch when there is no display`; `uses the display when DISPLAY or WAYLAND_DISPLAY is set`; `THICKET_TEST_HEADLESS=1 forces headless even with a display; other values do not`. They set `process.env` inside the test process and restore it afterwards.
- `realUserDataDir` (Linux only): `is $XDG_CONFIG_HOME/<app name> when XDG_CONFIG_HOME is set`; `falls back to ~/.config/<app name> when XDG_CONFIG_HOME is unset or empty`.
- `snapshotDir` (real temporary folders): `returns null for a folder that does not exist`; `returns an empty snapshot for an empty folder and equal snapshots when nothing changed`; `detects a created folder in place of a missing one`; `detects a new, a deleted and a nested file`; `detects a rewrite with a different size or only a different modification time`. These check that the AC2 guard really detects writes.
- `screenshotWindows saves a PNG of the window under test-results/ and attaches it`: launches the real built app, calls the helper, and checks that a non-empty `failure-window-0.png` sits under `<repo>/test-results/` and that a `window 0` image attachment exists.
- `a failing test leaves a window screenshot and the app output under test-results/`: the end-to-end check for AC3. It runs a nested Playwright Test process (`node node_modules/@playwright/test/cli.js test --config test/e2e/failure-fixture/playwright.config.ts --reporter=json`) and checks that the deliberately failing test is `failed`, has a `window 0` PNG and an `app output` attachment, that exactly one `failure-window-0.png` exists (in the failing test's folder), and that the passing test got no screenshot.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: `npm run test:e2e` builds the app and a smoke test sees the main window title (xvfb-run on Linux) | `smoke.e2e.ts › the main window opens with the title Thicket`; the title is also checked in the 2 screenshot tests | `npm run test:e2e` (renderer `ng build`, desktop `node scripts/build.mjs`, then `playwright test`) on revision `493a462` | Pass: 17 passed (15.4 s). Display: the app ran with the session's graphical display, not headless and not under `xvfb-run`. `xvfb-run` is not installed (`which xvfb-run` -> "no xvfb-run in (...)"). I could not print `$DISPLAY`/`$WAYLAND_DISPLAY` myself because those commands were blocked in this session. The parent reports a Wayland/X session display. The headless fallback (`--ozone-platform=headless`) is only checked by the `headlessArgs` unit tests. No app was launched without a display. |
| AC2: each test gets a fresh temporary userData directory, with no writes to the real one | `smoke.e2e.ts › the app uses the fresh temporary userData folder, not the real one`, `› every test gets its own empty userData folder (1)/(2)`; the `realUserDataDir` and `snapshotDir` tests. The guard runs after every `electronApp` test. | `npm run test:e2e` | Pass |
| AC3: a screenshot on failure is saved under test-results/ (git-ignored) | `a failing test leaves a window screenshot and the app output under test-results/`, `screenshotWindows saves a PNG ...`; `test-results` being git-ignored was checked in the first pass with `git check-ignore -q test-results` (`.gitignore` unchanged since then) | `npm run test:e2e` | Pass |
| Assumption: the mongo fixture from int-harness works, and is skipped without a runtime | `harness.e2e.ts › the mongo fixture starts a reachable MongoDB server from the integration harness` | `npm run test:e2e` (a container runtime answered) | Pass. The test ran and was not skipped. The skip path was not exercised. |

## Focused test execution

Command:

`npm run test:e2e`

Result:

Pass: 17 passed (15.4 s), 1 worker. The import change in `493a462` affects only the e2e harness, so the whole e2e suite is the focused set. All 12 helper tests, both smoke/userData tests, both per-test-folder tests and the mongo fixture test passed.

## Full test execution

Command:

`npm run check` (eslint plus prettier, `tsc` for every workspace, root vitest plus renderer `ng test`)

Result:

Pass on revision `493a462`. Lint and type checks passed (the chain reached the test step). Root vitest: 33 files, 2099 tests passed. Renderer `ng test`: 27 files, 437 tests passed.

`npm run test:e2e`: Pass, as recorded above.

## .taskcheck

Result:

Pass. `.taskcheck` runs `npm run check`, which passed as recorded above. I did not run `.taskcheck` separately.

## Bugs found

None. No production or harness defect was found.

## Coverage

Status: not applicable. This project has no coverage instrumentation for Playwright e2e. The configured provider (Vitest with `@vitest/coverage-v8`, see `docs/ARCHITECTURE.md` "Coverage") only covers the Vitest projects, and those don't include `test/e2e/` or `playwright.config.ts`. Adding e2e coverage tooling would need configuration changes outside a test-writer's authority. No coverage numbers are reported, and none are taken from other runs.

Metric: whole-file coverage of task-changed production files: not measured, for the reason above.
Changed-line coverage: not measured.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: task `e2e-harness`; base `d2cfcda47be09358ba6bee618ec86aaadc71ce68`; HEAD `493a46271fa97cd4cbc31f84e830a48c5eb8b21e`. The parent supplied the task commits and the scope of `493a462`. The file scope is `git diff --name-status d2cfcda..493a462`.
- Source/test snapshot identifier (including uncommitted inputs): committed HEAD `493a462`; no uncommitted test or source inputs. sha256 values:
  - `test/e2e/harness-helpers.e2e.ts`: `86b546496550776f9849bdcf5700853433e8d591502ca53a64d0f529785b51a6`
  - `test/e2e/failure-fixture/failing.fixture.ts`: `6f75736e91fac40b79734b701c7db53be637a6bf380d2da79d0eea1579f2caca`
  - `test/e2e/failure-fixture/playwright.config.ts`: `f7f2cf2f1e18f8a74c274f05b5532ce2a34ef32acf1d13df3d46286a20e6482b`
  - `test/e2e/harness/app.ts`: `027d134bbe7fb3a4beec4c0563f8d0baea4f931d4a92251ec26528dc4be40f8b`
  - `test/e2e/harness/fixtures.ts`: `2efb66badbab9b6cefbc81bab6428d4952858cb22bc7eee4ec9376c850475367`
- Exact included files; renamed/deleted/excluded files and reasons: none were measured. The task code is test infrastructure (`playwright.config.ts`, `test/e2e/harness/*.ts`) that runs inside the Playwright runner, and no coverage provider is configured for that runner. `apps/desktop/test/helpers.ts` only gained a comment. `package.json`, `package-lock.json`, `tsconfig.json`, `eslint.config.mjs`, `.gitignore`, `.prettierignore` and `docs/ARCHITECTURE.md` are configuration or documentation.
- Provider/version, command, working directory, and test selection: none (not applicable)
- Run start/completion time and exit status: none (not applicable)
- Generated report paths and report hashes/run identifier: none
- Evidence outputs are fresh and inputs stayed unchanged: the test results above come from revision `493a462`, run in this pass. No coverage output exists.
- Final run after latest test additions and production fixes: yes for the tests (`npm run test:e2e` and `npm run check` on `493a462`, after the fixer commit). Coverage is not applicable.

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
| `test/e2e/harness/fixtures.ts` `mongo` fixture, `unavailable` → `testInfo.skip` | Skip when no Docker/Podman answers | Not exercised because a runtime answered. Simulating a missing runtime would need a changed environment (for example `DOCKER_HOST`), and env-prefixed commands are blocked in this session. Low risk: the code is a simple branch. |
| `test/e2e/harness/mongo.ts` TLS branch (`spec.tls`, CA file, `removeCerts`) | Starting TLS fixtures for e2e | No e2e test uses a TLS fixture yet. The underlying `startFixture` and the certificates are covered by int-harness tests. Left for the first e2e task that needs TLS. |
| `test/e2e/harness/fixtures.ts` `app.close().catch(() => kill)` | Teardown when the app doesn't close cleanly | A defensive branch that can't be triggered reliably in a test. |
| AC1 under `xvfb-run` / no display | Linux CI without a display | `xvfb-run` is not installed here, and the app ran with the session display. The `headlessArgs` switch selection is tested, but no app was launched headless. |

## Unable to test

- AC1 under `xvfb-run -a` or without a display: `xvfb-run` is not installed on this host, the app ran with the session's display, and env-prefixed commands (for example `THICKET_TEST_HEADLESS=1`) are blocked in this session. Follow-up: run `npm run test:e2e` once in CI or on a Linux host without a display or with `xvfb-run`.
- The display variables could not be printed here (`echo $DISPLAY $WAYLAND_DISPLAY` and `env` were blocked). The statement that a Wayland/X session display was used comes from the parent and from the fact that `xvfb-run` is absent.
- The mongo fixture's skip path when no container runtime is available: not exercised (see above).
- `realUserDataDir` on Windows and macOS: Linux-only host.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. On final revision `493a462`, `npm run test:e2e` passed 17 of 17 tests and `npm run check` passed (2099 root plus 437 renderer unit tests). The fixer's import change needed no new tests. Coverage is not applicable because this project has no coverage instrumentation for Playwright e2e. AC1 ran with the session display, not under `xvfb-run` and not headless.

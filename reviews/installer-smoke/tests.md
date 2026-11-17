# Test Report

Date: 2026-11-17

Task: installer-smoke — Release: smoke-test installers in CI

Scope: second pass on the final code. Base `57ae6e1619eb7fa2d48bc8cc98d0cad136c8b6b2`
(`git merge-base HEAD origin/main`), measured HEAD `f300594ffc75a418a772d102316fae438a6e9893`.
Task commits (the `installer-smoke:` commits in `57ae6e16..HEAD`, supplied by the parent):
`10ee1bb4` (smoke test and CI), `371a9b9f` (helper tests and first reports), `de7470be` (fixer:
CR-1..CR-4 and TW-1), `f300594f` (attach over CDP instead of `_electron.launch`). Changed files:
`test/e2e/smoke/installed-app.ts`, `test/e2e/smoke/installer.smoke.ts`,
`test/e2e/smoke/installed-app.smoke.ts`, `test/e2e/smoke/playwright.config.ts`, `package.json`
(script `test:smoke`), `.github/workflows/release.yml`, `docs/ARCHITECTURE.md`, plus the
`reviews/installer-smoke/` reports. Working tree clean at the start of this pass (no uncommitted
inputs).

Requirements:
- `tasks/installer-smoke.md` goal and acceptance criteria, plus its recorded assumptions (NSIS
  silent install, arm64 dmg only, AppImage only with sandbox and `APPIMAGE_EXTRACT_AND_RUN=1`,
  attach via `--remote-debugging-port` + `chromium.connectOverCDP` because packaged-hardening turns
  off the `EnableNodeCliInspectArguments` fuse)
- `docs/ARCHITECTURE.md` (E2E "Installer smoke test", "Coverage", "Conventions")
- `reviews/installer-smoke/fixes.md` (what the fixer changed since the first pass)
- `AGENTS.md`, parent worker instructions
- Existing convention `test/e2e/harness-helpers.e2e.ts`: helpers under `test/e2e` are tested with
  Playwright, because no Vitest project covers `test/e2e`

## Test files changed

- None in this pass. `test/e2e/smoke/installed-app.smoke.ts` (added in the first pass, extended by
  the fixer to 29 tests for `mongoSmokeSkipReason`, the Windows install guard, `_?=` uninstall and
  the temp-folder cleanup on failure) was reviewed and is unchanged by this pass.

## Tests added or updated

Count: 0 in this pass (29 helper tests exist in `installed-app.smoke.ts`; 2 app tests in
`installer.smoke.ts`).

Why none were added for the new CDP helpers (`devToolsEndpoint`, `killTree`, `appWindow`,
`appPages`, `screenshotPages` in `installer.smoke.ts`): they are module-private functions inside a
spec file. Importing a `*.smoke.ts` file from another test file would register its tests (and its
worker-scoped `installed` fixture) twice, and extracting them into a helper module such as
`installed-app.ts` is a refactoring of the task's code, which this helper may not do. Their happy
paths are exercised end to end by every `npm run test:smoke` run (endpoint parsed from stderr, CDP
attach, `thicket://app` window found, process group terminated; see "Full test execution" and the
`pgrep` check). Their failure branches are not tested (see Coverage). Recommendation to the parent
(Low, not a defect): if these helpers should get unit tests, move `devToolsEndpoint` and `killTree`
into `test/e2e/smoke/installed-app.ts` (or a sibling helper) so `installed-app.smoke.ts` can cover
"app exits before DevTools listens -> rejects with the app output", "no endpoint within the timeout
-> rejects", "endpoint split across two stderr chunks -> resolved", and "SIGTERM ignored -> SIGKILL
after the grace period" with a fictitious stand-in script, like the existing NSIS/hdiutil tests.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: Smoke test passes locally against the Linux AppImage (welcome screen; on Linux connect to a containerized MongoDB) | `installer.smoke.ts`: "the packaged app starts and shows the welcome screen", "MongoDB › the packaged app connects to a containerized MongoDB" (against `apps/desktop/release/thicket-0.0.0-linux-x86_64.AppImage`, the newest; Podman available, so not skipped) | `npm run test:smoke` | Pass (31 passed in 7.1 s, both app tests passed) |
| AC1: the app attaches over CDP (works with the inspect fuse off, task assumption) | same two app tests; they now spawn the AppImage with `--remote-debugging-port=0` and `chromium.connectOverCDP` | `npm run test:smoke` | Pass against the shipped AppImage (fuse state as built). The fuse-off variant was verified by the parent against a fuse-flipped `linux-unpacked` copy (2/2); not re-run here |
| AC1: no app processes left behind (`killTree`) | process check after the smoke run | `pgrep -fa thicket` | Pass: only the agent runner's `git remote-https ... thicket.git` push processes and the pgrep shell itself matched; no AppImage/Electron process. `podman ps` showed no MongoDB container left (only unrelated long-running containers) |
| AC1 support: helpers pick the right installer, make it runnable, skip Mongo off Linux, guard Windows installs, clean up | the 29 tests in `installed-app.smoke.ts` | `npm run test:smoke` | Pass (29/29) |
| AC2: CI run green on all three OSes | none locally | — | Not run: the release workflow runs only on a pushed `v*` tag on GitHub; helpers may not push, and macOS/Windows cannot run on this Linux host. Already skipped with this reason in the task file |
| Project check stays green | existing suites | `npm run check` | Pass |

## Focused test execution

Command:

`npm run test:smoke` (runs the 29 helper tests and the 2 app tests; the smoke config is the focused
suite for this task)

Result:

Pass (31 passed, 7.1 s)

## Full test execution

Command:

`npm run check` (eslint + prettier, typecheck, Vitest workspace projects, renderer tests)

Result:

Pass (Vitest 82 files / 4345 tests; renderer 100 files / 3273 tests)

## .taskcheck

Result:

Pass (`.taskcheck` runs `npm run check`, run above on HEAD `f300594f`)

## Bugs found

None that violate the task's acceptance criteria.

Notes for the parent (not production defects, no failing test):
- `reviews/installer-smoke/fixes.md` CR-4 says the spec imports the harness's `screenshotWindows`;
  since `f300594f` it uses its own `screenshotPages` (because there is no `ElectronApplication` over
  CDP). The fixer's report describes the pre-CDP revision; the parent decides whether that needs a
  note in `quality.json`.
- `pgrep -fa thicket` also matches the git remote URL (`.../thicket.git`) of the runner's background
  pushes, so a non-empty result is not by itself a leftover app process.

## Coverage

Status: unavailable — the project's coverage tooling (Vitest + `@vitest/coverage-v8`, per
workspace) does not cover `test/e2e`: it is in no Vitest project, and the Playwright smoke config
collects no Node-side coverage. Measuring it would need a configuration change outside the
test-writer's authority. No numbers are reported; no repository-wide numbers substituted.

Metric: whole-file coverage of task-changed production files — not measured.
Changed-line coverage: not measured.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: installer-smoke;
  base `57ae6e1619eb7fa2d48bc8cc98d0cad136c8b6b2`; HEAD
  `f300594ffc75a418a772d102316fae438a6e9893`; task commits `10ee1bb4`, `371a9b9f`, `de7470be`,
  `f300594f` (parent-supplied, confirmed with `git log --oneline 57ae6e16..HEAD` and
  `git diff --stat 57ae6e16 HEAD`).
- Source/test snapshot identifier (including uncommitted inputs): HEAD `f300594f`, clean tree;
  sha256 `installed-app.ts` c191243f33e57c284a69a050996c0ec5f99cba6c7b5d4d64d1ff10df5e9425c3,
  `installer.smoke.ts` f08a8358ecd8046a086f3ddb4d242ca088e3393e565c359370fc05f271ca72c8,
  `playwright.config.ts` 5c3cbc290ee1d5af6d57d178c227340aec24b81bcab71736a7b80f32e0a6e7a0,
  `installed-app.smoke.ts` 598cc8e221ee8f0dced9730a2f2d5a9900052a0e7ae085450fbb93b63087fb75.
- Exact included files; renamed/deleted/excluded files and reasons: would-be scope
  `test/e2e/smoke/installed-app.ts`, `test/e2e/smoke/installer.smoke.ts` (executable code);
  excluded: `playwright.config.ts`, `package.json` (configuration), `release.yml` (CI workflow, not
  instrumentable), `docs/ARCHITECTURE.md` (documentation), `installed-app.smoke.ts` (tests).
- Provider/version, command, working directory, and test selection: none run (see Status).
- Run start/completion time and exit status: N/A.
- Generated report paths and report hashes/run identifier: N/A.
- Evidence outputs are fresh and inputs stayed unchanged: N/A for coverage; the test runs above used
  the snapshot hashed above (this pass changed no files except this report).
- Final run after latest test additions and production fixes: yes for tests (on `f300594f`, after
  the fixer and the CDP change); coverage N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `test/e2e/smoke/installed-app.ts` | N/A (not measurable) | N/A | N/A | N/A |
| `test/e2e/smoke/installer.smoke.ts` | N/A (not measurable) | N/A | N/A | N/A |

Manual branch review (reading the code against the tests and the smoke run, not a tool
measurement):

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `installed-app.ts:29-154` `mongoSmokeSkipReason`, `installerSuffix`, `findInstaller` (darwin arch filter, missing folder, newest, no match), `installApp` AppImage/dmg/exe/unsupported, Windows CI/opt-in guard, NSIS failure cleanup, `_?=` uninstall, dmg app-count error + detach | Choosing and starting the right installer per OS | Covered by the 29 tests in `installed-app.smoke.ts` |
| `installed-app.ts:130` `readdir(dir).catch(() => [])`; `:146-148` `.catch` on a failing uninstaller | Diagnostic message / best-effort cleanup | Left uncovered: not reachable without the installer deleting its own target; low risk |
| `installer.smoke.ts:158-191` `devToolsEndpoint`: `onExit` (app exits before DevTools listens) and the timeout branch | Clear failure with the app output instead of a hang | Not tested: private to the spec file (see "Tests added or updated"); happy path runs every smoke run. Extraction recommended if tests are wanted |
| `installer.smoke.ts:194-215` `killTree`: already-exited early return, `process.kill(-pid)` failure fallback, SIGKILL after 10 s, Windows `taskkill /T /F` | No leftover app processes on CI runners | POSIX SIGTERM path verified by the smoke run + `pgrep`; other branches not exercised (Windows only in CI) |
| `installer.smoke.ts:142-155` `appWindow` timeout error; `:99-107`, `:124-134` failure screenshots and app-output attachment | Diagnostics on failure | Happy path only; failure branches need a broken app |
| `installer.smoke.ts:236` `THICKET_SMOKE_MONGO=1` without a container runtime -> failure; `:51-53` `THICKET_SMOKE_INSTALLER` override | CI env handling | Not exercised locally (runtime present, default installer used) |
| Real `hdiutil`, NSIS install/uninstall, `windowsVerbatimArguments` quoting, `--remote-debugging-port` in the macOS/Windows packaged builds | AC2 | Only verifiable by a CI release run |

## Unable to test

- AC2 (CI green on Linux x64/arm64, macOS, Windows): needs a pushed `v*` tag on GitHub; not
  possible for this helper or on this host. Already skipped with a reason in the task file.
- The smoke test against a build with `EnableNodeCliInspectArguments` off: no such packaged build in
  `apps/desktop/release`; the parent verified it on a fuse-flipped copy. Re-verify once
  packaged-hardening lands (follow-up for the parent / that task).
- Failure branches of the CDP helpers in `installer.smoke.ts`: not testable without extracting them
  (a test-only refactoring outside this helper's authority); follow-up optional (Low).
- Coverage numbers: see Coverage.

## Summary

Tests and validation pass on the final revision `f300594f` (`npm run test:smoke` 31/31,
`npm run check` pass, no leftover app processes). No production defects found. AC2 cannot be run
here (already skipped with reason). The new CDP helpers are covered only on their happy path by the
real smoke run; unit tests for their failure branches would need them moved out of the spec file,
which is left to the parent's decision. Coverage is unavailable with the existing tooling for
`test/e2e`.

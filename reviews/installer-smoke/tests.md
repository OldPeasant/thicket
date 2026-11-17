# Test Report

Date: 2026-11-17

Task: installer-smoke — Release: smoke-test installers in CI

Scope: task commit `eb45f4638be57ba123d913ddfaa5e6ab22dba5b0` on base
`f285d6e4e863a01d6b870aa598480edfb54a0f2f` (supplied by the parent worker). During testing the
parent rebased the commit to `77b3b325ad3e3244ec2d085a4e81c8b60073c220` (HEAD);
`git diff --stat eb45f46 77b3b32 -- test .github package.json docs/ARCHITECTURE.md` is empty, so
the task's code is identical. Changed files: `test/e2e/smoke/installed-app.ts`,
`test/e2e/smoke/installer.smoke.ts`, `test/e2e/smoke/playwright.config.ts`, `package.json`
(script `test:smoke`), `.github/workflows/release.yml` (smoke step per OS), `docs/ARCHITECTURE.md`.

Requirements:
- `tasks/installer-smoke.md` goal and acceptance criteria, plus its recorded assumptions
  (Windows: NSIS silent install; macOS: arm64 dmg only; Linux: AppImage only, sandbox on,
  `APPIMAGE_EXTRACT_AND_RUN=1`)
- `docs/ARCHITECTURE.md` (E2E section "Installer smoke test", "Coverage", "Conventions")
- `AGENTS.md`, parent worker instructions
- Existing convention `test/e2e/harness-helpers.e2e.ts`: helpers under `test/e2e` are tested with
  Playwright because no Vitest project covers `test/e2e`

## Test files changed

- `test/e2e/smoke/installed-app.smoke.ts` (new)

Placement: the root `vitest.config.ts` only runs the four workspace projects
(`apps/desktop`, `packages/contract`, `packages/core`, `packages/backend`); `test/e2e` is in none of
them, and adding a project would be a configuration change. Following the `harness-helpers.e2e.ts`
precedent, the helper tests are Playwright tests matched by the smoke config's `*.smoke.ts`, so they
run with `npm run test:smoke` (locally and in each release CI job). They use plain
`@playwright/test` (no installer fixture), take < 1 s, and are portable: platform/arch-dependent
branches of `findInstaller` are exercised by temporarily redefining `process.platform`/`process.arch`;
tests that use stand-in shell scripts (fake NSIS installer, fake `hdiutil` on `PATH`) or POSIX file
modes are skipped off Linux / on Windows respectively. All data is fictitious; every temp folder is
removed in `afterEach`.

## Tests added or updated

Count: 21

- installerSuffix: maps each OS to its installer; falls back to the AppImage on other platforms;
  defaults to the current platform
- findInstaller: newest Linux AppImage by mtime, ignoring .deb/.rpm/.blockmap/.yml/dirs; single
  installer; Windows picks newest `.exe`, not the zip/blockmap; macOS picks the dmg for this CPU even
  when the other arch is newer (arm64 and x64); macOS without a dmg for this CPU fails; no installer
  for this OS fails with the exact hint; missing release folder fails with the same hint
- installApp: refuses `.deb`/`.rpm`/`.zip`/no suffix/`.AppImage.blockmap`; makes an AppImage 0755 and
  returns it as the executable, cleanup leaves it; suffix check is case-insensitive
- installApp NSIS (fictitious installer script): silent install with exactly `/S` and `/D=` set to a
  fresh `thicket-smoke-install-*` temp folder, executable `Thicket.exe` in that folder, cleanup runs `Uninstall Thicket.exe /S` and removes the folder;
  cleanup without an uninstaller still removes the folder; no `Thicket.exe` -> error naming what was
  found; installer exit code != 0 -> rejection
- installApp dmg (fictitious `hdiutil` on `PATH`): `attach -nobrowse -readonly -mountpoint`
  with a fresh `thicket-smoke-dmg-*` temp folder and the dmg path, executable
  `Thicket.app/Contents/MacOS/Thicket` in the mount point, cleanup `detach` of the mount point with
  `-force` and removes the mount point; no `.app` -> "found: none" error and detach; two `.app`s -> error and
  detach; mount point removed even when `hdiutil detach` fails

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: Smoke test passes locally against the Linux AppImage (welcome screen; on Linux connect to a containerized MongoDB) | `installer.smoke.ts`: "the packaged app starts and shows the welcome screen", "the packaged app connects to a containerized MongoDB" (ran against `apps/desktop/release/thicket-0.0.0-linux-x86_64.AppImage`, the newest, container runtime available so not skipped) | `npm run test:smoke` | Pass (23 passed, incl. both app tests) |
| AC1 support: the helpers pick the right installer and make it runnable as a user would (per-OS, per-arch, newest, errors) | the 21 tests in `installed-app.smoke.ts` | `npx playwright test -c test/e2e/smoke/playwright.config.ts installed-app.smoke.ts`; again within `npm run test:smoke` | Pass (21/21) |
| AC2: CI run green on all three OSes | none locally | — | Not run: the release workflow only runs on a pushed `v*` tag on GitHub; helpers may not push, and macOS/Windows cannot run here (Linux host). The real `hdiutil` and NSIS paths are only exercised in CI. |
| Project check stays green | existing suites | `npm run check` | Pass |

## Focused test execution

Command:

`npx playwright test -c test/e2e/smoke/playwright.config.ts installed-app.smoke.ts`

Result:

Pass (21 passed, 652 ms)

## Full test execution

Command:

`npm run test:smoke`

Result:

Pass (23 passed in 6.0 s; the app tests used
`apps/desktop/release/thicket-0.0.0-linux-x86_64.AppImage`)

Command:

`npm run check` (lint incl. eslint + prettier over the new file, typecheck, unit tests)

Result:

Pass (Vitest 79 files / 4297 tests; renderer 100 files / 3273 tests)

## .taskcheck

Result:

Pass (`.taskcheck` runs `npm run check`, which was run above on the same snapshot)

## Bugs found

None that violate the task's acceptance criteria.

Observation (Low, not a requirement violation, no failing test): in `installApp`
(`test/e2e/smoke/installed-app.ts:98-105`) the NSIS temp install folder is not removed when the
installer exits non-zero or when no `Thicket.exe` appears, because no `cleanup` is returned on those
paths. Only matters for a failed smoke run (leftover temp folder on the CI runner). The new tests
remove those folders themselves. The parent may decide whether it is worth a change.

## Coverage

Status: unavailable — the project's coverage tooling (Vitest + `@vitest/coverage-v8`, per workspace)
does not cover `test/e2e`; it is in no Vitest project, and the Playwright smoke config has no
coverage collection for Node-side code. Measuring it would require a configuration change outside
the test-writer's authority. No numbers are reported; no repository-wide numbers substituted.

Metric: whole-file coverage of task-changed production files — not measured.
Changed-line coverage: not measured.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: installer-smoke;
  base `f285d6e4e863a01d6b870aa598480edfb54a0f2f`; task commit `eb45f46` (supplied by parent), rebased
  to `77b3b325ad3e3244ec2d085a4e81c8b60073c220` with identical code (empty diff, see Scope).
- Source/test snapshot identifier (including uncommitted inputs): sha256
  `installed-app.ts` 00830d6c061ccc7eee22052816e09cb13667ffb53eb763c1ec410e4bb7926a27,
  `installer.smoke.ts` 4651621db0b6071ff3af70865b387ee067ad6fcba41cb6e9d23c66538f2b1ba2,
  `playwright.config.ts` 5c3cbc290ee1d5af6d57d178c227340aec24b81bcab71736a7b80f32e0a6e7a0,
  new `installed-app.smoke.ts` b21b201f2deda6d47ad748fc00a20c956087e24b74061bee53a7877af6cf79b7
  (uncommitted).
- Exact included files; renamed/deleted/excluded files and reasons: would-be scope
  `test/e2e/smoke/installed-app.ts`, `test/e2e/smoke/installer.smoke.ts` (executable code);
  excluded: `playwright.config.ts`, `package.json` (configuration), `release.yml` (CI workflow,
  not instrumentable), `docs/ARCHITECTURE.md` (documentation).
- Provider/version, command, working directory, and test selection: none run (see Status).
- Run start/completion time and exit status: N/A.
- Generated report paths and report hashes/run identifier: N/A.
- Evidence outputs are fresh and inputs stayed unchanged: N/A for coverage; test runs above used the
  snapshot hashed above.
- Final run after latest test additions and production fixes: yes for tests (no production fixes);
  coverage N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `test/e2e/smoke/installed-app.ts` | N/A (not measurable) | N/A | N/A | N/A |
| `test/e2e/smoke/installer.smoke.ts` | N/A (not measurable) | N/A | N/A | N/A |

Manual branch review of `installed-app.ts` (by reading the code against the tests, not a tool
measurement):

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `installed-app.ts:26-117` all branches of `installerSuffix`, `findInstaller` (incl. darwin arch filter, missing folder `.catch`, newest selection, no-match throw), `installApp` AppImage/dmg/exe/unsupported, `exists` true/false, dmg app-count error + detach `.catch` | Choosing and starting the right installer per OS | Covered by the 21 new tests (dmg/NSIS with stand-in scripts) |
| `installed-app.ts:103` `readdir(dir).catch(() => [])` when the install folder vanished | Diagnostic message only | Left uncovered: not reachable without the installer deleting its own target |
| `installed-app.ts:110-111` `.catch` on a failing uninstaller / `rm` | Cleanup must not throw | Left uncovered: best-effort cleanup; low risk |
| Real `hdiutil` and NSIS behavior, `windowsVerbatimArguments` quoting | macOS/Windows smoke in CI (AC2) | Cannot run on this Linux host; only verifiable by a CI run |
| `installer.smoke.ts` fixtures (failure screenshots/app output attach, `THICKET_SMOKE_MONGO=1` failure branch, `THICKET_SMOKE_INSTALLER` override) | Diagnostics on failure; CI env handling | Happy path exercised by `npm run test:smoke`; failure branches not exercised (would need a broken app or no container runtime) |

## Unable to test

- AC2 (CI green on Linux x64/arm64, macOS, Windows): requires pushing a `v*` tag to GitHub; not
  possible for this helper and not on this host. Needs follow-up by the parent (skip with reason or a
  real CI run).
- Real macOS `hdiutil` mounting and Windows NSIS silent install/uninstall: only in CI.
- Coverage numbers: see Coverage (tooling does not cover `test/e2e`).

## Summary

Tests added and all validation passed. AC1 passes locally against the Linux AppImage; AC2 could not
be run here and needs the parent's decision (skip with reason). Coverage is unavailable with the
existing tooling for `test/e2e`.

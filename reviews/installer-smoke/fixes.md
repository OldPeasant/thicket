# Fix Report

Date: 2026-11-17

Task: installer-smoke - Release: smoke-test installers in CI

Scope: current task; findings CR-1..CR-4 from `reviews/installer-smoke/review.md` and the Low
observation in `reviews/installer-smoke/tests.md` ("Bugs found": NSIS temp install folder leaked),
with the parent worker's decisions for each.

## Fixed findings

### CR-1 — The MongoDB smoke test runs (and very likely fails) on the Windows runner

Files changed:
- `test/e2e/smoke/installed-app.ts`
- `test/e2e/smoke/installer.smoke.ts`
- `test/e2e/smoke/installed-app.smoke.ts`
- `docs/ARCHITECTURE.md`

Problem:
The Mongo test was skipped only when testcontainers found no runtime; the Windows runner has a
Windows-containers Docker engine, so the Linux-only images would be started there and fail.

Fix:
New `mongoSmokeSkipReason(platform, env)` in `installed-app.ts`: the test runs on Linux or when
`THICKET_SMOKE_MONGO=1`; otherwise it is skipped with "MongoDB containers are Linux-only in the smoke
test (Windows runners have Windows containers only, macOS runners no Docker)". The existing
"`THICKET_SMOKE_MONGO=1` + no runtime -> failure" behavior is unchanged. ARCHITECTURE.md sentence
updated. Tests: Linux runs, Windows/macOS skip with the reason, `THICKET_SMOKE_MONGO=1` runs on any OS,
defaults read `process.platform`/`process.env`.

Validation:
- `npx playwright test -c test/e2e/smoke/playwright.config.ts installed-app.smoke.ts` — Pass (29)
- `npm run test:smoke` — Pass (31; the Mongo test ran on Linux, not skipped)

### CR-2 — `npm run test:smoke` on a Windows workstation replaces and uninstalls the real Thicket

Files changed:
- `test/e2e/smoke/installed-app.ts`
- `test/e2e/smoke/installed-app.smoke.ts`
- `docs/ARCHITECTURE.md`

Problem:
The NSIS installer shares the uninstall entry with a real per-user install and replaces it; the
uninstaller ran asynchronously (relaunch from %TEMP%) and raced the `rm` of the folder.

Fix:
On `win32` with `CI` unset/empty, `installApp` refuses an `.exe` (before creating a temp folder or
starting the installer) unless `THICKET_SMOKE_ALLOW_INSTALL=1`, with an error explaining it would
replace and then uninstall an existing per-user Thicket installation. Cleanup runs the uninstaller
as `/S _?=<dir>` (verbatim, last) so it runs in place and is awaited, then removes the folder.
Documented in ARCHITECTURE.md. Tests (platform overridden to `win32`, env set per test and
restored): refusal without CI for unset/`0`/empty opt-in and for `CI=''`, installer never started;
installs with `CI=true`; installs with `THICKET_SMOKE_ALLOW_INSTALL=1`; guard does not apply on
Linux; uninstaller call asserted as `uninstall /S _?=<dir>`.

Validation:
- `npx playwright test -c test/e2e/smoke/playwright.config.ts installed-app.smoke.ts` — Pass

### CR-3 — Smoke test depends on the `EnableNodeCliInspectArguments` fuse

Files changed:
- `docs/ARCHITECTURE.md`
- `test/e2e/smoke/installer.smoke.ts` (header comment only)

Problem:
`_electron.launch` needs the inspect fuse; turning it off (packaged-hardening) would break only the
`v*` tag release smoke run, unseen by `.taskcheck`.

Fix:
Per the parent decision, documentation only: the installer smoke paragraph in ARCHITECTURE.md now
states that packaged builds must leave `EnableNodeCliInspectArguments` on, that turning it off breaks
this smoke test, and that this shows only on `v*` tag releases since `test:smoke` is not in
`.taskcheck`. electron-builder config untouched. Notifying the packaged-hardening owner is left to
the parent worker.

Validation:
- `npm run check` (prettier over the docs) — Pass

### CR-4 — The smoke spec re-implements harness fixtures

Files changed:
- `test/e2e/smoke/installer.smoke.ts`

Problem:
The failure-screenshot loop duplicated `screenshotWindows` from `test/e2e/harness/fixtures.ts`.

Fix:
Imports and calls `screenshotWindows(app, testInfo)`. The fixture definitions themselves were kept
(the parent decision limited the fix to `screenshotWindows`).

Validation:
- `npm run test:smoke` — Pass; `npm run check` (typecheck/lint) — Pass

### TW-1 (tests.md observation) — NSIS temp install folder leaked on failed install

Files changed:
- `test/e2e/smoke/installed-app.ts`
- `test/e2e/smoke/installed-app.smoke.ts`

Problem:
When the installer exited non-zero or produced no `Thicket.exe`, the `thicket-smoke-install-*` temp
folder was not removed.

Fix:
Installer run and `Thicket.exe` check are wrapped in try/catch that removes the folder and rethrows.
The two existing failure tests now assert the folder is gone (the exit-code test's stand-in installer
also writes a partial file first).

Validation:
- `npx playwright test -c test/e2e/smoke/playwright.config.ts installed-app.smoke.ts` — Pass

## Not fixed

None.

## Validation summary

Focused tests:
- `npx playwright test -c test/e2e/smoke/playwright.config.ts installed-app.smoke.ts` — Pass (29 passed)

Full test suite:
- `npm run test:smoke` against `apps/desktop/release/thicket-0.0.0-linux-x86_64.AppImage` — Pass
  (31 passed, incl. welcome screen and the containerized MongoDB connection test), run again after
  the final lint fix — Pass (31 passed)

Lint/type-check/build:
- `npm run check` (eslint, prettier, typecheck, Vitest 79 files / 4297 tests, renderer 100 files /
  3273 tests) — Pass (first run failed on `@typescript-eslint/no-dynamic-delete` in the new test
  helper; fixed with `Reflect.deleteProperty`, rerun passed)

`.taskcheck`:
- Pass (`.taskcheck` runs `npm run check`, run above on the final code)

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.

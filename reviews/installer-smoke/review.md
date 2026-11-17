# Code Review

Date: 2026-11-17

Task: installer-smoke - Release: smoke-test installers in CI

Scope: task commit eb45f46 on top of base f285d6e (`git diff f285d6e..eb45f46`), committed changes only

Requirements:
- tasks/installer-smoke.md (goal, acceptance criteria, recorded assumptions)
- SPEC.md, docs/ARCHITECTURE.md (Electron shell, Packaging, E2E harness), AGENTS.md
- Parent instructions (CI-only paths: NSIS silent install, hdiutil, xvfb/AppImage/AppArmor userns, Docker availability, `_electron.launch` against packaged apps)
- Related in-progress task tasks/packaged-hardening.md (Electron fuses)

Git range:
- Branch: main
- HEAD: eb45f4638be57ba123d913ddfaa5e6ab22dba5b0
- Base/start: f285d6e4e863a01d6b870aa598480edfb54a0f2f
- Commits reviewed: 1

Summary: 0 P0, 1 P1, 2 P2, 1 P3

Checked and found sound: Linux job (xvfb installed and used, `apparmor_restrict_unprivileged_userns=0` exists on ubuntu-24.04 x64 and arm, `APPIMAGE_EXTRACT_AND_RUN=1`, Docker present, `mongo:8.2` is multi-arch, `THICKET_SMOKE_MONGO=1` turns a missing runtime into a failure); installer globs match `artifactName` (`thicket-<v>-mac-arm64.dmg`, `*-win-x64.exe`, one AppImage per Linux job) and the "exactly one" guard; dmg handling (`hdiutil attach -nobrowse -readonly -mountpoint`, the `Applications` symlink is filtered out, detach on cleanup); NSIS `/S /D=<dir>` with `windowsVerbatimArguments` and `/D=` last, `productName` gives `Thicket.exe`/`Uninstall Thicket.exe`; `_electron.launch` without an app path argument for asar-packaged apps; `THICKET_USER_DATA` isolates user data in the packaged app (apps/desktop/src/main/index.ts:63); smoke config does not overlap with `test:e2e` (`*.e2e.ts`) or vitest; type check and lint cover `test/e2e/**`; failure artifacts go to `test-results/smoke`, which the upload step names; the smoke step fails the build job, so `release` (needs: build) makes no draft.

Evidence note (not a finding): criterion 1 ("Smoke test passes locally against the Linux AppImage") is still unrecorded in tasks/installer-smoke.md; the parent reports 2/2 locally and must record it with `tasks.py verify`. Criterion 2 is skipped with a reason (needs a pushed `v*` tag), which is appropriate.

## P0 Critical

None.

## P1 High

- [ ] **CR-1 | The MongoDB smoke test runs (and very likely fails) on the Windows runner instead of being skipped**
    - File: `test/e2e/smoke/installer.smoke.ts:123`
    - Category: Correctness
    - Problem: The Mongo test is skipped only when `containerRuntimeUnavailable()` reports no runtime. testcontainers' `NpipeSocketStrategy` (node_modules/testcontainers/build/container-runtime/strategies/npipe-socket-strategy.js) connects to `//./pipe/docker_engine` on every win32 host, and GitHub's `windows-latest` image ships a running Docker engine in Windows-containers mode. testcontainers records `OSType` but does not reject a Windows daemon (clients/client.js:109). So on the win-x64 job the runtime counts as available, and `startMongo('mongo8')` goes on to start the Linux-only Ryuk reaper image and then `mongo:8.2` against a Windows-container daemon. That fails, or at best pulls a multi-GB windowsservercore image and runs into the timeout. The Windows build job then goes red and blocks the draft release. This contradicts the task goal ("on Linux also connect") and the design described in docs/ARCHITECTURE.md and release.yml, which only set `THICKET_SMOKE_MONGO=1` on Linux.
    - Why it matters: Criterion 2 ("CI run green on all three OSes") would most likely fail on Windows on the first tag push. Because CI is the only place this can show, it would surface at release time.
    - Suggested fix: Run the Mongo test only on Linux or only when asked. For example, skip unless `process.platform === 'linux'` or `THICKET_SMOKE_MONGO` is set, or make `THICKET_SMOKE_MONGO=1` a requirement for running it at all (CI sets it on Linux) and skip otherwise. Keep the "required → throw" behavior for Linux. Update the ARCHITECTURE.md sentence to match.

## P2 Medium

- [ ] **CR-2 | Running `npm run test:smoke` on a Windows workstation replaces and then uninstalls the user's real Thicket installation**
    - File: `test/e2e/smoke/installed-app.ts:100`
    - Category: Correctness
    - Problem: The NSIS installer uses a fixed `appId`, so it shares one uninstall registry entry with any existing per-user installation. electron-builder's installer silently uninstalls the old version it finds there before it installs into `/D=<temp>`. `cleanup()` then uninstalls the temp copy. A developer who follows docs/ARCHITECTURE.md ("run `npm run dist` first", then `npm run test:smoke`) on Windows loses their installed Thicket. Separately, `run(uninstaller, ['/S'])` (line 110) returns at once: an NSIS uninstaller copies itself to %TEMP% and relaunches unless `_?=<dir>` is passed. The following `rm(dir)` therefore races the uninstall and can leave a stale Add/Remove Programs entry that points at a deleted folder. CI runners are ephemeral, so this affects only local runs. The harness elsewhere explicitly protects the real user's data (harness/fixtures.ts snapshot check).
    - Why it matters: A test command documented for local use has a destructive side effect on the developer's machine, and cleanup is unreliable.
    - Suggested fix: On Windows, refuse to run the NSIS path outside CI unless an explicit opt-in is set (for example `CI` or `THICKET_SMOKE_ALLOW_INSTALL=1`), or document the side effect next to the `test:smoke` entry in ARCHITECTURE.md. Run the uninstaller synchronously (`/S`, `_?=${dir}` as the last verbatim argument) before removing the folder.

- [ ] **CR-3 | The installer smoke test depends on the Node inspect fuse, which the in-progress packaged-hardening task is about to decide on without knowing about this test**
    - File: `test/e2e/smoke/installer.smoke.ts:72`
    - Category: Integration
    - Problem: `_electron.launch` drives the packaged executable through `--inspect=0`/`--remote-debugging-port=0`, so it requires the `EnableNodeCliInspectArguments` fuse to stay on. tasks/packaged-hardening.md (in progress by another agent, touching electron-builder.yml) says "decide on EnableNodeCliInspectArguments (the Playwright smoke test `scripts/smoke-packaged.mjs` needs inspect — keep it working or replace it)". It names only the older script, not `test/e2e/smoke`. If that task turns the fuse off, `.taskcheck` will not notice, because `test:smoke` runs only in release.yml on `v*` tags. The breakage would first show when every release build job fails.
    - Why it matters: A silent cross-task contract that breaks only at release time.
    - Suggested fix: Record the dependency where the other task will see it. Note in docs/ARCHITECTURE.md (Packaging/fuses or the smoke-test bullet) that `npm run test:smoke` needs `EnableNodeCliInspectArguments` on, and tell the packaged-hardening owner, for example with a task note or a follow-up task. Alternatively, have the smoke test fail with a clear message when the launch times out waiting for the inspector.

## P3 Low

- [ ] **CR-4 | The smoke spec re-implements harness fixtures instead of reusing them**
    - File: `test/e2e/smoke/installer.smoke.ts:56`
    - Category: Quality
    - Problem: `userDataDir`, `appOutput`, `window` and the failure-screenshot loop (lines 87-99) copy `test/e2e/harness/fixtures.ts`. That file already exports `screenshotWindows(app, testInfo)` for exactly this purpose. The repository now also has two packaged-app smoke tests with overlapping checks (`apps/desktop/scripts/smoke-packaged.mjs` and `test/e2e/smoke`).
    - Why it matters: Fixes to failure diagnostics or user-data handling have to be made in two places.
    - Suggested fix: Import and call `screenshotWindows` from the harness. Optionally extend the harness `test` with an `executablePath` override rather than redefining the fixtures.

## Review conclusion

Material issues found; fix before completing the task.

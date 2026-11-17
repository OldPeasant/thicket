# Code Review

Date: 2026-11-17

Task: installer-smoke - Release: smoke-test installers in CI

Scope: second pass over the final revision. The task's `installer-smoke:` commits on top of base 57ae6e16 (`git diff 57ae6e16..f300594f`), committed changes only. Covers the CDP-attach rewrite in f300594f and a re-check of the fixes for the first review's CR-1..CR-4.

Requirements:
- tasks/installer-smoke.md (goal, acceptance criteria, recorded assumptions incl. the CDP-attach assumption)
- SPEC.md, docs/ARCHITECTURE.md (Packaging, E2E harness, installer smoke test), AGENTS.md
- Parent instructions: review CI-only paths (Windows taskkill, macOS hdiutil-mounted app launched directly, AppImage process groups under xvfb-run, CDP attach on macOS/Windows)
- In-progress task packaged-hardening (origin/wip/packaged-hardening: electron-builder.yml `electronFuses`, main/renderer-source.ts), for compatibility only

Git range:
- Branch: main
- HEAD: f300594ffc75a418a772d102316fae438a6e9893
- Base/start: 57ae6e1619eb7fa2d48bc8cc98d0cad136c8b6b2
- Commits reviewed: 4 (10ee1bb4, 371a9b9f, de7470be, f300594f)

Summary: 0 P0, 0 P1, 0 P2, 0 P3

Status of the first review's findings:
- CR-1 (MongoDB test ran on Windows): fixed. `mongoSmokeSkipReason` (test/e2e/smoke/installed-app.ts:29) skips the test at describe level unless the platform is Linux or `THICKET_SMOKE_MONGO=1`, so no app launch and no testcontainers call happen on Windows or macOS. On Linux CI `THICKET_SMOKE_MONGO=1` still turns a missing runtime into a failure (installer.smoke.ts:236). Unit-checked in installed-app.smoke.ts.
- CR-2 (NSIS replaced a real install, asynchronous uninstall): fixed. installed-app.ts:113 refuses on win32 unless `CI` or `THICKET_SMOKE_ALLOW_INSTALL=1` is set (GitHub Actions sets `CI`). The uninstaller runs with `/S _?=<dir>` verbatim, so it runs in place and is awaited before `rm`. NSIS finds `_?=` by scanning for ` _?=`, so the unquoted verbatim argv[0] (`...\Uninstall Thicket.exe`) does not break parsing. The Windows runner temp path has no spaces. Documented in ARCHITECTURE.md.
- CR-3 (dependency on the inspect fuse): resolved by design. The test no longer uses `_electron.launch`: it spawns the executable with `--remote-debugging-port=0` and attaches with `chromium.connectOverCDP`. The packaged-hardening WIP flips only `runAsNode`, `enableNodeOptionsEnvironmentVariable`, `enableNodeCliInspectArguments`, `onlyLoadAppFromAsar` and `enableEmbeddedAsarIntegrityValidation`. None of them affects the Chromium `--remote-debugging-port` switch, and that task's own smoke script uses the same mechanism. Nothing in apps/desktop/src/main strips command-line switches or takes a single-instance lock. The remaining contract (the switch must keep working in packaged builds) is written down in ARCHITECTURE.md.
- CR-4 (duplicated harness code): partially moot. `screenshotWindows` needs an `ElectronApplication`, which a CDP-attached app does not have. `screenshotPages` (installer.smoke.ts:124) is the minimal page-based equivalent. Two small `userDataDir`/`appOutput` fixtures stay duplicated. This is acceptable, because the harness's `launchApp` (also `_electron.launch`) cannot drive a fused packaged build.

Checked and found sound in the final code:
- Spawn and attach (installer.smoke.ts:85-110): stdout and stderr are always consumed, so the pipes cannot fill and block the app. `devToolsEndpoint` resolves on Chromium's `DevTools listening on ws://...` stderr line. Playwright's own Electron and Chromium launchers rely on that line on all three OSes, including a Windows GUI-subsystem executable with piped stderr. The function rejects with the collected output when the app exits early or after 60 s, and removes its listeners in every path. `appWindow` selects the `thicket://app` page, not DevTools or other targets. Failure screenshots and app output are attached when the test fails.
- Linux (AppImage under `xvfb-run -a`): `headlessArgs()` returns no Ozone switch because `DISPLAY` is set. `detached: true` puts the AppImage runtime (extract-and-run), Electron and its helpers in one process group, and `process.kill(-pid)` ends them together. SIGKILL follows after 10 s, and the test waits for `exit`, not `close`, so inherited pipes cannot stall teardown. The AppArmor userns sysctl and `APPIMAGE_EXTRACT_AND_RUN=1` are unchanged from the first review.
- macOS: the executable is launched directly from the read-only `hdiutil` mount (`Thicket.app/Contents/MacOS/Thicket`, from `productName`). User data goes to `THICKET_USER_DATA`, so nothing is written to the image. Worker teardown kills the app before `hdiutil detach -force`, so a helper that is still closing cannot block the detach. MongoDB is skipped.
- Windows: no process group (`detached` false). `taskkill /pid <pid> /T /F` ends Electron, its renderer, GPU and utility processes (the backend). `child.kill` is the fallback. The workflow uses `shell: bash` at job level, so the bash smoke step works on windows-latest, and `resolve()` turns `out/x.exe` into an absolute path.
- Timeouts: the attach (60 s) plus the window (30 s) fit in the 90 s per-test budget. The MongoDB test raises its own timeout to 240 s. The worker-scoped install has 180 s.
- release.yml: the installer globs and the "exactly one" guard are unchanged and correct. `test-results/smoke` matches the config's `outputDir` for the failure upload. A failing smoke test fails the build job, and `release` (needs: build) then makes no draft.
- `installed-app.smoke.ts` (helper checks) also matches `*.smoke.ts` and runs inside `npm run test:smoke` on every OS. Tests that use POSIX shell stand-ins are skipped off Linux or on win32 as appropriate.

Notes (not findings, for the parent):
- Criterion 1 ("Smoke test passes locally against the Linux AppImage") is still unchecked in tasks/installer-smoke.md. The recorded assumption says the CDP version was verified against a fuse-flipped `linux-unpacked` copy. The criterion names the AppImage, so record a run of `npm run test:smoke` against the AppImage at the final revision (with `APPIMAGE_EXTRACT_AND_RUN=1` if FUSE is absent).
- reviews/installer-smoke/tests.md describes an earlier revision (it names 77b3b325 and predates the CDP rewrite). The test-writer has to run again on f300594f before the gate accepts it.
- The CDP helpers (`devToolsEndpoint`, `killTree`, `appWindow`) are covered only by the real smoke run. Their failure paths and the Windows `taskkill` branch run only in release CI (criterion 2, skipped with a reason).
- Once packaged-hardening lands, `apps/desktop/scripts/smoke-packaged.mjs` and this test will each contain their own CDP attach code. Merging the two is a follow-up for whichever task lands second, not a defect here.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

None.

## Review conclusion

No material issues found.

# Code Review

Date: 2026-11-17

Task: packaged-hardening - Harden the packaged app: Electron fuses (RunAsNode, NODE_OPTIONS, asar-only), ignore THICKET_DEV_SERVER/THICKET_RENDERER_DIR when packaged

Scope: committed changes of the task, `git diff c74ea81..HEAD` (package-lock checked, only the new devDependency line). The parent named task commit 8cfeed8. HEAD is now 99416b5, and `git diff 8cfeed8 99416b5` only changes `tasks/packaged-hardening.md` (verify records), so the reviewed code is the same.

Requirements:
- tasks/packaged-hardening.md (acceptance criteria and recorded assumptions)
- reviews/packaging/review.md CR-3 (origin)
- SPEC.md / docs/ARCHITECTURE.md (Electron shell, Packaging)
- AGENTS.md (Evidence, quality gate)

Git range:
- Branch: main
- HEAD: 99416b500287e066610070a85b6edd9be4304737
- Base/start: c74ea8166f401f147ac6917a4a7a5ec65cbc789d
- Commits reviewed: 8 (1 code commit: 99416b5, a rebased copy of 1f59518/8cfeed8; the rest are tasks.py assume/heartbeat/verify commits)
- Uncommitted changes: `apps/desktop/src/main/renderer-source.spec.ts` has 68 extra uncommitted lines, probably from the concurrent test-writer. They are not part of this review.

Summary: 0 P0, 0 P1, 0 P2, 2 P3

## Verification notes

- AC1 (fuses): `electron-builder.yml` sets `runAsNode: false`, `enableNodeOptionsEnvironmentVariable: false`, `enableNodeCliInspectArguments: false`, `onlyLoadAppFromAsar: true` and `enableEmbeddedAsarIntegrityValidation: true`. In app-builder-lib 26.18 (`platformPackager.js` 254-300), the fuses are flipped after `afterPack` and before `doSignAfterPack`. So the mac ad-hoc signing (`identity: '-'`) and Windows `signAndEditExecutable` run on the already-fused binary. `@electron/fuses` 1.8.0 is already in the lock tree (it is a dependency of electron-builder). The new devDependency only lets the smoke script import it. The smoke script's `FUSE_STATES` byte map (48/49/114/144) and its `FuseV1Options` indices match `@electron/fuses/dist/constants.js` and `config.js`. `getCurrentFuseWire` resolves `Thicket.app/Contents/MacOS/Thicket` to the Electron Framework binary, so the fuse read also works on macOS. The inspect decision (off, smoke test rewritten for CDP) is recorded as an assumption, as the criterion asks.
- AC2 (env overrides): `rendererSource` returns `resources/renderer` and no dev server when `packaged` is true, whatever the environment says. `index.ts` uses it for both `rendererDir` and the CSP (`contentSecurityPolicy(devServer)`), so a packaged app also cannot widen `connect-src`. Dev behaviour (`dev.mjs`, `dev.electron.spec.ts`) is unchanged. The unit tests cover packaged, dev and empty-string cases. The smoke run launches the app with a bogus `THICKET_DEV_SERVER` and `THICKET_RENDERER_DIR` and asserts a `thicket://app/` URL.
- AC3 (dist:dir + smoke, run-as-node): the smoke script's run-as-node probe is equivalent to the criterion's `ELECTRON_RUN_AS_NODE=1 thicket -e 1` (a printed marker instead of `1`, so the result can be observed). The recorded evidence includes a negative control (fuses flipped back on: RAN, LISTENING, FAILED), which shows the probes can detect the failure case. I did not re-run the packaged binary in this review. The verification rests on the recorded evidence, which matches the code.
- `packaging.spec.ts` now checks the packaged renderer path through `rendererSource` instead of a source-text match, and it asserts the fuse config and `asar !== false`. This is an improvement.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | Smoke script page selection can miss the window when it is still on about:blank at attach time**
    - File: `apps/desktop/scripts/smoke-packaged.mjs:167-171`
    - Category: Tests
    - Problem: After `connectOverCDP`, the script picks the page whose URL already starts with `thicket://`. Otherwise it waits for a new `page` event. `openWindow` creates the BrowserWindow first and calls `loadURL` afterwards. If the target already exists at attach time but is still on its initial blank URL, `find` returns undefined, no further `page` event arrives, and the run fails after the 60 s timeout. If instead the `page` event delivers the window before navigation, `waitForLoadState('load')` can resolve on the blank document. The following `page.evaluate(... globalThis.thicket ...)` then runs before the navigation (or during it, when the execution context is destroyed). Either way the result depends on timing, not on the app.
    - Why it matters: this smoke test is the release-level evidence for AC2/AC3 and for future packaging tasks. A timing-dependent failure here would be mistaken for a hardening regression, or would lead people to distrust the script.
    - Suggested fix: take the first page (`context.pages()[0] ?? await context.waitForEvent('page')`). Then wait for the expected origin with `await page.waitForURL(/^thicket:\/\/app\//, { timeout: TIMEOUT })`, or with a generic `waitForURL((u) => u.protocol !== 'about:')` followed by the existing URL assertion, so an env-override regression still reports the wrong URL rather than a timeout.

- [ ] **CR-2 | Residual remote-debugging surface of the packaged app is not documented**
    - File: `apps/desktop/electron-builder.yml:29-36`, `docs/ARCHITECTURE.md:399-409`
    - Category: Security
    - Problem: The hardening comment says the shipped executable "cannot be turned into a plain Node runtime". That is true. However, the packaged app still accepts Chromium's `--remote-debugging-port` (no fuse controls it), and the new smoke test depends on that. Anyone who can launch the binary with arguments can attach over CDP and drive the renderer. That includes calling the preload's `thicket.request` against the user's saved connections, whose secrets the backend fetches from the OS keychain under the app's identity. On macOS, keychain item access is tied to the app, so this is the same class of misuse that the RunAsNode and inspect fuses close for the main process. Neither the comment, ARCHITECTURE nor the assumption records this remaining gap as a known, accepted risk.
    - Why it matters: readers of the hardening docs could conclude that the packaged binary can no longer be scripted, and a later task could make decisions on that basis (for example signing/notarization or keychain ACLs).
    - Suggested fix: at minimum, state in the electron-builder.yml comment and in ARCHITECTURE "Packaging" that `--remote-debugging-port` stays available in packaged builds (used by the smoke test), and record it as an assumption for humans to confirm. Optionally add a follow-up task to refuse `remote-debugging-port` / `remote-debugging-pipe` in packaged builds (`app.commandLine.hasSwitch` early in main) and give the smoke test another attach path. Blocking it is outside this task's acceptance criteria.

## Review conclusion

No material issues found. The acceptance criteria are implemented, and the recorded evidence matches the code. The two P3 findings are optional robustness and documentation improvements.

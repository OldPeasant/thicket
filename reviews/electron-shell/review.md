# Code Review

Date: 2026-11-16

Task: electron-shell - M0: Electron main, preload, backend utilityProcess and port broker

Scope: second pass, `git diff 2693efc..HEAD -- . ':!tasks' ':!reviews'` (task commits 82b552e..a9562d7). Focus: the fixes for CR-1..CR-5 from the first pass (commit 6dd230b, `reviews/electron-shell/fixes.md`), the final code, and a final-pass check of commit a9562d7 (new `will-frame-navigate` test). Committed changes only.

Requirements:
- tasks/electron-shell.md acceptance criteria and recorded assumptions
- SPEC.md section 4 (thicket.request/cancel/on) and section 6 (renderer sandbox, CSP, navigation / window.open)
- docs/ARCHITECTURE.md "Electron shell (apps/desktop, M0)" and "API between parts"
- AGENTS.md (Evidence, quality gate)
- First-pass review (CR-1..CR-5) and reviews/electron-shell/fixes.md

Git range:
- Branch: main
- HEAD: a9562d7eea98c5c5a006e6b655f330359bffd9ba (final reviewed revision)
- Base/start: 2693efcf889a05c8ab14886508568ec74bbecf6d (origin/main)
- Commits reviewed: 6 (82b552e, 0526f2e, a42e950, 6cfe1a0, 6dd230b, a9562d7). The first pass covered the same code before it was rebased. The second pass read 6dd230b in full and rechecked the files it touches. The final pass reviewed `git diff 6dd230b a9562d7 -- apps/desktop` (only `apps/desktop/test/app.electron.spec.ts` changed; no production code changed). No uncommitted changes at start.

Commands run (read-only):
- `git show 6dd230b -- apps packages docs` -> reviewed in full
- Read `apps/desktop/scripts/dev.mjs`, `apps/desktop/src/main/index.ts`, `apps/desktop/test/app.electron.spec.ts`, `apps/desktop/src/preload/bridge.ts` (receive/emit), `apps/desktop/vitest.electron.config.ts`
- `grep` of the renderer, desktop and root `package.json` scripts -> renderer `dev` is `ng serve`, so the dev spec's direct `ng.js serve --port` matches what `dev.mjs` starts through `npm run dev -w packages/renderer -- --port`
- `apps/desktop/tsconfig.json` includes `test/**/*.ts` -> the new `helpers.ts` and `dev.electron.spec.ts` are type-checked by `npm run check`
- `vitest.electron.config.ts` includes `test/**/*.electron.spec.ts` with `fileParallelism: false` -> the dev spec runs and does not start a second Electron while the app spec runs
- playwright-core version 1.65.1 (has `page.consoleMessages()`)
- Final pass: `git diff 6dd230b a9562d7 -- apps/desktop`; read `apps/desktop/src/main/index.ts:55-67` and `apps/desktop/src/main/security.ts:87-91` (`blockNavigation`)
- Final pass: `npm run test:electron -w apps/desktop` at a9562d7 -> build OK, 2 test files / 12 tests passed (5.06 s), run by the reviewer on this machine's display

Verification of first-pass findings:
- CR-1 (dev path not tested): Resolved. `dev.electron.spec.ts` starts `ng serve` on a free port and launches the built app with `THICKET_DEV_SERVER`. It asserts the dev-server URL, the CSP header (including `ws://localhost:<port>` in `connect-src`) on a response that passes through `onHeadersReceived`, `app.ping` from main, `backend.ping` from the backend with `mainReachable: true`, and no console CSP violations. `ng serve` runs in its own process group, which is killed in `afterAll`. `scripts/dev.mjs` itself is still not executed by a test, and fixes.md says so. The parent's evidence for criterion 1 should name `dev.electron.spec.ts` and say that it covers the mechanism `dev.mjs` uses. It should also say the test ran with the display or headless fallback, not with xvfb-run (see the existing assumption). See CR-1 below for one weakness in the CSP-violation check.
- CR-2 (dev.mjs leftovers, build comment): Resolved. `waitFor` failure now logs and calls `stopAll(1)`, which kills the children and exits before Electron is spawned (`dev.mjs:53-59`). The `build.mjs` header no longer claims `npm run dev` uses `--watch`.
- CR-3 (`window` doc comment): Resolved (`protocol.ts:9-16`). The comment now describes the host's per-load connection counter.
- CR-4 (ARCHITECTURE stream-owner map): Resolved (`ARCHITECTURE.md:145-149`). It now says the preload keeps the map, which matches `bridge.ts:175`. Main forwarding of proxied `io.*` stream cancels is marked as a later task.
- CR-5 (`will-frame-navigate` not registered): Resolved (`index.ts:62-66`). Subframe navigations (`!event.isMainFrame`) are always blocked and logged. Main-frame navigations stay with `will-navigate`, so same-document checks still apply. The `security.ts` comment matches. Since a9562d7 the wiring is also covered by an Electron test (see the final-pass section).
- Test-writer note (bridge buffering with `on(listener)`): the new JSDoc (`bridge.ts:26-29`) matches `receive()`/`emit()` (`bridge.ts:177`, `bridge.ts:200-203`).

No new correctness, security or integration problems were found in the fix commit. `helpers.ts` keeps the earlier launch behavior (same args and env, plus optional extra env) and adds `freePort`/`waitForUrl`. The `app.electron.spec.ts` refactor keeps every assertion unchanged.

## Final pass: commit a9562d7 (will-frame-navigate test)

The new test (`apps/desktop/test/app.electron.spec.ts:105-138`) runs in the Electron main process via `app.evaluate`, takes the single window's `webContents`, and emits synthetic `will-frame-navigate` events (plain objects with `isMainFrame`, `url`, `preventDefault`) to the listeners `index.ts` registered. The comment explains why: the CSP `frame-src 'none'` stops a real iframe before Electron emits the event, so a real subframe navigation cannot be produced here.

- Does it exercise the guard: yes, for the wiring in main. If the `index.ts:63-66` listener were removed, or its `!event.isMainFrame` branch did not call `preventDefault`, `subframe` would be `false` and the test fails. If the listener blocked main-frame events unconditionally (for example `blockNavigation(event)` without the frame check), `mainFrame` would be `true` and the test fails. The log assertion checks the `[main] blocked frame navigation to ...` line that comes from the same listener. It does not exercise Chromium's real event delivery for subframes; that limitation is stated in the test comment and is reasonable given the CSP.
- Correctness: `blockNavigation(event)` with no URL always prevents (`security.ts:87-91`), which is what the test expects for subframes. `listenerCount >= 1` is a weak but harmless sanity check; the `subframe` assertion is the real one.
- Flakiness: low. The events are synchronous inside one `evaluate`, the log check uses `expect.poll` with a 5 s timeout, and the final `page.url()` check needs no wait because synthetic events do not navigate. The test does not change shared state for later tests (`restarts a killed backend` still passes in the reviewer's run).
- One weakness, see CR-2 below.

Summary: 0 P0, 0 P1, 0 P2, 2 P3

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | Dev-mode CSP-violation check may miss violations that happen during the initial load**
    - File: `apps/desktop/test/dev.electron.spec.ts:61`
    - Category: Tests
    - Problem: The `console` listener is attached only after `await app.firstWindow()` resolves. Console messages the page logs before that (for example a CSP refusal of the dev server's client script or live-reload WebSocket during the first load) are not collected. Playwright does not replay earlier events to a new `page.on('console')` listener. So the check "reports no Content Security Policy violations" only covers messages logged after the listener is attached, plus the 1 s wait.
    - Why it matters: This was the regression the first-pass CR-1 was about: a dev-server script or socket blocked by the CSP header. The test can still pass when that block happens early in the load.
    - Suggested fix: Also check `page.consoleMessages()` (available in the installed playwright-core 1.65.1; it returns messages logged since the page was created). Or attach the listener, then `page.reload()` and wait for the load before asserting.

- [ ] **CR-2 | Main-frame case of the will-frame-navigate test uses a same-document URL, so it does not pin "left to will-navigate"**
    - File: `apps/desktop/test/app.electron.spec.ts:116`
    - Category: Tests
    - Problem: The synthetic main-frame event uses `thicket://app/index.html#main`, which differs from the current page only by fragment. If the listener were changed to `blockNavigation(event, event.url, contents.getURL())` for every frame (dropping the `isMainFrame` split), the subframe URL would still be blocked and the main-frame URL would still pass as same-document, so the test would stay green although the main frame is no longer "left to will-navigate" as the test name claims. The `not.toContain('blocked frame navigation to thicket://app')` assertion has the same blind spot.
    - Why it matters: Small: behavior for real main-frame navigations is still guarded by `will-navigate`. But the test claims to verify the frame split and would not catch its removal.
    - Suggested fix: Use a cross-document URL for the main-frame event (for example `https://main.example.test/`) and keep asserting `mainFrame === false` and no "blocked frame navigation" log for it.

## Review conclusion

No material issues found. CR-1..CR-5 from the first pass are resolved in 6dd230b, and commit a9562d7 adds a working, low-flakiness test for the `will-frame-navigate` subframe guard (reviewer run: 2 files / 12 tests passed). The two findings (CR-1, CR-2, both P3) are small test-robustness improvements and do not block completion. Final reviewed revision: a9562d7eea98c5c5a006e6b655f330359bffd9ba. The parent still has to record evidence for each acceptance criterion. For criterion 1, the evidence should name `dev.electron.spec.ts` and the display configuration actually used.

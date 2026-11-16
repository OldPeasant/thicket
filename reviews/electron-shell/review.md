# Code Review

Date: 2026-11-16

Task: electron-shell - M0: Electron main, preload, backend utilityProcess and port broker

Scope: `git diff b93d0f2..HEAD -- . ':!tasks' ':!reviews'` (task commits 89a69ae, ca88857, 18f97c6), committed changes only

Requirements:
- tasks/electron-shell.md acceptance criteria and recorded assumptions
- SPEC.md section 4 (thicket.request/cancel/on) and section 6 (renderer sandbox, CSP, navigation / window.open)
- docs/ARCHITECTURE.md "Processes" and "Electron shell (apps/desktop, M0)", "API between parts" (cancel routing)
- AGENTS.md (Evidence, quality gate)
- Compatibility target: `origin/wip/api-client:packages/renderer/src/app/api/thicket-bridge.ts`

Git range:
- Branch: main
- HEAD: 18f97c6287496989a8bda6ccea6de951feb57126
- Base/start: b93d0f27ec0c9375109365a71c4c820b97163e18
- Commits reviewed: 3 (89a69ae, ca88857, 18f97c6); no uncommitted changes at start

Commands run (read-only):
- `git diff --stat b93d0f2..HEAD -- . :!tasks :!reviews` -> 39 files, +2805/-9
- `git diff b93d0f2..HEAD -- packages/contract/src packages/backend/src/index.ts <package.json files>` -> reviewed
- `git show origin/wip/api-client:packages/renderer/src/app/api/thicket-bridge.ts` -> interface compatible (request/cancel/on(listener))
- `git show HEAD:vitest.config.ts`, `grep include vitest.shared.ts` -> `test/app.electron.spec.ts` is outside the unit include (`src/**/*.spec.ts`), so not part of `npm run check`
- `git check-ignore -v apps/desktop/dist/main.cjs` -> ignored by `.gitignore:3 dist/`
- `grep inlineCritical packages/renderer/angular.json` -> `inlineCritical: false` (no inline `onload` handlers that the CSP would block)
- `python tasks.py verify electron-shell` -> not permitted in this session; the task file shows no criteria verified yet
- Tests were not re-run by the reviewer; the parent reports `npm run check` and `npm run test:electron -w apps/desktop` passing.

Summary: 0 P0, 0 P1, 1 P2, 4 P3

Verified without findings:
- BrowserWindow: `sandbox`, `contextIsolation`, `nodeIntegration: false` (+ worker/subframe, `webviewTag: false`) in `security.ts:39`; CSP sent as response header for `thicket://` (`index.ts:89`) and for http(s) via `onHeadersReceived` (`index.ts:109`); CSP matches ARCHITECTURE (`default-src 'self'; script-src 'self'`, inline styles documented at ARCHITECTURE.md:43).
- `window.open` denied and navigation / redirects / webviews blocked for every web contents (`index.ts:53`); permissions denied. Unit-tested in `security.spec.ts`, also exercised in the Electron test.
- `resolveAppFile`: host and scheme checked, percent-decoded `..`, `.`, `\`, NUL segments refused (including `%2F`-smuggled separators); malformed escapes refused.
- Privileged port: created per backend process in main, transferred only to the utilityProcess (`backend-host.ts:111`); `privilegedMethods` are not in `methods`, so `route()` and the renderer-facing `serve()` answer `UNKNOWN_METHOD`; the preload has no IPC path to obtain it. Tested in unit and Electron tests.
- Cancel: `serve()` answers `CANCELLED` at once, aborts the handler signal, drops the late result; the preload routes cancel by request owner or stream owner and answers queued requests locally.
- Restart: exit detected, stale exits ignored, back-off capped, `stop()` cancels pending restarts; preload fails old requests with `INTERNAL`, ends streams with `error`, emits `backend.restarted`.
- `window.thicket` shape is compatible with the wip/api-client `ThicketBridge` (`request` resolves with `Response`, `cancel(id)`, `on(listener)` returning an unsubscribe function).

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | `npm run dev` path of criterion 1 is not exercised by any test**
    - File: `apps/desktop/test/app.electron.spec.ts:36`
    - Category: Tests
    - Problem: Criterion 1 starts with "`npm run dev` starts the app". The Electron integration test launches the bundled app with `electron .` against the built renderer on `thicket://app` (it asserts `page.url()` is `thicket://app/index.html`). The dev path is different code: `scripts/dev.mjs` orchestration (build, `ng serve`, wait, Electron with `THICKET_DEV_SERVER`), the renderer loaded from `http://localhost:4200`, the CSP applied through `session.webRequest.onHeadersReceived` together with the renderer's own CSP meta tag, and `connect-src` for the live-reload socket. None of that runs in any test, and the criterion also names xvfb-run, which the assumption says was not available.
    - Why it matters: Evidence recorded for criterion 1 from `npm run test:electron` alone would not show that `npm run dev` starts the app. For example, a dev-server script or socket blocked by the CSP header would go unnoticed.
    - Suggested fix: Run `npm run dev` yourself, call `app.ping` and `backend.ping` from the dev window (DevTools or a small Playwright run with `THICKET_DEV_SERVER`), and record that run in the evidence. If you can't, mark that part `--skip` with the reason. Record the integration test run as evidence for the ping half only.

## P3 Low

- [ ] **CR-2 | `npm run dev` can leave `ng serve` running after a startup failure; build comment claims dev uses `--watch`**
    - File: `apps/desktop/scripts/dev.mjs:53`
    - Category: Quality
    - Problem: If `waitFor(devServer, 120_000)` throws, the top-level await rejects and Node exits without calling `stopAll`. The spawned `ng serve` child is not detached, but it is not killed either, so it keeps running and holds port 4200. Separately, `scripts/build.mjs:3` says "`--watch` rebuilds on change (npm run dev)", but `dev.mjs:42` runs the build without `--watch`, which matches the documented "changes need a restart".
    - Why it matters: The next `npm run dev` fails because the port is taken. The comment misleads anyone maintaining the dev loop.
    - Suggested fix: Wrap `waitFor` in `try`/`catch` and call `stopAll(1)` on failure. Fix the `build.mjs` comment, or remove the unused watch mode.

- [ ] **CR-3 | `renderer` control message's `window` documented as `webContents.id` but carries an internal counter**
    - File: `packages/backend/src/server/protocol.ts:9`
    - Category: Quality
    - Problem: The doc comment says `window` is the "Electron `webContents.id`, for logs". `BackendHost.broker` sends `sink.id` (`backend-host.ts:126`), a host-local counter that also increments on every page reload.
    - Why it matters: Backend log lines ("renderer N disconnected") can't be correlated with Electron's webContents ids as the comment promises.
    - Suggested fix: Update the comment to describe the real value (a connection id per window load), or pass `webContents.id` through `connectRenderer`.

- [ ] **CR-4 | ARCHITECTURE contradicts itself on who keeps the streamId -> owner map**
    - File: `docs/ARCHITECTURE.md:146`
    - Category: Integration
    - Problem: "API between parts" says the stream owner map is "kept by `main`". The new "Electron shell" section (`ARCHITECTURE.md:104`) and the implementation (`bridge.ts:53`) keep it in the preload. The preload sends a stream cancel straight to the process that answered the request.
    - Why it matters: Later tasks for main-routed `io.*` streams (whose cancels must reach the backend) will read two different designs.
    - Suggested fix: Change line 146 to say the preload keeps the map, and that main forwards cancels of streams it proxies to the backend.

- [ ] **CR-5 | `blockNavigation` documents `will-frame-navigate`, but it is not registered**
    - File: `apps/desktop/src/main/security.ts:83`
    - Category: Quality
    - Problem: The doc comment lists `will-frame-navigate` among the events it guards. `index.ts:53-63` registers only `will-navigate`, `will-redirect` and `will-attach-webview`. Subframes are prevented by CSP `frame-src 'none'`, so this is not exploitable today.
    - Why it matters: A reader may assume subframe navigation is guarded in main when it is guarded only by the CSP.
    - Suggested fix: Register `will-frame-navigate` with the same guard, or remove it from the comment.

## Review conclusion

Material issues found; fix before completing the task. No P0 or P1 defects in the code. The one material item (CR-1) is missing evidence for the `npm run dev` part of criterion 1. Add that evidence, or skip that part with a reason, before `done`. CR-2 to CR-5 are small cleanups.

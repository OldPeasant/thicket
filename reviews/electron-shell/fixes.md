# Fix Report

Date: 2026-11-16

Task: electron-shell - M0: Electron main, preload, backend utilityProcess and port broker

Scope: current task; findings CR-1..CR-5 from `reviews/electron-shell/review.md` and test-writer observation 2 (Bridge buffering with `on(listener)`) from `reviews/electron-shell/tests.md`, as approved by the parent worker. Uncommitted working-tree changes on top of 57bad2a.

## Fixed findings

### CR-1 — `npm run dev` path of criterion 1 is not exercised by any test

Files changed:
- `apps/desktop/test/dev.electron.spec.ts` (new)
- `apps/desktop/test/helpers.ts` (new)
- `apps/desktop/test/app.electron.spec.ts`
- `docs/ARCHITECTURE.md`

Problem:
Only the packaged path (`thicket://app`) was tested; the dev path (renderer from `ng serve`, Electron with `THICKET_DEV_SERVER`, CSP added through `session.webRequest.onHeadersReceived`, `connect-src` for the live-reload socket) never ran in a test.

Fix:
New Electron integration test `dev.electron.spec.ts` (picked up by `vitest.electron.config.ts`). `beforeAll` picks a free port, spawns `ng serve --port <port>` (Angular CLI `bin/ng.js` run with Node, cwd `packages/renderer`, `NG_CLI_ANALYTICS=false`) in its own process group, waits until it answers, then launches Electron with `THICKET_DEV_SERVER=http://localhost:<port>`. This is the same mechanism `scripts/dev.mjs` uses. It checks that the page URL is the dev server, that `fetch(location.href)` from the page carries the CSP header (`default-src 'self'`, `script-src 'self'`, `ws://localhost:<port>` in `connect-src`), that `app.ping` is answered by main and `backend.ping` by the backend with `mainReachable: true`, and that the console shows no Content Security Policy violations. `afterAll` closes Electron and sends SIGTERM to the whole `ng serve` process group. The shared launch code (Electron path, headless args, `launchApp`, `freePort`, `waitForUrl`, page types) moved to `test/helpers.ts`, and `app.electron.spec.ts` now uses it (no behaviour change). ARCHITECTURE "Tests" names the new spec. `scripts/dev.mjs` itself still isn't run by a test (it waits for interactive use). The test covers its mechanism.

Validation:
- `npm run test:electron -w apps/desktop` — Pass (2 files, 11 tests; dev spec 4 tests)
- `pgrep -af "ng.js serve"` and `pgrep -af esbuild` after the run — no leftover processes

### CR-2 — `npm run dev` can leave `ng serve` running; build comment claims dev uses `--watch`

Files changed:
- `apps/desktop/scripts/dev.mjs`
- `apps/desktop/scripts/build.mjs`

Problem:
A `waitFor` timeout rejected the top-level await without stopping the spawned `ng serve`. The `build.mjs` header said `--watch` is used by `npm run dev`, but it is not.

Fix:
`waitFor` is wrapped in `try`/`catch`. On failure the script prints `[dev] <message>` and calls `stopAll(1)`, which kills the children. The `build.mjs` comment now says `--watch` is for manual use only: `npm run dev` bundles once, so changes to main, preload or backend need a restart.

Validation:
- `npm run check` — Pass (lint and prettier cover the scripts)

### CR-3 — `renderer` control message's `window` documented as `webContents.id`

Files changed:
- `packages/backend/src/server/protocol.ts`

Problem:
The doc comment said `window` is Electron's `webContents.id`, but `BackendHost` sends its own per-connection counter.

Fix:
The doc comment now says it is the host's renderer connection counter: a new value per window load, also on reload, and not `webContents.id`. It is used for logs. Only the comment changed.

Validation:
- `npm run check` — Pass

### CR-4 — ARCHITECTURE contradicts itself on who keeps the streamId -> owner map

Files changed:
- `docs/ARCHITECTURE.md`

Problem:
"API between parts" said `main` keeps the streamId -> owner map. The implementation and the "Electron shell" section keep it in the preload.

Fix:
"Cancel routing" now says the preload sends `cancel` and keeps the streamId -> owner map, filled from responses with a `streamId`. For main-routed `io.*` streams, `main` forwards cancels of the streams it proxies to the backend (a later task).

Validation:
- `npx prettier --check docs/ARCHITECTURE.md apps/desktop` — Pass

### CR-5 — `blockNavigation` documents `will-frame-navigate`, but it is not registered

Files changed:
- `apps/desktop/src/main/index.ts`
- `apps/desktop/src/main/security.ts`

Problem:
The `blockNavigation` comment listed `will-frame-navigate`, but no handler was registered. Subframe navigation was guarded only by the CSP `frame-src 'none'`.

Fix:
Main now registers `will-frame-navigate` for every web contents. Electron 45 types it as `Event<WebContentsWillFrameNavigateEventParams>`. For a subframe (`!event.isMainFrame`) the handler calls `blockNavigation(event)`, which always blocks when no url/current is given, and logs it. Main-frame navigation stays with `will-navigate`, so same-document hash changes are still allowed. The `security.ts` comment now says "subframes only" and describes the always-block case.

Validation:
- `npm run check` — Pass (type check accepts the event typing; `security.spec.ts` unchanged and passing)
- `npm run test:electron -w apps/desktop` — Pass (navigation guard test and dev-mode load unaffected)

### TW-note-2 — Bridge buffering with `on(listener)` undocumented

Files changed:
- `apps/desktop/src/preload/bridge.ts`

Problem:
When an every-event listener exists, events of a new stream are not buffered for a later `on(stream)` listener. This was not documented on the public API.

Fix:
Behaviour unchanged. The `ThicketApi.on` JSDoc now says that early events of a stream are buffered and replayed to its first `on(stream)` listener only while no `on(listener)` (every-event) listener is registered, both when the stream starts and when its events arrive.

Validation:
- `npm run check` — Pass (bridge unit tests unchanged and passing)

## Not fixed

None.

## Validation summary

Focused tests:
- `npm run test:electron -w apps/desktop` — Pass: 2 test files, 11 tests (`app.electron.spec.ts` 7, `dev.electron.spec.ts` 4), with `--ozone-platform=headless` when no display is set (existing helper logic)

Full test suite:
- `npm run check` — Pass: eslint + prettier, tsc for all workspaces, root vitest 12 files / 738 tests, renderer `ng test` 2 files / 46 tests

Lint/type-check/build:
- Included in `npm run check` (Pass). `node scripts/build.mjs` ran as part of `test:electron` (Pass).

`.taskcheck`:
- Pass (`.taskcheck` runs `npm run check`, run directly above)

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.

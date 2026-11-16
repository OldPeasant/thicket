---
title: M0: Electron main, preload, backend utilityProcess and port broker
status: in_progress
owner: dell26/agent-2
deps: [contract,renderer-scaffold]
touches: [apps/desktop/src/main,apps/desktop/src/preload,apps/desktop/package.json,packages/backend/src/server]
prio: 1
lease_until: 2026-11-16T18:51:50Z
---
## Goal
Electron app that opens a sandboxed window with the renderer build, starts the backend in a utilityProcess, brokers a MessagePort between them, and routes requests by `route(method)` to main or backend. Exposes only `window.thicket.request/cancel/on` in the preload.

## Acceptance criteria
- [ ] `npm run dev` starts the app; a `app.ping` request from the renderer gets an answer from main and `conn.ping` (or equivalent) from the backend — shown by an integration test that starts Electron headless (xvfb-run on Linux)
- [ ] BrowserWindow has sandbox, contextIsolation, no nodeIntegration, CSP header per docs/ARCHITECTURE.md; `window.open` and navigation are blocked (unit test on the handlers)
- [ ] Killing the backend process is detected; it is restarted and the renderer receives a `backend.restarted` event (test)
- [ ] Cancel: a long dummy backend request is cancelled via `thicket.cancel(id)` and answers `CANCELLED` (test)
- [ ] Main ↔ backend privileged port exists for secrets (stub handler) and is not reachable from the renderer

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-16 19:20+0100 by dell26/agent-2): Wiring diagnostics live in the contract: app.ping (main), backend.ping (backend, also checks the privileged port) and backend.sleep (cancellable wait for the cancel test) instead of conn.ping, which would need a profile/connection
- ASSUMPTION (2026-11-16 19:20+0100 by dell26/agent-2): thicket.request takes a full {id,method,params} Request and resolves with the Response (never rejects for contract errors); thicket.on accepts (stream, listener) or (listener) for all events, matching the interface wip/api-client already assumes
- ASSUMPTION (2026-11-16 19:20+0100 by dell26/agent-2): Renderer served from a custom thicket://app protocol (CSP as response header) rather than file://, since webRequest headers do not apply to file:// loads; packaged path for the renderer dir is left to the packaging task (THICKET_RENDERER_DIR / default packages/renderer/dist)
- ASSUMPTION (2026-11-16 19:20+0100 by dell26/agent-2): Electron integration test uses playwright-core _electron (npm run test:electron, not part of check). No xvfb-run on this machine: without DISPLAY/WAYLAND_DISPLAY it falls back to --ozone-platform=headless; here it ran against the desktop session display
- ASSUMPTION (2026-11-16 19:20+0100 by dell26/agent-2): Requests running in a backend that died answer INTERNAL ('process restarted') and its streams end with an error event; npm run dev reloads only the renderer (ng serve), main/preload/backend changes need a restart

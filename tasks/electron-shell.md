---
title: M0: Electron main, preload, backend utilityProcess and port broker
status: todo
owner:
deps: [contract,renderer-scaffold]
touches: [apps/desktop/src/main,apps/desktop/src/preload,apps/desktop/package.json,packages/backend/src/server]
prio: 1
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

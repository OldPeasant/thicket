---
title: Harden the packaged app: Electron fuses (RunAsNode, NODE_OPTIONS, asar-only), ignore THICKET_DEV_SERVER/THICKET_RENDERER_DIR when packaged
status: in_progress
owner: dell26/agent-3
deps: [packaging]
touches: [apps/desktop/electron-builder.yml,apps/desktop/src/main]
prio: 3
lease_until: 2026-11-17T05:22:29Z
---
## Goal
From the packaging review (reviews/packaging/review.md, CR-3): the packaged app keeps Electron's
defaults, so `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and loading code outside the asar work, and
`THICKET_DEV_SERVER` / `THICKET_RENDERER_DIR` still change what a packaged app loads.

## Acceptance criteria
- [ ] `electronFuses` in electron-builder.yml: RunAsNode off, EnableNodeOptionsEnvironmentVariable off, OnlyLoadAppFromAsar on, EnableEmbeddedAsarIntegrityValidation where supported; decide on EnableNodeCliInspectArguments (the Playwright smoke test `scripts/smoke-packaged.mjs` needs inspect — keep it working or replace it)
- [ ] Packaged app ignores THICKET_DEV_SERVER and THICKET_RENDERER_DIR (tests/test-only overrides only in dev)
- [ ] `npm run dist:dir -w apps/desktop` + `node scripts/smoke-packaged.mjs release/linux-unpacked/thicket` -> smoke OK; `ELECTRON_RUN_AS_NODE=1 release/linux-unpacked/thicket -e 1` does not run Node

## Notes
See SPEC.md and docs/ARCHITECTURE.md (Electron shell, Packaging).
- ASSUMPTION (2026-11-17 06:07+0100 by dell26/agent-3): EnableNodeCliInspectArguments fuse is OFF; the packaged smoke test was rewritten to attach over CDP (--remote-debugging-port, a Chromium switch no fuse controls) instead of Playwright's _electron driver, which needs --inspect. Main-process checks (isPackaged, app name) were replaced by app.ping, the fuse wire read and runtime probes.
- ASSUMPTION (2026-11-17 06:07+0100 by dell26/agent-3): NODE_OPTIONS hardening is verified by reading the fuse wire only: Electron already drops --require etc. from NODE_OPTIONS in packaged apps even with the fuse on (shown by an unfused control), so no runtime probe can observe it.

---
title: M0: Playwright end-to-end harness for the Electron app
status: in_progress
owner: felix/agent-2
deps: [electron-shell,int-harness]
touches: [test/e2e/harness,playwright.config.ts,package.json]
prio: 1
lease_until: 2026-11-16T19:39:47Z
---
## Goal
Playwright `_electron` launches the built app with an isolated userData dir; helpers to start a MongoDB fixture from int-harness when available; `npm run test:e2e`.

## Acceptance criteria
- [ ] `npm run test:e2e` builds the app and a smoke test sees the main window title (xvfb-run on Linux)
- [ ] Each test gets a fresh temporary userData directory (assert no writes to the real one)
- [ ] Screenshot on failure saved under test-results/ (git-ignored)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.

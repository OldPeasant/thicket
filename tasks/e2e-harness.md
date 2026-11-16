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
- ASSUMPTION (2026-11-16 20:20+0100 by felix/agent-2): Use @playwright/test 1.65.1 (same version as playwright-core) as the e2e runner, not Vitest: the task names playwright.config.ts and test-results/ screenshots, which are Playwright Test conventions; e2e specs are test/e2e/**/*.e2e.ts so the Vitest projects never pick them up
- ASSUMPTION (2026-11-16 20:20+0100 by felix/agent-2): 'No writes to the real userData' is enforced per test by snapshotting (paths, sizes, mtimes) Electron's default userData folder (appData + app name, cross-checked against the running app) before launch and comparing after close; Chromium caches outside userData are not tracked

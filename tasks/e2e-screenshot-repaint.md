---
title: Test: screenshots after view switches don't hang on headless Linux
status: todo
owner:
deps: [e2e-harness]
touches: [test/e2e/harness]
prio: 2
---
## Goal
On headless Linux (no DISPLAY, Chromium's headless Ozone), `page.screenshot()` hangs until it times out after a click switches the collection view (e.g. Table → Documents): the hidden window produces no new frame, so Playwright waits forever. `webContents.capturePage()` returns but shows the view from *before* the switch. A workaround that worked on 2026-11-17: in the main process, call `webContents.invalidate()`, wait about 400 ms and capture, three times, then use the last capture. Add a harness helper, e.g. `screenshot(electronApp, window, path)`, that reliably shows the current state (find the cleanest fix: force repaints, `backgroundThrottling: false` / paint settings for test windows only, or the invalidate loop), and use it in place of `window.screenshot` in the existing e2e suites. The `final-demo` task needs screenshots of every step and will hit this.

## Acceptance criteria
- [ ] Harness e2e test: after switching views several times, each screenshot shows the new view (e.g. checked via a DOM marker drawn in a distinctive colour, or by comparing against the previous capture) and none times out; run headless with DISPLAY and WAYLAND_DISPLAY unset
- [ ] Existing suites that take screenshots use the helper; `npm run test:e2e` passes headless
- [ ] docs/ARCHITECTURE.md e2e section says to use the helper and why

## Notes
See SPEC.md and docs/ARCHITECTURE.md.

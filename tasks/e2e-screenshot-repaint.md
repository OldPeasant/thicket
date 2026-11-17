---
title: Test: screenshots after view switches don't hang on headless Linux
status: in_progress
owner: dell26/agent-1
deps: [e2e-harness]
touches: [test/e2e/harness]
prio: 2
lease_until: 2026-11-17T05:46:11Z
---
## Goal
On headless Linux (no DISPLAY, Chromium's headless Ozone), `page.screenshot()` hangs until it times out after a click switches the collection view (e.g. Table → Documents): the hidden window produces no new frame, so Playwright waits forever. `webContents.capturePage()` returns but shows the view from *before* the switch. A workaround that worked on 2026-11-17: in the main process, call `webContents.invalidate()`, wait about 400 ms and capture, three times, then use the last capture. Add a harness helper, e.g. `screenshot(electronApp, window, path)`, that reliably shows the current state (find the cleanest fix: force repaints, `backgroundThrottling: false` / paint settings for test windows only, or the invalidate loop), and use it in place of `window.screenshot` in the existing e2e suites. The `final-demo` task needs screenshots of every step and will hit this.

## Acceptance criteria
- [x] Harness e2e test: after switching views several times, each screenshot shows the new view (e.g. checked via a DOM marker drawn in a distinctive colour, or by comparing against the previous capture) and none times out; run headless with DISPLAY and WAYLAND_DISPLAY unset
  - verified (2026-11-17 06:16+0100 by dell26/agent-1): npx playwright test screenshot.e2e --repeat-each=3 (spec deletes DISPLAY/WAYLAND_DISPLAY/THICKET_TEST_HEADLESS in beforeAll -> --ozone-platform=headless) -> 12 passed in 13 s: 5 view switches (welcome->editor->welcome->Compass import->welcome->editor) each PNG shows the marker colour drawn after the switch, differs from the previous PNG, each capture < 4 s (no timeout); element shot + repaint fallback also pass. Without --ozone-override-screen-size the same spec fails (window 1x1, page.screenshot Timeout 5000ms, clicks 'outside of the viewport')
- [ ] Existing suites that take screenshots use the helper; `npm run test:e2e` passes headless
- [x] docs/ARCHITECTURE.md e2e section says to use the helper and why
  - verified (2026-11-17 06:16+0100 by dell26/agent-1): docs/ARCHITECTURE.md 'End-to-end tests' (commit 0370640): new bullet 'Screenshots: always await screenshot(electronApp, window | locator, path) ... never page.screenshot()' with the why (headless Ozone 1x1 screen, frame wait hang, stale capturePage) and the fallback; headless switch bullet names --ozone-override-screen-size

## Notes
See SPEC.md and docs/ARCHITECTURE.md.

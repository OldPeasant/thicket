---
title: Release: Linux smoke test fails removing the app's user-data folder
status: in_progress
owner: dell26/agent-1
deps: []
touches: [test/e2e/smoke]
prio: 1
lease_until: 2026-11-17T18:33:59Z
---
## Goal
Release run 44136477833 (tag v0.1.0-rc.2, 2026-11-17) failed in the "Smoke test installer" step on linux-x64 and linux-arm64; win-x64 passed. Both AppImage smoke tests in `test/e2e/smoke/installer.smoke.ts` fail in teardown, not in the test body: `ENOTEMPTY: directory not empty, rmdir '/tmp/thicket-smoke-userdata-…/Cache'` from the `userDataDir` fixture's `rm(dir, { recursive: true, force: true })`. The app (likely Chromium child processes started through the AppImage runtime, which outlive the process Playwright closes) still writes into the folder while it is removed. Make teardown reliable: make sure the whole app process tree has exited before removing the folder (wait for exit, kill the process group if needed), and remove with retries (`maxRetries`/`retryDelay`) as a second line of defence. Check whether `test/e2e/harness` has the same pattern and fix it there too if so. Logs: `gh run view 44136477833 --log-failed`.

## Acceptance criteria
- [x] Reproduce locally: run the smoke suite against a locally built AppImage (`npm run dist -w apps/desktop -- --linux AppImage`, then the smoke command the release workflow uses, headless) several times (e.g. 10 runs): record failures before and none after the fix
  - verified (2026-11-17 19:10+0100 by dell26/agent-1): npm run dist -w apps/desktop -- --linux AppImage; then npx playwright test -c test/e2e/smoke/playwright.config.ts installer.smoke.ts --repeat-each 10 with APPIMAGE_EXTRACT_AND_RUN=1 THICKET_SMOKE_MONGO=1 THICKET_SMOKE_INSTALLER=<that AppImage> (headless Ozone, no xvfb here; all CPUs busy to mimic a slow runner). Before (main): 20 passed but 20/20 tests left their thicket-smoke-userdata-* folder in tmpdir, because the app recreated it after rm. Probe: on SIGTERM the AppImage runtime exits after ~1 ms while its process group lives on 0.1-4.4 s and writes 4-9 entries into userData (ENOTEMPTY when that overlaps rm, as in run 44136477833). After (78a8fd70): 20 passed, 0 ENOTEMPTY, 0 folders left; same without load before the fix: 20 passed.
- [~] A release-like run on GitHub passes the Linux smoke step: the `bundle` job in check.yml or the smoke step on this task's `wip/` branch, if one runs it; otherwise skip with reason and a human checks the next tag
  - skipped (2026-11-17 18:57+0100 by dell26/agent-1): check.yml's bundle job runs scripts/smoke-packaged.mjs on linux-unpacked, not test/e2e/smoke/installer.smoke.ts on the AppImage; release.yml runs only on v* tags, which agents don't push. A human checks the Linux 'Smoke test installer' step on the next tag.
- [ ] `npm run check` passes

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 18:57+0100 by dell26/agent-1): Local runs stand in for the release run: without xvfb-run here, the smoke suite ran with Chromium's headless Ozone (as the config allows), APPIMAGE_EXTRACT_AND_RUN=1, THICKET_SMOKE_MONGO=1, under CPU load to mimic a slow runner. ENOTEMPTY itself didn't reproduce locally; the same race showed up as the app recreating the deleted userData folder (20/20 tests leaked it before, 0/20 after).

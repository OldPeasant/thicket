# Fix Report

Date: 2026-11-17

Task: packaged-hardening - Harden the packaged app: Electron fuses (RunAsNode, NODE_OPTIONS, asar-only), ignore THICKET_DEV_SERVER/THICKET_RENDERER_DIR when packaged

Scope: current task, findings CR-1 and CR-2 of `reviews/packaged-hardening/review.md`

## Fixed findings

### CR-1 — Smoke script page selection can miss the window when it is still on about:blank at attach time

Files changed:
- `apps/desktop/scripts/smoke-packaged.mjs`

Problem:
The script picked the page whose URL already started with `thicket://`, otherwise waited for a new `page` event. A window target still on its initial blank document at attach time was never selected (timeout), and a page delivered before navigation could pass `waitForLoadState('load')` on the blank document, so the pings ran before or during navigation.

Fix:
Take the first page (`context.pages()[0]`, else `waitForEvent('page')`), then `page.waitForURL((url) => url.protocol !== 'about:', { timeout: TIMEOUT })` before `waitForLoadState('load')` and the pings. The generic "left about:" wait (the reviewer's second option) is used instead of a `thicket://app/` regex so that an env-override regression is still reported by the existing URL assertion (wrong URL in the result JSON) rather than as a bare timeout. The existing `result.url.startsWith('thicket://app/')` check is unchanged.

Validation:
- `cd apps/desktop && node scripts/smoke-packaged.mjs release/linux-unpacked/thicket` — Pass (`smoke: OK`, url `thicket://app/#/`, fuses as expected, runAsNode/inspect ignored, both pings answered)
- `cd apps/desktop && node release/unfused-control.mjs` — fails as expected (negative control: RunAsNode RAN, inspect LISTENING, wrong fuses, `smoke: FAILED`), so the probes still detect the failure case

### CR-2 — Residual remote-debugging surface of the packaged app is not documented

Files changed:
- `apps/desktop/electron-builder.yml`
- `docs/ARCHITECTURE.md`

Problem:
The hardening docs could be read as "the packaged binary can no longer be scripted", while Chromium's `--remote-debugging-port` (not controlled by any fuse) still lets anyone who can launch the binary with arguments attach over CDP and drive the renderer.

Fix:
Documentation only, no behaviour change. The `electronFuses` comment in `electron-builder.yml` and the Packaging paragraph in `docs/ARCHITECTURE.md` now state that `--remote-debugging-port` is not controlled by any fuse, stays accepted by packaged builds (the smoke test uses it), allows driving the renderer (including `thicket.request` against saved connections), is an accepted residual risk, and that refusing it in packaged builds is a possible follow-up outside this task. Recording the matching assumption (`tasks.py assume`) and any follow-up task is left to the parent worker.

Validation:
- `npx prettier --check apps/desktop/scripts/smoke-packaged.mjs apps/desktop/electron-builder.yml docs/ARCHITECTURE.md` — Pass

## Not fixed

None.

## Validation summary

Focused tests:
- `npx prettier --check` on the three changed files — Pass
- `node scripts/smoke-packaged.mjs release/linux-unpacked/thicket` (in `apps/desktop`, existing current build; the script is not part of the asar) — Pass, `smoke: OK`
- `node release/unfused-control.mjs` (in `apps/desktop`) — `smoke: FAILED`, exit 1, as expected for the negative control

Full test suite:
- `npm run check` (repo root: lint, type check, unit tests) — Pass (renderer: 100 files, 3273 tests passed)

Lint/type-check/build:
- Included in `npm run check` — Pass

`.taskcheck`:
- Runs `npm run check`, which passed (above); not invoked separately.

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.

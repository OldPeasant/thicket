# Fix Report

Date: 2026-11-17

Task: smoke-userdata-cleanup

Scope: current task (finding CR-1 in `reviews/smoke-userdata-cleanup/review.md`, the same issue as TW-1 in `reviews/smoke-userdata-cleanup/tests.md`)

## Fixed findings

### CR-1 / TW-1 — `endProcessTree` never signals a non-detached POSIX child

Files changed:
- `test/e2e/harness/processes.ts`
- `test/e2e/smoke/processes.smoke.ts` (comment only; the test and its assertion are unchanged)

Problem:
On POSIX, a child that was not spawned with `detached: true` leads no process group, so
`processGroupAlive(pid)` is false. Neither SIGTERM nor SIGKILL was sent, and `endProcessTree` returned
after the 5 s `waitForExit` timeout with the child still running. The "signal the child alone"
fallback in `signalGroup` could not be reached in that case.

Fix:
On POSIX, when the child leads no live process group, `endProcessTree` now handles the child alone.
It returns at once if the child has already exited. Otherwise it sends SIGTERM if `terminate` is set,
waits up to `graceMs` for the child to exit, then sends SIGKILL and waits up to 5 s more. The detached
path is unchanged: SIGTERM to the group, a wait for the whole group, SIGKILL after `graceMs`, and a
wait for the child's exit. The JSDoc now describes the non-detached case, and states that the child's
descendants are not waited for in that case. The comment in `signalGroup`'s catch now says that branch
handles a group that emptied after the check. The test comment now says "signals the child alone"
instead of "falls back to".

Validation:
- `npx playwright test -c test/e2e/smoke/playwright.config.ts processes.smoke.ts installed-app.smoke.ts --output=test-results/fixer-smoke` — Pass (44 passed, including "ends a running child that was not detached", which took 2 ms)

## Not fixed

None.

## Validation summary

Focused tests:
- `npx playwright test -c test/e2e/smoke/playwright.config.ts processes.smoke.ts installed-app.smoke.ts --output=test-results/fixer-smoke` — Pass, 44 passed

Full test suite:
- `npm run check` (lint, type check, unit tests) — Pass (renderer: 125 files, 4137 tests passed). `installer.smoke.ts` and `npm run test:e2e` were not run: the installer smoke test needs a locally built AppImage, and the e2e suite was outside the requested validation.

Lint/type-check/build:
- `npm run lint` — Pass
- `npx tsc -p tsconfig.json` — Pass

`.taskcheck`:
- Pass. `.taskcheck` runs `npm run check`, which was run directly and exited 0.

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.

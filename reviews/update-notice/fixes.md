# Fix Report

Date: 2026-11-17

Task: update-notice - Release (Should): Update available notice

Scope: current task; findings CR-1 and CR-2 from `reviews/update-notice/review.md` (round 1)

## Fixed findings

### CR-1 — `denyWindowOpen` is no longer used in production, but its doc, test and ARCHITECTURE still present it as the window-open guard

Files changed:
- `apps/desktop/src/main/security.ts`
- `apps/desktop/src/main/security.spec.ts`
- `apps/desktop/src/main/index.ts`
- `apps/desktop/src/update/handlers.ts`
- `apps/desktop/src/update/checker.spec.ts`
- `docs/ARCHITECTURE.md`

Problem:
`index.ts` installed `openReleaseLink` (from `src/update/handlers.ts`) as the window-open handler.
`denyWindowOpen` in `security.ts` was used only by its own tests, and its doc said "no new windows, ever".
ARCHITECTURE still named `security.ts` as the home of the `window.open` guard.

Fix:
Replaced `denyWindowOpen` with `windowOpenHandler(url, openExternal, log)` in `security.ts`. It has the same behavior that `openReleaseLink` had: it opens only `isReleaseUrl` pages externally and always returns `{ action: 'deny' }`. Its doc comment states the release-link exception. Now there is a single window-open guard, and it lives next to the other guards.
- Removed `openReleaseLink` from `src/update/handlers.ts`. `index.ts` now calls `windowOpenHandler`.
- In `security.spec.ts`, replaced the two always-deny tests. The new test denies app, foreign and asset-download URLs and checks that nothing is opened.
- Moved the three `openReleaseLink` tests from `checker.spec.ts` to `security.spec.ts` unchanged, except for the function name. That includes the `(test-writer)` test.
- In ARCHITECTURE, the guard bullet near line 101 now describes the release-link exception. The "Update notice" bullet now names `windowOpenHandler` in `src/main/security.ts`.

Validation:
- `cd apps/desktop && npx vitest run src/update src/main` — Pass (6 files, 117 tests)
- `grep -rn "denyWindowOpen\|openReleaseLink" apps packages docs` — no remaining references

### CR-2 — The release-link allowlist also accepts asset download URLs, not only release pages

Files changed:
- `apps/desktop/src/update/checker.ts`
- `apps/desktop/src/update/checker.spec.ts`
- `docs/ARCHITECTURE.md`

Problem:
`RELEASE_PAGE_PREFIX` was `https://github.com/OldPeasant/thicket/releases/`. As a result, `isReleaseUrl` and the window-open handler also accepted `.../releases/download/<tag>/<asset>` URLs.

Fix:
Narrowed `RELEASE_PAGE_PREFIX` to `https://github.com/OldPeasant/thicket/releases/tag/` and updated its doc and the `isReleaseUrl` doc. Added these URLs to the rejected list in `checker.spec.ts` ("release links"):
- `.../releases/latest`;
- `.../releases/download/v1.0.0/...AppImage`;
- `.../releases/tag/../download/...`, which normalises to a download URL.

The "Update notice" bullet in ARCHITECTURE now names the `releases/tag/` prefix and says that asset URLs are rejected. Recorded fixtures and renderer specs already use tag-page `html_url`s, so nothing else changed.

Validation:
- `cd apps/desktop && npx vitest run src/update src/main` — Pass (117 tests)

## Not fixed

None.

## Validation summary

Focused tests:
- `cd apps/desktop && npx vitest run src/update src/main` — Pass (6 files, 117 tests)

Full test suite:
- `npm run check` (lint, type check, unit tests) — Pass (desktop/backend 92 files / 4811 tests; renderer 111 files / 3734 tests)

Lint/type-check/build:
- `npx eslint` on the 6 changed source files — Pass
- `npx prettier --check` on the changed source files and `docs/ARCHITECTURE.md` — Pass
- `npx tsc --noEmit -p apps/desktop` — Pass

`.taskcheck`:
- Pass (`.taskcheck` runs `npm run check`; run directly as above)

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.

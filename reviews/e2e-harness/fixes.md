# Fix Report

Date: 2026-11-16

Task: e2e-harness - M0: Playwright end-to-end harness for the Electron app

Scope: current task; findings CR-2 and CR-3 from `reviews/e2e-harness/review.md` (CR-1 is evidence-only, as the parent worker directed)

## Fixed findings

### CR-2 — Root e2e harness imports `playwright-core`, which only `apps/desktop` declares

Files changed:
- `test/e2e/harness/app.ts`
- `test/e2e/harness/fixtures.ts`

Problem:
The root harness imported `_electron`, `ElectronApplication` and `Page` from `playwright-core`. The root `package.json` does not declare that package, so the import only resolved because npm hoists it.

Fix:
Both files now import these symbols from `@playwright/test`, which the root declares. It re-exports them: `@playwright/test` -> `playwright/test` -> `export * from 'playwright-core'`. At runtime `_electron` is an object. A recursive grep shows no other file under `test/e2e` imports `playwright-core`. The `apps/desktop/test` files still import it, but `apps/desktop/package.json` declares it, so they were left unchanged.

Validation:
- `npx tsc -p tsconfig.json` — Pass
- `npx eslint --max-warnings 0 test/e2e apps/desktop/test/helpers.ts` — Pass
- `npm run test:e2e` — Pass (17 passed)

### CR-3 — `headlessArgs`/`launchApp` duplicate `apps/desktop/test/helpers.ts`

Files changed:
- `test/e2e/harness/app.ts`
- `apps/desktop/test/helpers.ts`

Problem:
The Electron binary lookup, the `headlessArgs()` rule and the launch env are copied between the two Electron test suites. A change to one copy could easily miss the other.

Fix:
I added a two-line "keep in sync" comment above the `electronPath` lookup in each file that points to the other copy. As instructed, I did not refactor anything.

Validation:
- `npx prettier --check test/e2e apps/desktop/test` — Pass
- `npx tsc -p tsconfig.json` — Pass

## Not fixed

### CR-1 — Screenshot-on-failure path has no test and no recorded evidence yet

Status:
Out of scope (evidence-only, no code change)

Reason:
The parent worker classified this as evidence-only. Recording criterion evidence with `tasks.py verify` belongs to the parent worker. For reference, the current e2e suite includes `test/e2e/harness-helpers.e2e.ts` "a failing test leaves a window screenshot and the app output under test-results/". It passed in the `npm run test:e2e` run below.

## Validation summary

Focused tests:
- `npx tsc -p tsconfig.json` — Pass
- `npx eslint --max-warnings 0 test/e2e apps/desktop/test/helpers.ts` — Pass
- `npx prettier --check test/e2e apps/desktop/test` — Pass

Full test suite:
- `npm run test:e2e` (builds the renderer and desktop app, then runs `playwright test`; no xvfb-run on this host and no display, so the harness used headless Ozone) — Pass, 17 passed

Lint/type-check/build:
- `npm run check` — Pass

`.taskcheck`:
- Pass (`npm run check`)

Remaining unresolved findings:
0 code findings (CR-1 is still open for the parent worker to record evidence)

## Final status

All validated findings fixed and validation passed.

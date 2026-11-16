# Code Review

Date: 2026-11-16

Task: e2e-harness - M0: Playwright end-to-end harness for the Electron app

Scope: task commits cf3eddf and f16d56d (`git diff d2cfcda..HEAD`), committed changes only

Requirements:
- tasks/e2e-harness.md acceptance criteria (3) and recorded assumptions #1-#3
- SPEC.md (e2e with Playwright's Electron support, `npm run test:e2e`)
- docs/ARCHITECTURE.md (stack, layout `test/e2e/`, test commands, Electron test conventions)
- AGENTS.md (evidence rules, secrets policy)

Git range:
- Branch: main
- HEAD: f16d56d
- Base/start: d2cfcda47be09358ba6bee618ec86aaadc71ce68
- Commits reviewed: 2

Summary: 0 P0, 0 P1, 1 P2, 2 P3

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | Screenshot-on-failure path has no test and no recorded evidence yet**
    - File: `test/e2e/harness/fixtures.ts:33` (and the failure branch at `:69`)
    - Category: Tests
    - Problem: Criterion 3 ("Screenshot on failure saved under test-results/") is implemented by `screenshotWindows` plus the `testInfo.status !== testInfo.expectedStatus` branch in the `electronApp` teardown, but nothing exercises it: every spec in `test/e2e/` passes, so the branch never runs. At review time `python tasks.py verify e2e-harness` shows all three criteria unverified.
    - Why it matters: if the branch silently breaks (for example a screenshot timeout swallowed by the `catch` that only logs), failures would produce no artifacts and nothing would show it. A `test.fail()` spec cannot cover this, because then the status matches the expected status and no screenshot is taken.
    - Suggested fix: before ticking criterion 3, run a deliberately failing spec once (e.g. a temporary spec or `--grep` on a one-off failing assertion under `xvfb-run -a npm run test:e2e`). Confirm that `test-results/<test>/failure-window-0.png` exists and that `git status` does not list it. Record that command and result with `tasks.py verify`. Optionally add a small self-check that runs a nested `playwright test` on a failing fixture spec and asserts the PNG exists.

## P3 Low

- [ ] **CR-2 | Root e2e harness imports `playwright-core`, which only `apps/desktop` declares**
    - File: `test/e2e/harness/app.ts:7`, `test/e2e/harness/fixtures.ts:5`
    - Category: Quality
    - Problem: the root-level harness imports `_electron`, `ElectronApplication` and `Page` from `playwright-core`. The root `package.json` declares only `@playwright/test`, and `playwright-core` is a devDependency of `apps/desktop`. The import resolves only because npm hoists the package.
    - Why it matters: if the two packages' versions drift, or hoisting changes, the import could resolve to a different `playwright-core` than the one `@playwright/test` uses. That causes subtle type or runtime mismatches.
    - Suggested fix: import `_electron`, `ElectronApplication` and `Page` from `@playwright/test`, which re-exports them, so the harness depends only on the package it declares.

- [ ] **CR-3 | `headlessArgs`/`launchApp` duplicate `apps/desktop/test/helpers.ts`**
    - File: `test/e2e/harness/app.ts:13-51` vs `apps/desktop/test/helpers.ts:19-43`
    - Category: Quality
    - Problem: the Electron binary lookup, the `headlessArgs()` rule (no display or `THICKET_TEST_HEADLESS=1` -> `--ozone-platform=headless`) and the launch env (`ELECTRON_ENABLE_LOGGING`) are copied almost verbatim.
    - Why it matters: a later change to the headless or launch rules in one copy (e.g. a new Electron switch) will easily miss the other, and the two Electron test suites will then behave differently in CI.
    - Suggested fix: acceptable for now. Either add a comment in each copy pointing to the other, or later move the shared launch logic into one module that both suites import.

## Notes (not findings)

- I verified these myself: `npx tsc -p tsconfig.json` passed; `npx eslint --max-warnings 0 test/e2e playwright.config.ts` passed; `npx prettier --check` on the changed files passed; `npx playwright test --list` listed 5 tests in 2 files. The Vitest projects do not match `*.e2e.ts`.
- I did not run `npm run test:e2e` (build plus Electron under xvfb) in this review, so criteria 1 and 2 still need recorded evidence from the actual `xvfb-run -a npm run test:e2e` run.
- I checked the userData isolation design against `apps/desktop/src/main/index.ts:53-54`. `THICKET_USER_DATA` is applied via `app.setPath` at module load, before `ready`. The smoke spec cross-checks `realUserDataDir()` against Electron's own `appData` + `getName()`. The snapshot comparison runs after `app.close()` for every test that uses `electronApp`.
- `.gitignore` and `.prettierignore` cover `test-results/` and `playwright-report/`, and `playwright.config.ts` sets `outputDir: 'test-results'`.

## Review conclusion

No material issues found. Recording the criterion evidence (CR-1) is required before `done`. CR-2 and CR-3 are optional cleanups.

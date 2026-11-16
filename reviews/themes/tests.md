# Test Report

Date: 2026-11-16

Task: themes - M0: Business and Tron styles, each light and dark

Scope: base 5f94685d0a60701a9dc0705b26f94243a3a317b1 .. HEAD bbe40893b0b1252222b095252587c10a767ef507, task-owned commits 644bd62 (token sets, ThemeService, switcher) and bbe4089 (Electron test), limited to `packages/renderer`, `apps/desktop/test` and `.gitignore`. The range also contains `packages/core/src/diff/*` from the diff-ops task (excluded, not this task). Uncommitted input: only this report's test additions in `packages/renderer/src/app/theme/theme.service.spec.ts`.

Requirements:
- tasks/themes.md acceptance criteria and recorded assumptions
- SPEC.md "Two visual styles" (M0)
- docs/ARCHITECTURE.md "Coverage"
- Parent instructions (commands, known unrelated Electron failures)

## Test files changed

- `packages/renderer/src/app/theme/theme.service.spec.ts`

## Tests added or updated

Count: 10 added (none modified or removed)

- ThemeService: `applies a broadcast that changes only the mode, keeping the style`
- ThemeService: `switching to system mode picks up the current OS preference at once`
- ThemeService / overlapping requests: `a late app.settings.get answer does not undo a choice made meanwhile` (FAILS, TW-1)
- ThemeService / overlapping requests: `answers in reverse order: the last choice wins (shown == stored)` (FAILS, TW-2)
- ThemeService / overlapping requests: `a failed earlier save does not revert a later save that succeeded` (FAILS, TW-3)
- provideTheme: `themes the root at startup without waiting for the settings`
- provideTheme: `is part of the root app config`
- ThemeSwitcher: `logs a failed mode save and shows the stored mode again`
- ThemeSwitcher: `offers exactly the contract styles and modes`
- ThemeSwitcher: `reflects a change made elsewhere (app.settings.changed)`

The response order is controlled with deferred promises returned from `FakeThicketBridge` handlers, with no real delays.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 Four combinations render the explorer demo; screenshots | theme.electron.spec.ts `renders the explorer demo in all four combinations, switched without reload` (existing) | `npm run test:electron --prefix <repo>` | Pass. 4 PNGs written to `apps/desktop/test-results/screenshots/explorer-{business,tron}-{light,dark}.png` (20:23:46), all four hashes distinct, inspected visually. Copying them into `reviews/` is the parent's job. |
| AC2 Business light/dark WCAG AA contrast (unit test computing ratios) | theme-tokens.spec.ts `business/light: every pair >= 4.5`, `business/dark: every pair >= 4.5`, focus ring >= 3:1, ratio sanity (existing) | `npx ng test --include='src/app/theme/*.spec.ts'` | Pass |
| AC3 Tron keeps Canopy look, fonts local, glow/scanlines only in Tron | theme-tokens.spec.ts "Tron keeps the Canopy look; Business has no effects" (3 tests); styles.spec.ts Tron fonts; Electron test checks loaded Orbitron/Share Tech Mono fonts and the overlay (existing) | same plus `npm run check` and `npm run test:electron` | Pass |
| AC4 Switching applies without reload; `system` follows prefers-color-scheme (test) | theme.service.spec.ts `system: follows prefers-color-scheme changes without reload`, `switching style and mode applies immediately...`, `a fixed mode ignores OS changes`, new `switching to system mode picks up the current OS preference at once`; Electron `system mode follows prefers-color-scheme changes live` and the no-reload marker | `npx ng test --include='src/app/theme/*.spec.ts'`; `npm run test:electron` | Pass |
| AC4 (consistency of applied vs persisted choice under overlapping requests) | 3 new "overlapping requests" tests | `npx ng test --include='src/app/theme/*.spec.ts'` | Fail: TW-1, TW-2, TW-3 |
| AC5 Tokens for production accent, read-only marker and each BSON type in all four sets (test enumerates) | theme-tokens.spec.ts `<style>/<theme>: production accent, read-only marker and every BSON type` x4, `defines the same token names in all four sets`, `gives each BSON type of a set a token (20 types)` (existing) | `npx ng test --include='src/app/theme/*.spec.ts'` | Pass |
| Goal: persisted via app settings | ThemeService persistence/revert/broadcast tests (existing and new); Electron `persists the choice in settings.json and applies it after a restart` | both commands above | Pass, except the overlap cases TW-1..3 |
| Startup theming (provideTheme in app.config) | new provideTheme tests | `npx ng test --include='src/app/theme/*.spec.ts'` | Pass |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/app/theme/*.spec.ts'`

Result:

Fail: 2 files, 43 tests, 40 passed, 3 failed (TW-1, TW-2, TW-3). All other new and existing theme tests pass.

## Full test execution

Command:

`npm run check` (repo root: eslint + prettier --check, typecheck, `vitest run`, `npm run test -w packages/renderer`)

Result:

Fail, only because of TW-1..3. Lint, Prettier (after formatting the new spec) and typecheck pass. Root vitest: 33 files, 2099 tests passed. Renderer: 29 files, 484 tests, 481 passed, 3 failed (the same three).

Command:

`npm run test:electron --prefix /home/eric/work/mongo-db-client-agents/agent-1`

Result:

Electron: 5 files, 26 tests, 22 passed, 4 failed. `theme.electron.spec.ts` passed. The 4 failures are in `app.electron.spec.ts` (thicket://app with CSP, window.open/navigation, will-frame-navigate) and `dev.electron.spec.ts` (dev server URL). Per the parent and the task's recorded assumption, these fail on main without this task too (they expect a URL without `#/`). Not in scope.

## .taskcheck

Result:

Not run separately. `.taskcheck` runs `npm run check`, which is reported above: Fail, because of TW-1..3 only.

## Bugs found

### A late app.settings.get answer overwrites a choice made meanwhile

Finding ID:

`TW-1`

Test:

`ThemeService > overlapping requests (order controlled with deferred answers) > a late app.settings.get answer does not undo a choice made meanwhile`

Production source:

`packages/renderer/src/app/theme/theme.service.ts:66-68` (`init()` applies the `app.settings.get` result unconditionally)

Requirement:

AC4 / Goal: switching applies without reload and is persisted via app settings. The shown style/mode should match the stored setting.

Expected behavior:

The user picks Tron while the startup `app.settings.get` is still pending, and the save succeeds (stored = tron). When the older get answer (read before the save, style business) arrives, the window keeps Tron.

Actual behavior:

The late get answer is applied, and the window switches back to Business (`data-style="business"`, `theme.style() === 'business'`) while settings.json holds Tron. Severity is low in practice because the startup get normally answers quickly.

Severity:

Low

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.`

### An older app.settings.set answer arriving last overrides the newer choice

Finding ID:

`TW-2`

Test:

`ThemeService > overlapping requests (order controlled with deferred answers) > answers in reverse order: the last choice wins (shown == stored)`

Production source:

`packages/renderer/src/app/theme/theme.service.ts:84-90` (`change()` applies every `app.settings.set` result via `take(settings)`, regardless of newer pending changes)

Requirement:

AC4 / Goal: the applied style/mode should equal the persisted setting after quick successive switches.

Expected behavior:

`setStyle('tron')` then `setStyle('business')`. The second answer (business) arrives first and the first answer (tron) arrives last. The stored setting is business, so the window shows business.

Actual behavior:

The window shows Tron (`data-style="tron"`) while the stored style is business.

Severity:

Low (needs out-of-order answers from main)

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.`

### A failed save reverts a later, successful change of the other setting

Finding ID:

`TW-3`

Test:

`ThemeService > overlapping requests (order controlled with deferred answers) > a failed earlier save does not revert a later save that succeeded`

Production source:

`packages/renderer/src/app/theme/theme.service.ts:85,92` (`before` captures both style and mode at call time, and the catch path restores both)

Requirement:

AC4 / Goal: persisted via app settings, and the service's own contract that "the UI does not pretend it was saved". It also must not show something other than what is saved.

Expected behavior:

`setStyle('tron')` (fails later) overlaps `setMode('dark')` (succeeds; stored mode dark). After the failure, style returns to business, and mode stays dark (`data-theme="dark"`).

Actual behavior:

The failure restores the snapshot `{style: business, mode: system}`. Mode shows `system` (`data-theme="light"`) although settings.json has `mode: "dark"`. The switcher can trigger this, because changing style and mode quickly sends overlapping saves (the Electron `pick()` helper does exactly that).

Severity:

Medium

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.`

## Coverage

Status: partial-failed for the full run. The full coverage command exits non-zero because of TW-1..3 and writes no report. Diagnostic coverage comes from a run that excludes only the three failing tests through the CLI name filter (no test file modified). It is labelled diagnostic below and must be re-measured with the full suite after the fix.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured. The three in-scope TS files are new files, so whole-file coverage equals changed-line coverage for them.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: themes; base 5f94685d0a60701a9dc0705b26f94243a3a317b1; HEAD bbe40893b0b1252222b095252587c10a767ef507; task commits 644bd62, bbe4089 (parent-supplied scope, matched against `git log 5f94685..HEAD -- packages/renderer apps/desktop/test .gitignore`).
- Source/test snapshot identifier (including uncommitted inputs): sha256 theme.service.ts aa8bdd60…3d5e, theme-switcher.ts 78471cbd…c6608, index.ts afbbbbc8…0391, tokens.css 9f8765cb…2674, theme.service.spec.ts (uncommitted, with additions) 625e5300…ef89, theme-tokens.spec.ts 4f9a2cce…fe5e. Production hashes are identical before and after all runs.
- Exact included files: `packages/renderer/src/app/theme/theme.service.ts`, `theme-switcher.ts`, `index.ts`. Excluded: `tokens.css` and `styles.css` (CSS, not instrumentable by V8 coverage; covered by the token/contrast unit tests and the Electron test). `app.config.ts`, `dev/explorer-demo.ts` and `api/api.service.ts` have one-line wiring/type changes only, exercised by app.spec.ts, the new provideTheme tests and the Electron test, but not in the measured include set. `apps/desktop/test/theme.electron.spec.ts` is a test file. `.gitignore` is config. `packages/core/src/diff/*` belongs to another task (diff-ops).
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with @vitest/coverage-v8 5.1.0, via the Angular unit-test builder. Working directory `packages/renderer`. Full run: `npx ng test --coverage --coverage-include='src/app/theme/theme.service.ts' --coverage-include='src/app/theme/theme-switcher.ts' --coverage-include='src/app/theme/index.ts'`. Diagnostic run: the same command plus `--filter='^(?!.*overlapping requests).*$'` (skips the 3 TW tests and one unrelated api.service.spec.ts test whose name also contains "overlapping requests").
- Run start/completion time and exit status: full run 2026-11-16T20:22:11+01:00 to 20:22:16, non-zero (3 failed), no report written. Diagnostic run on the final snapshot 20:24:05 to 20:24:10, 480 passed and 4 skipped, exit 0. Baseline before the new tests (20:20): 100/101 statements, 33/33 branches, 21/22 functions, 76/76 lines.
- Generated report paths and report hashes/run identifier: `packages/renderer/coverage/renderer/coverage-summary.json` sha256 5361b11d147aa1a03ee68b94fb12d38a31eb7c541e44312b2011a4597d4e16b9, `packages/renderer/coverage/renderer/lcov.info` sha256 6f414090debdc7fd5cade6307ba866b5fa69b01bcde231b29d5b2f9c0ab4a9b9. The top-level `packages/renderer/coverage/coverage-summary.json` (18:21) is stale and was ignored.
- Evidence outputs are fresh and inputs stayed unchanged: yes. The `coverage/renderer` directory was absent after the failed run and was regenerated at 20:24:10, and the input hashes were unchanged across the run.
- Final run after latest test additions and production fixes: yes for the test additions. No production fixes exist yet, so coverage must be re-run after TW-1..3 are fixed.

Values below use covered/total (percentage); diagnostic run, final test snapshot.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/theme/theme.service.ts` | 61/61 (100%) | 23/23 (100%) | 13/13 (100%) | 52/52 (100%) |
| `packages/renderer/src/app/theme/theme-switcher.ts` | 38/38 (100%) | 10/10 (100%) | 7/7 (100%) | 22/22 (100%) |
| `packages/renderer/src/app/theme/index.ts` | 2/2 (100%) | N/A (0/0) | 2/2 (100%) | 2/2 (100%) |
| Aggregate (3 measured files; CSS and one-line wiring files excluded as listed above) | 101/101 (100%) | 33/33 (100%) | 22/22 (100%) | 76/76 (100%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `theme-switcher.ts:77` (pickMode error handler, uncovered at baseline) | A failed mode save is logged and the select shows the stored mode again | Added `logs a failed mode save and shows the stored mode again`; now covered |
| none remaining | 100% line/branch coverage does not cover ordering | TW-1..3 show defects that coverage alone did not reveal |

## Unable to test

- Attaching the screenshots in `reviews/` (AC1): the Electron test writes them to `apps/desktop/test-results/screenshots/` (git-ignored). Copying them to `reviews/themes/` is a parent action, not a test.
- The same switcher revert with a failure answered within the same microtask burst, before change detection runs, can leave the select showing the unsaved value. Real IPC answers arrive as a separate task after rendering, so I tested the realistic order (render, then failure), and that passes. Not reported as a bug.
- Real OS-level `prefers-color-scheme` changes: covered by Playwright `emulateMedia` in Electron, not by an actual OS theme switch.

## Summary

Tests added; production defects were discovered and must be passed to the `fixer` before task completion. All five acceptance criteria have passing tests. TW-1 (Low), TW-2 (Low) and TW-3 (Medium) are ordering defects in `ThemeService` where the shown theme can differ from the persisted settings. Their failing tests make `npm run check` (and so `.taskcheck`) fail until `theme.service.ts` is fixed. Task-scoped coverage is 100% in a diagnostic run without those three tests and must be re-run with the full suite after the fix.

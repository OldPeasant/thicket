# Test Report

Date: 2026-11-16

Task: themes - M0: Business and Tron styles, each light and dark (round 4: re-check of the CR-4 rewrite of `ThemeService` in 60a9323)

Scope: `git diff 1dfcf47d005346393de36220875ea064bbccab2b..60a9323 -- packages apps`, supplied by the parent (task commits: `git log 1dfcf47..HEAD`, 8 commits df350c6..60a9323, all prefixed `themes:` or the theme Electron test). Branch main, HEAD 60a9323. The changes since round 3 are 9563ba9 (two regression tests, review report) and 60a9323 (`theme.service.ts` rewritten to one display rule per key). Production files of the task: `packages/renderer/src/app/theme/{theme.service.ts,theme-switcher.ts,index.ts,tokens.css}`, `packages/renderer/src/styles.css`, `app.config.ts`, `api/api.service.ts`, `dev/explorer-demo.ts`. Uncommitted inputs: this round's additions to `packages/renderer/src/app/theme/theme.service.spec.ts`. `reviews/themes/review.md` also shows as modified in the working tree; I did not change it.

Requirements:
- tasks/themes.md acceptance criteria and recorded assumptions
- SPEC.md "Two visual styles" (M0)
- docs/ARCHITECTURE.md "Coverage"
- reviews/themes/review.md (CR-4), reviews/themes/fixes.md, the earlier tests.md (TW-1..TW-4)
- The parent's statement of the new rule: per key, show the latest local choice while its save is pending or after it succeeded, unless main recorded a newer stored value since (`confirmedBy` > choice.request); otherwise show `confirmed`. Broadcasts update `confirmed` without changing `confirmedBy`.
- apps/desktop/src/settings/store.ts and apps/desktop/src/main/index.ts (main serializes writes, broadcasts the full settings after a saved change, then answers; `get` is synchronous)

## Test files changed

- `packages/renderer/src/app/theme/theme.service.spec.ts`

## Tests added or updated

Count: 11 added this round, none modified or removed. The file now has 46 tests; with theme-tokens.spec.ts the theme specs total 64.

All are in `ThemeService > overlapping requests (order controlled with deferred answers) > one rule per key: latest choice unless failed or superseded by main`:
- `a broadcast from another window after this window saved replaces the saved choice` (normal: a succeeded choice no longer wins once main reports a newer value)
- `a broadcast while a save is pending changes only the key without a pending choice` (broadcast during a pending save, per-key independence)
- `echo of an older save does not flash its stale value over a newer pending choice` (records the shown state after each broadcast and each answer of three queued saves; all six states are `business/dark`)
- `a late app.settings.get answer while a save is pending keeps the pending choice, then the save wins`
- `a late app.settings.get answer while a save is pending, then the save fails: shows the stored value`
- `both keys interleaved: a saved style and a failed mode end on the saved style and the stored mode` (newer request fails first, older succeeds later)
- `both keys interleaved: an older style answer carrying the old mode does not hide a newer pending mode`
- `a new choice after a failed one shows again and is kept when it saves`
- `choosing the value that is already stored keeps it, whether the save succeeds or fails` (edge)
- `a value outside the contract is never shown, while the save is pending or after main refuses it` (edge; covers the `show()` guards at theme.service.ts:166-167)
- `a failed save while main is unreachable at startup falls back to the defaults` (edge)

All 53 tests that existed before this round are kept unchanged, including the regression tests for TW-1..TW-4, CR-2, CR-3 and the two late-answer tests from 9563ba9. Order is controlled with deferred promises and an explicit queue; no real delays.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 Four combinations render the explorer demo; screenshots in reviews/ | theme.electron.spec.ts (unchanged since round 2) | not re-run this round | Not run: this round changed only `theme.service.ts` internals (public API unchanged); the Electron run in round 2 passed (see git history of this file). The parent should re-run `npm run test:electron` if it needs fresh AC1 evidence on 60a9323. |
| AC2 Business light/dark WCAG AA contrast (unit test computing ratios) | theme-tokens.spec.ts contrast tests | `cd packages/renderer && npx ng test --include='src/app/theme/*.spec.ts'` | Pass |
| AC3 Tron keeps Canopy look, fonts local, glow/scanlines only in Tron | theme-tokens.spec.ts Tron/Business effect tests, styles.spec.ts | same, and `npm run check` | Pass (unit level; Electron font/overlay checks not re-run this round) |
| AC4 Switching applies without reload; `system` follows prefers-color-scheme (test) | theme.service.spec.ts system/OS and switching tests | same | Pass |
| AC4/Goal: shown choice == stored choice under overlapping requests (new rule, CR-4) | all 18 earlier ordering tests plus the 11 new ones listed above | same | Pass |
| AC5 Tokens for production accent, read-only marker and each BSON type in all four sets | theme-tokens.spec.ts enumeration tests | same | Pass |
| Goal: persisted via app settings | ThemeService persistence/revert/broadcast tests | same | Pass |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/app/theme/*.spec.ts'`

Result:

Pass: 2 files, 64 tests passed (20:44:41).

## Full test execution

Command:

`npm run check` (repo root: ESLint, Prettier, typecheck, root `vitest run`, `npm run test -w packages/renderer`)

Result:

Pass (20:44:44-20:45:03). Lint, Prettier and typecheck clean. Root vitest: 34 files, 2166 tests passed. Renderer: 29 files, 505 tests passed.

`npm run test:electron`: Not run this round (see AC1 row).

## .taskcheck

Result:

Pass. `.taskcheck` runs `npm run check` when `package.json` exists; that command passed above. Not invoked separately.

## Bugs found

None this round.

Status of earlier findings:
- TW-1, TW-2, TW-3 (overlapping saves/late get answer): fixed in round 1; their regression tests still pass on 60a9323.
- TW-4 (failed save before the startup get answer hid the stored setting): fixed in round 2 (CR-3); its test `a save that fails before the late app.settings.get answer ends on the stored value` still passes on 60a9323.

## Observations (not defects, no failing test)

- The round-2 observation about a brief flicker during quick successive choices (an older save's echo briefly showing an older value) no longer applies: with the new rule, broadcasts only update `confirmed`, and a pending newer choice keeps showing. The test `echo of an older save does not flash its stale value over a newer pending choice` now pins this.
- The rule relies on main's ordering (writes serialized, broadcast before answer, the startup `get` sent before any `set`). Two theoretical sequences would end on a value other than the stored one, but main cannot produce them, so no test asserts them: (a) a `set` answer for request N arriving after the answer of a later request M that carries the old value of the other key; (b) a `set` sent before `init()`'s `get` while `SettingsStore.get()` still returns the pre-write value. `provideTheme()` calls `init()` from an app initializer, before the switcher can be used, so (b) does not happen in the app. If a future change sends requests in a different order (for example, `app.theme` from main), these assumptions need re-checking.
- If a successful `set` answer ever lacked a valid value for the saved key, `confirmedBy` would not advance and the choice would keep overriding later broadcasts for that key. Main parses settings with `settingsSchema` before answering, so the answer always holds valid values; not reachable today.

## Coverage

Status: verified.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured separately. The three measured TS files were added by this task (new in 1dfcf47..HEAD), so whole-file coverage equals changed-line coverage for them.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: themes; base 1dfcf47d005346393de36220875ea064bbccab2b; measured HEAD 60a9323 (clean apart from the spec additions); scope from the parent, checked against `git diff --stat 1dfcf47..HEAD` (only theme-related files and reviews).
- Source/test snapshot identifier (including uncommitted inputs): sha256 theme.service.ts cd9041942555b074cd9d4480e502c0b17e9796279207ae731745a1985d1b7089, theme-switcher.ts 78471cbd6de11c2b31e9261af6ad819022375643cff1b1a57100885730c5e6bb, index.ts afbbbbc83aa7b4a60d79ff8f37d016136a9ee8c29d159571e81b04ad7ec60391, tokens.css 9f8765cb5333b69f2d0b1d60049d72dc1c518d4bd0384b1e9f7a5522092d2674, theme.service.spec.ts (uncommitted, final) 749c92bed41578e3cb4f1e6a9faaeba706b42d130f7a55f0b1b977adc87f7af7, theme-tokens.spec.ts 4f9a2ccea9a39060c6f0c7f9ed46dfc6881b2526974f4ded9e94692ba5de3d5e. Identical before `npm run check` (20:44:44) and after the coverage run (20:45:11).
- Exact included files: `packages/renderer/src/app/theme/theme.service.ts`, `theme-switcher.ts`, `index.ts`. Excluded: `tokens.css` and `styles.css` (CSS, not instrumentable by V8; covered by the token/contrast unit tests and the Electron test); `app.config.ts` (one-line `provideTheme()` registration, exercised by `provideTheme > is part of the root app config`); `api/api.service.ts` (type-only addition, nothing executable); `dev/explorer-demo.ts` (template/import wiring, exercised by the Electron test); `apps/desktop/test/theme.electron.spec.ts` (test file). No renamed or deleted files.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with @vitest/coverage-v8 via the Angular unit-test builder, in `packages/renderer`: `npx ng test --coverage --coverage-include='src/app/theme/theme.service.ts' --coverage-include='src/app/theme/theme-switcher.ts' --coverage-include='src/app/theme/index.ts' --coverage-reporters=text --coverage-reporters=json-summary --coverage-reporters=json`, all renderer specs.
- Run start/completion time and exit status: 20:45:07 to 20:45:11, 29 files, 505 tests passed, exit 0.
- Generated report paths and report hashes/run identifier: `packages/renderer/coverage/renderer/coverage-summary.json` sha256 b820dfe243898964d9c1ae3edaceca87e21fd6b3d6cceac359ae5000377fd647 and `packages/renderer/coverage/renderer/coverage-final.json` sha256 df852987dce8dd8e0b2f55bcdf12f24b3a907ad206c43d6a26049cfca35b799b, both written at 20:45:11.476.
- Evidence outputs are fresh and inputs stayed unchanged: yes. Report mtimes fall inside the run, replacing the 20:37 files, and the input hashes did not change.
- Final run after latest test additions and production fixes: yes (production revision 60a9323, final spec snapshot above). An intermediate run at 20:44:06 (before the out-of-contract test was added) showed branches 36/38 for theme.service.ts, uncovered at 166-167; the final run covers them.

Values below use covered/total (percentage).

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/theme/theme.service.ts` | 101/101 (100%) | 38/38 (100%) | 17/17 (100%) | 86/86 (100%) |
| `packages/renderer/src/app/theme/theme-switcher.ts` | 38/38 (100%) | 10/10 (100%) | 7/7 (100%) | 22/22 (100%) |
| `packages/renderer/src/app/theme/index.ts` | 2/2 (100%) | N/A (0/0) | 2/2 (100%) | 2/2 (100%) |
| Aggregate (3 measured files; the CSS and wiring/type-only files above are excluded) | 141/141 (100%) | 48/48 (100%) | 26/26 (100%) | 110/110 (100%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `theme.service.ts:166-167` (false arms of `if (valid.style)` / `if (valid.mode)` in `show()`) in the intermediate run | A value outside the contract must not reach `data-style`/`data-theme` | Test `a value outside the contract is never shown, while the save is pending or after main refuses it` added; covered in the final run |
| none in the final run | 100% coverage does not prove the ordering logic correct | Ordering tests for broadcasts during pending saves, failed saves, late get answers and interleaved keys added this round |

## Unable to test

- Real OS-level `prefers-color-scheme` changes: covered by Playwright `emulateMedia` in the Electron test, not by an actual OS switch. No follow-up needed.
- Real IPC interleaving against main is modeled in the unit tests (broadcast before answer, as `SettingsStore.onChange` is wired in `apps/desktop/src/main/index.ts`); the Electron theme test does not exercise overlapping saves. No follow-up needed unless the parent wants an Electron-level check.
- The Electron suite (AC1 screenshots, AC3 fonts/overlay) was not re-run this round; the parent should run `npm run test:electron` if fresh evidence on 60a9323 is required.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. The CR-4 rewrite of `ThemeService` passes all 53 earlier tests (including the TW-1..TW-4 and CR-2/CR-3 regressions) and 11 new tests for the per-key rule: broadcasts while a save is pending, failed saves, late `app.settings.get` answers, both keys interleaved, and out-of-contract values. The earlier echo-flicker observation is resolved and now pinned by a test. `npm run check` passes (renderer 505 tests, root 2166). Task-scoped coverage: 141/141 statements, 48/48 branches, 26/26 functions, 110/110 lines.

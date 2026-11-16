# Test Report

Date: 2026-11-16

Task: themes - M0: Business and Tron styles, each light and dark (second round, final revision after the fixes in `reviews/themes/fixes.md`)

Scope: `git diff e9d447f1c2d444ee4e3b82420101e7b5501f39d7..b7d29c1abc2e24f5d49b519121bf309cae712ec4 -- packages apps`. The parent supplied the base and the final revision. Changed in this range: `packages/renderer/src/app/theme/{theme.service.ts,theme-switcher.ts,index.ts,tokens.css}`, the theme specs, `packages/renderer/src/styles.css`, `styles.spec.ts`, `app.config.ts`, `api/api.service.ts`, `dev/explorer-demo.ts` and `apps/desktop/test/theme.electron.spec.ts`. Fix commit under re-check: b7d29c1 (`theme.service.ts` save ordering for TW-1..3 and CR-2; `theme.electron.spec.ts` waits for transitions before the screenshots, CR-1). Uncommitted input: only this round's additions to `packages/renderer/src/app/theme/theme.service.spec.ts`. `reviews/themes/review.md` also shows as modified in the working tree; I did not change it.

Requirements:
- tasks/themes.md acceptance criteria and recorded assumptions
- SPEC.md "Two visual styles" (M0)
- docs/ARCHITECTURE.md "Coverage"
- reviews/themes/fixes.md and the first-round findings TW-1..3 and CR-1/CR-2
- Parent instructions (commands; the 4 app/dev Electron failures are known on main)

## Test files changed

- `packages/renderer/src/app/theme/theme.service.spec.ts`

## Tests added or updated

Count: 5 added this round (none modified or removed). The file now has 31 tests. With theme-tokens.spec.ts, the theme specs total 49.

All five are in `ThemeService > overlapping requests (order controlled with deferred answers)`:
- `a broadcast from another window while a save is pending: the later save wins` (Pass)
- `a pending save that fails after a broadcast of the same value keeps the broadcast value` (Pass)
- `a pending save that fails after a broadcast of another value shows the broadcast value` (Pass)
- `main echoes each save as a broadcast before answering: quick choices end on the last one` (Pass). This models apps/desktop main: `SettingsStore.onChange` broadcasts the full settings, then the set answers.
- `a save that fails before the late app.settings.get answer ends on the stored value` (FAILS, TW-4)

Deferred promises and an explicit queue control the order. There are no real delays.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 Four combinations render the explorer demo; screenshots in reviews/ | theme.electron.spec.ts `renders the explorer demo in all four combinations, switched without reload` (now waits for `document.getAnimations()` to finish and uses `animations: 'disabled'`) | `npm run test:electron --prefix /home/eric/work/mongo-db-client-agents/agent-1` | Pass. 4 PNGs regenerated in `apps/desktop/test-results/screenshots/` at 20:31:40-41, with the same byte sizes as the committed `reviews/themes/screenshots/` files for business-dark (52499), tron-light (67856) and tron-dark (64839). I inspected tron-light: the controls show their final colors, so the CR-1 fix works. |
| AC2 Business light/dark WCAG AA contrast (unit test computing ratios) | theme-tokens.spec.ts contrast tests (unchanged) | `cd packages/renderer && npx ng test --include='src/app/theme/*.spec.ts'` | Pass |
| AC3 Tron keeps Canopy look, fonts local, glow/scanlines only in Tron | theme-tokens.spec.ts Tron/Business effect tests, styles.spec.ts, Electron font/overlay checks | same, plus `npm run test:electron` | Pass |
| AC4 Switching applies without reload; `system` follows prefers-color-scheme (test) | theme.service.spec.ts system/OS tests; Electron `system mode follows prefers-color-scheme changes live` and the no-reload marker | both commands above | Pass |
| AC4/Goal: shown choice == persisted choice under overlapping requests (TW-1, TW-2, TW-3, CR-2 re-check) | `a late app.settings.get answer does not undo a choice made meanwhile`, `answers in reverse order: the last choice wins`, `a failed earlier save does not revert a later save that succeeded`, `two overlapping failed saves end on the stored values` | `npx ng test --include='src/app/theme/*.spec.ts'` | Pass. The fixes for TW-1..3 and CR-2 hold. |
| AC4/Goal: broadcasts while a save is pending (new this round) | the 4 passing broadcast/echo tests listed above | same | Pass |
| AC4/Goal: failed save before the startup get answer | `a save that fails before the late app.settings.get answer ends on the stored value` | same | Fail: TW-4 |
| AC5 Tokens for production accent, read-only marker and each BSON type in all four sets | theme-tokens.spec.ts enumeration tests (unchanged) | same | Pass |
| Goal: persisted via app settings | ThemeService persistence/revert/broadcast tests; Electron `persists the choice in settings.json and applies it after a restart` | both commands | Pass, except TW-4 |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/app/theme/*.spec.ts'`

Result:

Fail: 2 files, 49 tests, 48 passed, 1 failed (TW-4). All 44 tests that existed before this round pass, including the regression tests for TW-1..3 and CR-2.

## Full test execution

Command:

`npm run check` (repo root: `eslint . --max-warnings 0 && prettier --check .`, typecheck, `vitest run`, `npm run test -w packages/renderer`)

Result:

Fail, only because of TW-4. Lint, Prettier and typecheck pass (I also ran `prettier --check` and `eslint` on the changed spec: clean). Root vitest: 34 files, 2166 tests passed. Renderer: 29 files, 490 tests, 489 passed, 1 failed (TW-4).

Command:

`npm run test:electron --prefix /home/eric/work/mongo-db-client-agents/agent-1` (run twice, same result both times)

Result:

Fail overall, but not because of this task: 5 files, 26 tests, 20 passed, 6 failed. `theme.electron.spec.ts` (4 tests) and `settings.electron.spec.ts` pass. Failures:
- 4 known failures from the parent's list: `app.electron.spec.ts` (thicket://app with CSP, window.open/navigation, will-frame-navigate) and `dev.electron.spec.ts` (dev server URL).
- 2 in `secrets.electron.spec.ts`, which the first round and fixes.md did not list: `setSecret still saves (secureStorage: false)...` gets `NOT_FOUND: No profile with id p-electron`, and `after a restart the basic_text file still decrypts` then fails with ENOENT on `secrets.bin`. This task does not touch `secrets.electron.spec.ts` or the profiles/secrets code. Its only change under apps/ is `theme.electron.spec.ts`. The last commits on those files are from the profiles-store task (dd88233, 51e51c5), where `profiles.setSecret` requires an existing profile. Not in this task's scope. The parent may want to report it to the profiles-store owner.

## .taskcheck

Result:

Not run separately. `.taskcheck` runs `npm run check`, reported above: Fail, because of TW-4 only.

## Bugs found

### A failed save made before the startup app.settings.get answer hides the stored setting

Finding ID:

`TW-4`

Test:

`ThemeService > overlapping requests (order controlled with deferred answers) > a save that fails before the late app.settings.get answer ends on the stored value`

Production source:

`packages/renderer/src/app/theme/theme.service.ts:79-83` (`init()` drops the get answer for a key whose `generation` changed) together with `:113-119` (a failed save reverts to `confirmed`, which still holds the defaults because the get has not answered yet)

Requirement:

Goal/AC4: the theme is persisted via app settings, and the service's contract (fixes.md, code comment at :111) is that a failed save "show[s] what is stored again". The shown style/mode must match the stored settings.

Expected behavior:

Stored style is `tron`. The startup `app.settings.get` is still pending. The user picks a style (here `business`) and that save fails. When the get answer (`style: tron`) arrives, the window shows Tron, which is what main stores.

Actual behavior:

The failed save bumped `generation.style`, so `takeAnswer` drops the get answer's style. The revert had set the style to `confirmed.style`, which is still the default `business`. The window ends on Business (`data-style="business"`, `theme.style() === 'business'`) while settings.json holds Tron, and only a later broadcast corrects it. The same applies to `mode`, for example stored `dark`, a failed `setMode('light')`, and the window ends on `system`. The fix for TW-1 introduced this gap: it is correct when the save succeeds, but not when the save fails. Possible fix direction, for the fixer to decide: do not treat a failed save as a "newer choice" for the get answer. For example, the get answer could be accepted for a key when no save of that key succeeded since the get was sent.

Severity:

Low. It needs a failed settings save while the startup get is still pending, which is rare in practice.

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.`

## Observations (not defects, no failing test)

- Quick successive choices can flicker. Main broadcasts the full settings before each set answers, and `take()` applies broadcasts unconditionally (by design, per fixes.md). So while a newer save is still pending, the echo of an older save briefly shows the older value. For example, after `setStyle('tron')`, `setMode('dark')`, `setStyle('business')`, the echo of the first save briefly shows mode `system`, and the echo of the second briefly shows style `tron`. Every sequence I tested ends on the last choice, which equals the stored setting (the echo test above passes). It is a transient visual glitch and no requirement covers it, so it is not reported as a bug. The parent can decide whether it is worth a follow-up.
- The CR-1 fix waits for `Animation.finished` on every running animation. There are no infinite CSS animations in the renderer today (only `jump-flash`, 1.6 s). If a future infinite animation (for example an animated Tron glow) is added, this wait would hang the Electron test.

## Coverage

Status: partial-failed for the full run. The coverage command exits non-zero because of TW-4 and writes no fresh report. The diagnostic numbers below come from a run that excludes only the TW-4 test through the CLI `--filter` (no test file was modified or skipped in code). They must be re-measured with the full suite after TW-4 is fixed.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured separately. The three measured TS files were added by this task (new in e9d447f..HEAD), so whole-file coverage equals changed-line coverage for them.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: themes; base e9d447f1c2d444ee4e3b82420101e7b5501f39d7; measured HEAD b7d29c1abc2e24f5d49b519121bf309cae712ec4; scope `git diff e9d447f..HEAD -- packages apps`, supplied by the parent and checked against `git diff --stat` (only theme-related files).
- Source/test snapshot identifier (including uncommitted inputs): sha256 theme.service.ts a8d8ef5aea7d7f568f502bac6adec51b81b865e950ec3a66b68846ce48217dd9, theme-switcher.ts 78471cbd6de11c2b31e9261af6ad819022375643cff1b1a57100885730c5e6bb, index.ts afbbbbc83aa7b4a60d79ff8f37d016136a9ee8c29d159571e81b04ad7ec60391, tokens.css 9f8765cb5333b69f2d0b1d60049d72dc1c518d4bd0384b1e9f7a5522092d2674, theme.service.spec.ts (uncommitted, with this round's additions) 3c9507f98c37182566d24a4a1e7c167ad10f058b03ed150b1c42f655e9d0d585, theme-tokens.spec.ts 4f9a2ccea9a39060c6f0c7f9ed46dfc6881b2526974f4ded9e94692ba5de3d5e. The hashes are identical before (20:29:58) and after all runs.
- Exact included files: `packages/renderer/src/app/theme/theme.service.ts`, `theme-switcher.ts` and `index.ts`. Excluded:
  - `tokens.css` and `styles.css`: CSS, not instrumentable by V8. Covered by the token/contrast unit tests and the Electron test.
  - `app.config.ts`: a one-line `provideTheme()` registration, exercised by `provideTheme > is part of the root app config`.
  - `api/api.service.ts`: a type-only addition to `BroadcastPayloads`, so there is nothing executable.
  - `dev/explorer-demo.ts`: template/import wiring only, exercised by the Electron test.
  - `apps/desktop/test/theme.electron.spec.ts`: a test file.
  - No renamed or deleted files.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with @vitest/coverage-v8 5.1.0, via the Angular unit-test builder, in working directory `packages/renderer`.
  - Full run (parent's command): `npx ng test --coverage --coverage-include='src/app/theme/theme.service.ts' --coverage-include='src/app/theme/theme-switcher.ts' --coverage-include='src/app/theme/index.ts'`, all renderer specs.
  - Diagnostic run: the same command plus `--filter='^(?!.*a save that fails before the late app.settings.get answer).*'` and `--coverage-reporters=text --coverage-reporters=json-summary --coverage-reporters=json`.
- Run start/completion time and exit status:
  - Full run started at 20:30:09 and finished at about 20:30:11. Exit non-zero (490 tests, 1 failed). No fresh report: the only top-level files in `coverage/` are dated 18:21 and are stale.
  - Diagnostic run: 20:30:22 to 20:30:27, 489 passed and 1 skipped (the TW-4 test, deselected by the filter), exit 0.
- Generated report paths and report hashes/run identifier: `packages/renderer/coverage/renderer/coverage-summary.json` sha256 9f794535f8928382ea84f1b325e42814f47a9b7fd503338357d88fd3ba23a3b6 and `packages/renderer/coverage/renderer/coverage-final.json` sha256 412669f252307a9dcceae32795379067cdae18b4323cf386d5195f57ccbb56ed, both written at 20:30:26.95. The stale top-level `packages/renderer/coverage/coverage-summary.json` (18:21) was ignored.
- Evidence outputs are fresh and inputs stayed unchanged: yes. The report files' timestamps fall inside the diagnostic run, and the input hashes did not change.
- Final run after latest test additions and production fixes: yes for the final revision b7d29c1 and this round's tests. If TW-4 is fixed, coverage must be re-run with the full suite.

Values below use covered/total (percentage); diagnostic run, final snapshot.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/theme/theme.service.ts` | 96/96 (100%) | 37/37 (100%) | 18/18 (100%) | 81/81 (100%) |
| `packages/renderer/src/app/theme/theme-switcher.ts` | 38/38 (100%) | 10/10 (100%) | 7/7 (100%) | 22/22 (100%) |
| `packages/renderer/src/app/theme/index.ts` | 2/2 (100%) | N/A (0/0) | 2/2 (100%) | 2/2 (100%) |
| Aggregate (3 measured files; the CSS files and the wiring/type-only files above are excluded) | 136/136 (100%) | 47/47 (100%) | 27/27 (100%) | 105/105 (100%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| none (all lines and branches covered) | 100% coverage does not show that the ordering logic is correct | Broadcast and echo ordering tests added this round. TW-4 is a defect that full coverage did not reveal. |

## Unable to test

- Real OS-level `prefers-color-scheme` changes: covered by Playwright `emulateMedia` in Electron, not by an actual OS theme switch. No follow-up needed.
- The real IPC interleaving of broadcasts and answers is modeled in the unit tests (broadcast first, then answer, as `SettingsStore.onChange` is wired in `apps/desktop/src/main/index.ts`). The Electron theme test does not exercise overlapping saves against the real main process. No follow-up needed unless the parent wants an Electron-level check.

## Summary

Tests added; production defects were discovered and must be passed to the `fixer` before task completion. The CR-1, CR-2 and TW-1..3 fixes are confirmed: their tests pass, and the four new broadcast/echo ordering tests pass as well. One new Low-severity defect, TW-4, remains: a save that fails before the startup `app.settings.get` answer leaves the window on the default instead of the stored setting. Its failing test makes `npm run check` (and so `.taskcheck`) fail until `theme.service.ts` is fixed. Task-scoped coverage is 100% (136/136 statements, 47/47 branches, 27/27 functions, 105/105 lines) in a diagnostic run without the TW-4 test. Coverage must be re-run with the full suite after the fix. The Electron run also shows 2 `secrets.electron.spec.ts` failures outside this task (profiles-store), in addition to the 4 known ones.

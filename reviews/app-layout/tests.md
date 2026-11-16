# Test Report

Date: 2026-11-16

Task: app-layout (M0: Application layout: sidebar, tabs, status bar, welcome screen)

Scope: `git diff a810541557cde9324c050969149b5b29f2e81615..079351246a5d88c61cc9cc7691cc7bda82d296d3`,
branch `main`, task commits 2f78355, 380aa15, c8c8f16, 148cea3, 3fc727c, 0793512 (base and commit
list supplied by the parent worker, confirmed with `git log --oneline a810541..HEAD`: exactly these six
commits). Final run after fixer round 2 (commit 0793512, finding TW-1, `reviews/app-layout/fixes.md`
"Round 2 — TW-1"). The previous report described the pre-fix revision and is replaced; its test
inventory and coverage notes are carried over where still valid. Uncommitted input: one test file
(`app-shell.spec.ts`, 2 tests added in this run); no production file differs from HEAD.

Requirements:
- `tasks/app-layout.md` acceptance criteria and recorded assumptions (sidebarWidth 180..560, default
  260; welcome routes `/connections/new`, `/connections/import/compass`; Ctrl/Cmd+W always consumed;
  physical W key (`code: 'KeyW'`) counts only when the typed character is not a Latin letter, AZERTY
  Ctrl+Z stays undo; drag and drop plus Ctrl+Shift+PageUp/PageDown reorder; Ctrl+PageUp/PageDown cycle)
- `reviews/app-layout/review.md` findings CR-1..CR-4 and `reviews/app-layout/fixes.md` (round 1 and
  round 2 / TW-1)
- `docs/ARCHITECTURE.md` "Coverage", `docs/QUALITY.md`, `AGENTS.md`
- Parent worker instructions for this run

## Test files changed

Uncommitted, relative to HEAD 0793512:

- `packages/renderer/src/app/layout/app-shell.spec.ts` (+33 lines, 2 tests)

Committed earlier in the task (test-writer runs, inventory carried over): `app-shell.spec.ts`,
`sidebar-width.service.spec.ts`, `tab-bar.spec.ts`, `status-bar.spec.ts`, `status.service.spec.ts`,
`welcome.spec.ts`, `workspace.service.spec.ts` (renderer layout), `app.spec.ts`, `theme.service.spec.ts`,
desktop `store.spec.ts` / `handlers.spec.ts`, contract `index.spec.ts` / `methods.spec.ts`,
`test/e2e/layout.e2e.ts`. No existing test was changed, weakened, skipped or deleted.

## Tests added or updated

Count: 2 (added in this run, uncommitted)

The fix added `TabBar.closeActive()`. Its committed tests cover "focus on the closed tab moves to the
newly selected tab" (TW-1 test) and "focus outside the strip stays". Two paths of `closeActive` were not
covered and are added in `app-shell.spec.ts` "keyboard":

- `Ctrl+W on the focused last tab moves focus to the Start tab` (line 299): focus on the only tab,
  Ctrl+W closes it, focus moves to `#ws-start-tab` instead of `<body>` (the `active === null` branch of
  `focusSelected` reached through `closeActive`).
- `Ctrl+W on the focused Start tab with no tab open keeps focus on Start` (line 315): nothing to close
  (`workspace.close()` returns false), the shortcut is still consumed and focus stays on Start.

Carried over from the earlier runs (now committed in c8c8f16 and 3fc727c): the 7 "overlapping saves
settling out of order" tests (CR-1), 5 tab-bar "ARIA tabs pattern" tests (CR-3), 2 W-key layout tests
(CR-4), the encoded-id tab/panel test, and the TW-1 test `Ctrl+W with focus on the closed tab moves
focus to the newly selected tab` (line 280), which now passes.

## Requirement coverage

Focused command (F): `cd packages/renderer && npx ng test --include='src/app/layout/**/*.spec.ts'`.
Check command (C): `npm run check` from the repo root. E2E (E):
`npm run test:e2e -- test/e2e/layout.e2e.ts` (built Electron app, Playwright `_electron`, Linux).

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 tabs open/close/reorder | `workspace.service.spec.ts` (all), `tab-bar.spec.ts` drag/drop + close tests, `app-shell.spec.ts` "tabs" (open, close by button and middle click, reorder by drag and drop), Ctrl+Shift+PageUp/PageDown move | F, C | Pass |
| AC1 sidebar width persists in settings | `sidebar-width.service.spec.ts` (init/broadcasts/commit), `app-shell.spec.ts` "sidebar width" incl. "persists across a new window", desktop `store.spec.ts` "SettingsStore sidebarWidth", contract `index.spec.ts`; e2e "the sidebar width is dragged, saved and restored after a restart" | F, C, E | Pass |
| CR-1 save races | "overlapping saves: answers and broadcasts of earlier saves do not undo newer widths", "a save back to the stored width while another save is in flight is still sent", "a late answer to the initial load does not undo a width saved meanwhile", app-shell "quick arrow presses with saves in flight all count", the 7 "overlapping saves settling out of order" tests | F, C | Pass |
| AC2 Ctrl/Cmd+W closes a tab, always consumed | "Ctrl+W and Cmd+W close the active tab and are always consumed", "Ctrl+W on the start page with tabs open closes none of them", "closing the last tab with Ctrl+W shows the welcome screen again", "Ctrl+W on the focused Start tab with no tab open keeps focus on Start" (new); e2e "Ctrl+W does not close the window" | F, C, E | Pass |
| CR-4 W by key code, AZERTY rule | "Ctrl+W on the physical W key of a non-Latin layout closes the tab too", "a Latin letter on the W key (AZERTY Ctrl+Z) is not taken for Ctrl+W", "the physical W key with Shift or Alt is left alone, like Latin W", "a Latin W typed on another physical key still closes the tab (Dvorak)" | F, C | Pass |
| AC2 Ctrl/Cmd+Tab cycles | "Ctrl+Tab cycles forward, Ctrl+Shift+Tab backward, with wrap-around", "Ctrl+PageDown/PageUp cycle ...", "Ctrl+Tab with no tab open stays on the start page", "a plain Tab keeps moving focus" | F, C | Pass |
| AC3 welcome buttons navigate | `welcome.spec.ts` ("New connection" / "Import from Compass" navigate); e2e "welcome buttons navigate to the connection editor and the Compass import" | F, C, E | Pass |
| AC3 e2e screenshot Business light and Tron dark | e2e "screenshot: layout in business light", "screenshot: layout in tron dark" (screenshots regenerated, not visually re-inspected in this run) | E | Pass |
| CR-2 same-URL sidebar link | "the sidebar link shows its page again when its URL is already the current one", "the sidebar \"New connection\" link opens the connection editor page" | F, C | Pass |
| CR-3 tabs a11y (structure, ids, roving tabindex, arrows/Home/End/Delete) | `tab-bar.spec.ts` "ARIA tabs pattern", app-shell "tab and panel point at each other also for ids that need encoding", "the routed start page is the tab panel of the Start tab" | F, C | Pass |
| CR-3 (d) / TW-1 focus not lost when the focused active tab is closed | button / middle click / Delete: tab-bar tests; Ctrl+W: "Ctrl+W with focus on the closed tab moves focus to the newly selected tab" (TW-1), "Ctrl+W on the focused last tab moves focus to the Start tab" (new), "Ctrl+W with focus outside the tab strip leaves focus where it is" | F, C | Pass |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/app/layout/**/*.spec.ts'` (21:30:06 +0100)

Result:

Pass: 7 files, 142 tests passed (140 from HEAD + 2 added).

## Full test execution

Command:

`npm run check` (repo root; lint, Prettier, type checks, unit tests), 21:30:42-21:30:58 +0100

Result:

Pass: backend/contract/desktop 42 files / 2551 tests passed; renderer 39 files / 726 tests passed
(more renderer files than in the previous report because the task now sits on base a810541, which
contains other merged tasks). `npm run lint` separately: Pass (eslint `--max-warnings 0`, Prettier
clean, including the edited spec).

E2E: `npm run test:e2e -- test/e2e/layout.e2e.ts` (21:31:46-21:32:05 +0100) -> Pass, 6 passed (layout
and welcome screen, welcome navigation, Ctrl+W does not close the window, sidebar width restored after
restart, screenshots Business light / Tron dark).

## .taskcheck

Result:

Pass (`.taskcheck` runs `npm run check`; the run above, with the 2 uncommitted tests included).

## Bugs found

No open production defects.

### Ctrl/Cmd+W with focus on the closed tab drops focus to `document.body` (resolved)

Finding ID:

`TW-1`

Test:

`AppShell > keyboard > Ctrl+W with focus on the closed tab moves focus to the newly selected tab`
(`packages/renderer/src/app/layout/app-shell.spec.ts:280`)

Production source:

`packages/renderer/src/app/layout/app-shell.ts:149` (`onKeydown` now calls `this.tabBar().closeActive()`),
`packages/renderer/src/app/layout/tab-bar.ts:168` (`closeActive`).

Requirement:

Review finding CR-3 (d): closing the focused active tab moves focus to the newly active tab instead of
losing it with the removed element, also for the task's keyboard close shortcut (AC2 Ctrl/Cmd+W).

Expected behavior:

With tabs a, b open, b selected and focused, Ctrl+W closes b and focus moves to a (or to Start when no
tab is left).

Actual behavior:

Fixed in 0793512: confirmed in this run. The TW-1 test passes unchanged; the new last-tab test shows
focus moving to Start; focus outside the strip is left alone.

Severity:

Low (accessibility).

Fix required:

`No — resolved in 0793512 and confirmed by the passing tests above.`

## Coverage

Status: verified (fresh runs on HEAD 0793512 plus the uncommitted test file; all selected tests passed,
every scoped file present in the reports).

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured (the configured tooling has no changed-line mode).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: app-layout; base
  a810541557cde9324c050969149b5b29f2e81615; HEAD 079351246a5d88c61cc9cc7691cc7bda82d296d3; commits
  2f78355, 380aa15, c8c8f16, 148cea3, 3fc727c, 0793512 from the parent; file list from
  `git diff --name-only a810541..HEAD` (same production files as in the previous report).
- Source/test snapshot identifier (including uncommitted inputs): HEAD 0793512 plus
  `packages/renderer/src/app/layout/app-shell.spec.ts` sha256
  2f3358418832ec85531d337ff513c77db4d3cf4196102224b0307f34c53b4560 (identical before and after all
  runs, `git status` shows only this file modified); no production file modified.
- Exact included files: renderer `src/app/app.routes.ts`, `src/app/layout/{app-shell,index,navigation,
  planned-page,sidebar-width.service,status-bar,status.service,tab-bar,tab-placeholder,tab-views,
  welcome,workspace.service}.ts`; desktop `src/settings/store.ts`; contract `src/app.ts`. Excluded:
  `packages/renderer/src/app/home.ts` (deleted by the task, nothing to instrument),
  `layout/app-shell.css` and `layout/tab-bar.css` (styles, no executable code), `test/e2e/layout.e2e.ts`
  and all `*.spec.ts` (tests), `docs/`, `reviews/`. No scoped file is missing from the reports.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 +
  `@vitest/coverage-v8` 5.1.0.
  Renderer (`packages/renderer`): `npx ng test --coverage --include='src/app/**/*.spec.ts'
  --coverage-include=src/app/app.routes.ts --coverage-include=src/app/layout/<file>.ts (one per
  renderer file above) --coverage-reporters=json-summary --coverage-reporters=json
  --coverage-reporters=text` -> 35 files, 578 tests passed, nothing filtered or skipped.
  Desktop (`apps/desktop`): `npx vitest run --coverage --coverage.include='src/settings/store.ts'
  --coverage.reporter=json-summary --coverage.reporter=text src/settings` -> 72 passed.
  Contract (`packages/contract`): `npx vitest run --coverage --coverage.include='src/app.ts'
  --coverage.reporter=json-summary --coverage.reporter=text` -> all passed.
- Run start/completion time and exit status: renderer 21:31:16-21:31:26 +0100, all passed; desktop
  21:31:38, contract 21:31:39, both passed.
- Generated report paths and report hashes/run identifier:
  `packages/renderer/coverage/renderer/coverage-summary.json` sha256
  206f45241ef24495e4727391db326ad11681d4d518344be71b3c77335cc66716 (plus `coverage-final.json`, both
  written 21:31:26); `apps/desktop/coverage/coverage-summary.json` sha256
  eecc73958cb6adbbd72027e8b8bc0dfc9a1fb73dc6952df8bee98d18c166dc9f (written 21:31:38);
  `packages/contract/coverage/coverage-summary.json` sha256
  8245f4145c2340f85fd3c7147c17d184247c7d50d33d3d96142015d00a6625a2 (written 21:31:39). Desktop and
  contract hashes equal the previous run's: their sources did not change since.
- Evidence outputs are fresh and inputs stayed unchanged: report files timestamped within each run
  (Vitest cleans the coverage directory before a run); snapshot hash identical before and after.
- Final run after latest test additions and production fixes: yes (after 0793512 and after the 2 tests
  added in this run; no further changes since).

Values below use covered/total (percentage); zero-denominator metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/app.routes.ts` | 3/3 (100%) | N/A | 2/2 (100%) | 2/2 (100%) |
| `packages/renderer/src/app/layout/app-shell.ts` | 109/110 (99.09%) | 64/64 (100%) | 22/23 (95.65%) | 80/80 (100%) |
| `packages/renderer/src/app/layout/index.ts` | N/A | N/A | N/A | N/A |
| `packages/renderer/src/app/layout/navigation.ts` | 1/1 (100%) | N/A | N/A | 1/1 (100%) |
| `packages/renderer/src/app/layout/planned-page.ts` | 18/18 (100%) | 11/12 (91.67%) | 2/2 (100%) | 8/8 (100%) |
| `packages/renderer/src/app/layout/sidebar-width.service.ts` | 49/49 (100%) | 30/31 (96.77%) | 7/7 (100%) | 39/39 (100%) |
| `packages/renderer/src/app/layout/status-bar.ts` | 51/51 (100%) | 23/24 (95.83%) | 4/4 (100%) | 31/31 (100%) |
| `packages/renderer/src/app/layout/status.service.ts` | 26/26 (100%) | 9/9 (100%) | 11/11 (100%) | 18/18 (100%) |
| `packages/renderer/src/app/layout/tab-bar.ts` | 135/135 (100%) | 68/68 (100%) | 24/24 (100%) | 98/98 (100%) |
| `packages/renderer/src/app/layout/tab-placeholder.ts` | 16/16 (100%) | 11/12 (91.67%) | 1/1 (100%) | 7/7 (100%) |
| `packages/renderer/src/app/layout/tab-views.ts` | 3/3 (100%) | N/A | 2/2 (100%) | 3/3 (100%) |
| `packages/renderer/src/app/layout/welcome.ts` | 35/35 (100%) | 10/10 (100%) | 4/4 (100%) | 19/19 (100%) |
| `packages/renderer/src/app/layout/workspace.service.ts` | 55/55 (100%) | 37/38 (97.37%) | 16/16 (100%) | 38/38 (100%) |
| `apps/desktop/src/settings/store.ts` | 101/101 (100%) | 50/50 (100%) | 25/25 (100%) | 87/87 (100%) |
| `packages/contract/src/app.ts` | 8/8 (100%) | N/A | N/A | 8/8 (100%) |
| Aggregate (all 15 measured files, summed counters) | 610/611 (99.84%) | 313/318 (98.43%) | 120/121 (99.17%) | 439/439 (100%) |

Aggregate excludes only the files listed as excluded above (deleted `home.ts`, CSS, tests); none is
missing.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `app-shell.ts:106` col 47-53 (1 statement, 1 anonymous function inside `viewChild.required(TabBar)`) | Angular-compiler-generated query predicate wrapper for the new `tabBar` view query; the query itself is exercised by every Ctrl+W test | justified gap, generated glue |
| `sidebar-width.service.ts:70` (`typeof settings.sidebarWidth === 'number'` false) | save answer without `sidebarWidth`; main and contract ship together in this task | justified gap, defensive |
| `workspace.service.ts:85` (`tabs[next]?.id ?? null` fallback) | unreachable: `next` is always a valid index for a non-empty list | justified gap, defensive |
| `planned-page.ts:46` (`data['heading'] ?? ''`) | route without heading data; every planned route sets one | justified gap, defensive |
| `status-bar.ts:155` (`conn ? ... : ''` empty branch) | computed only shown when a connection exists | justified gap, non-material |
| `tab-placeholder.ts:12` (`@if (tab().detail)` branch) | placeholder without detail; template branch | justified gap, non-material |

## Unable to test

- Cmd+W against the macOS default application menu (Electron `role: 'close'` accelerator): no macOS
  here; covered at unit level with `metaKey` only. Needs a macOS run if required.
- Actual non-Latin keyboard layouts (Cyrillic/Greek) and AZERTY in the real Electron app: simulated in
  unit tests through `key`/`code` pairs; the e2e Ctrl+W test uses the US layout.
- Screen reader behavior of the tab strip: only the ARIA structure and focus movement are asserted; no
  axe or screen reader run is configured in the project.
- The Business light / Tron dark screenshots were regenerated by the e2e run but not visually
  re-inspected in this run.

## Summary

Tests added and all validation passed. TW-1 is resolved in 0793512 (its test passes unchanged); 2 tests
were added for the uncovered `closeActive` paths (last tab -> Start, nothing to close), both pass.
Focused layout tests 142/142, `npm run check` / `.taskcheck` Pass, layout e2e 6/6 Pass. Task-scoped
coverage is verified on a fully passing suite; the only remaining gaps are defensive or generated
code, justified above.

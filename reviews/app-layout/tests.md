# Test Report

Date: 2026-11-16

Task: app-layout (M0: Application layout: sidebar, tabs, status bar, welcome screen)

Scope: `git diff e22e728c6dd49cccef7ced082fc77f44b64dc05d..1f564b567f9f8994a1661862093e84c18eb2f759`,
branch `main`, task commits 36a39bf, 181af61, ea8451a, 1f564b5 (base and commit list supplied by the
parent worker, confirmed with `git log --oneline e22e728..HEAD`: only these four commits). Re-run after
the fixer commit 1f564b5 (findings CR-1..CR-4 in `reviews/app-layout/review.md`, fixes in
`reviews/app-layout/fixes.md`). The previous report described revision 81c219e and is replaced.
Uncommitted inputs: three spec files left by an interrupted earlier test-writer run (reviewed, kept,
listed below); no production file differs from HEAD.

Requirements:
- `tasks/app-layout.md` acceptance criteria and recorded assumptions (sidebarWidth 180..560, default
  260; welcome routes `/connections/new`, `/connections/import/compass`; Ctrl/Cmd+W always consumed;
  physical W key (`code: 'KeyW'`) counts only when the typed character is not a Latin letter, AZERTY
  Ctrl+Z stays undo; drag and drop plus Ctrl+Shift+PageUp/PageDown reorder; Ctrl+PageUp/PageDown cycle)
- `reviews/app-layout/review.md` findings CR-1..CR-4 (approved by the parent) and the fixed behavior
  described in `reviews/app-layout/fixes.md`
- `docs/ARCHITECTURE.md` "Coverage", `docs/QUALITY.md`, `AGENTS.md`
- Parent worker instructions for this run

## Test files changed

Uncommitted, relative to HEAD 1f564b5 (all from the interrupted earlier run, reviewed in this run):

- `packages/renderer/src/app/layout/app-shell.spec.ts` (+61 lines, 4 tests)
- `packages/renderer/src/app/layout/sidebar-width.service.spec.ts` (+97 lines, 7 tests)
- `packages/renderer/src/app/layout/tab-bar.spec.ts` (+61 lines, 5 tests)

Review of the leftover edits: every test was read against the production code and the fix intent.
All 16 are correct, deterministic (saves are controlled with deferred promises, no real delays) and
not redundant with the tests committed in 1f564b5; all were kept unchanged. 15 pass; 1 fails because
of a production defect (TW-1) and is kept as a legitimate failing test. No existing test was changed,
weakened, skipped or deleted.

## Tests added or updated

Count: 16 (added, uncommitted)

- `sidebar-width.service.spec.ts`, new block "overlapping saves settling out of order" (CR-1):
  - the newer save fails first, the older one lands: the older width is shown
  - the older save lands, then the newer one fails: back to the older width
  - the older save fails after the newer one landed: the newer width stays
  - both saves fail: the width stored before them is shown again
  - an answer arriving during a drag does not move the splitter
  - a failure arriving during a drag does not move the splitter
  - an answer with an out-of-range width (older main) is clamped
- `tab-bar.spec.ts`, "ARIA tabs pattern" (CR-3):
  - Delete on a focused background tab closes it and keeps the selection
  - with no tab open, the arrow keys, Home and End stay on Start
  - Shift, Alt and Meta with the arrow keys or Delete are left alone
  - ArrowRight from a tab that is focused but not selected moves from that tab
  - a tab id that needs encoding is found again by its DOM id
- `app-shell.spec.ts`:
  - keyboard (CR-4): the physical W key with Shift or Alt is left alone, like Latin W
  - keyboard (CR-4): a Latin W typed on another physical key still closes the tab (Dvorak)
  - keyboard (CR-3 d): Ctrl+W with focus on the closed tab moves focus to the newly selected tab
    (FAILS, TW-1)
  - tab views (CR-3 b): tab and panel point at each other also for ids that need encoding

## Requirement coverage

Focused command (F): `cd packages/renderer && npx ng test --include='src/app/layout/**/*.spec.ts'`.
Check command (C): `npm run check` from the repo root. E2E (E):
`npm run test:e2e -- test/e2e/layout.e2e.ts` (built Electron app, Playwright `_electron`, Linux).

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 tabs open/close/reorder | `workspace.service.spec.ts` (all), `tab-bar.spec.ts` drag/drop + close tests, `app-shell.spec.ts` "tabs" (open, close by button and middle click, reorder by drag and drop), Ctrl+Shift+PageUp/PageDown move | F, C | Pass |
| AC1 sidebar width persists in settings | `sidebar-width.service.spec.ts` (init/broadcasts/commit), `app-shell.spec.ts` "sidebar width" incl. "persists across a new window", desktop `store.spec.ts` "SettingsStore sidebarWidth", contract `index.spec.ts`; e2e "the sidebar width is dragged, saved and restored after a restart" | F, C, E | Pass |
| CR-1 save races (overlapping saves, stale broadcasts/answers) | committed: "overlapping saves: answers and broadcasts of earlier saves do not undo newer widths", "a save back to the stored width while another save is in flight is still sent", "a late answer to the initial load does not undo a width saved meanwhile", app-shell "quick arrow presses with saves in flight all count"; added: the 7 "overlapping saves settling out of order" tests | F, C | Pass |
| AC2 Ctrl/Cmd+W closes a tab, always consumed | "Ctrl+W and Cmd+W close the active tab and are always consumed", "Ctrl+W on the start page with tabs open closes none of them", "closing the last tab with Ctrl+W shows the welcome screen again"; e2e "Ctrl+W does not close the window" | F, C, E | Pass |
| CR-4 W by key code, AZERTY rule | "Ctrl+W on the physical W key of a non-Latin layout closes the tab too", "a Latin letter on the W key (AZERTY Ctrl+Z) is not taken for Ctrl+W", added "the physical W key with Shift or Alt is left alone", "a Latin W typed on another physical key still closes the tab (Dvorak)" | F, C | Pass |
| AC2 Ctrl/Cmd+Tab cycles | "Ctrl+Tab cycles forward, Ctrl+Shift+Tab backward, with wrap-around", "Ctrl+PageDown/PageUp cycle ...", "Ctrl+Tab with no tab open stays on the start page", "a plain Tab keeps moving focus" | F, C | Pass |
| AC3 welcome buttons navigate | `welcome.spec.ts` ("New connection" / "Import from Compass" navigate); e2e "welcome buttons navigate to the connection editor and the Compass import" | F, C, E | Pass |
| AC3 e2e screenshot Business light and Tron dark | e2e "screenshot: layout in business light", "screenshot: layout in tron dark" (screenshots not re-inspected visually in this run) | E | Pass |
| CR-2 same-URL sidebar link | "the sidebar link shows its page again when its URL is already the current one", "the sidebar \"New connection\" link opens the connection editor page" | F, C | Pass |
| CR-3 tabs a11y (structure, ids, roving tabindex, arrows/Home/End/Delete) | `tab-bar.spec.ts` "ARIA tabs pattern" (committed + 5 added), app-shell "tab and panel point at each other also for ids that need encoding", "the routed start page is the tab panel of the Start tab" | F, C | Pass |
| CR-3 (d) focus not lost when the focused active tab is closed | button / middle click / Delete: committed tab-bar tests (Pass); Ctrl+W: "Ctrl+W with focus on the closed tab moves focus to the newly selected tab" | F, C | Fail (TW-1) |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/app/layout/**/*.spec.ts'`

Result:

Fail: 7 files, 139 tests, 138 passed, 1 failed (`AppShell > keyboard > Ctrl+W with focus on the
closed tab moves focus to the newly selected tab`, TW-1). All other layout tests pass.

## Full test execution

Command:

`npm run check` (repo root; lint, Prettier, type checks, unit tests), 21:24:05-21:24:56 +0100

Result:

Fail, only because of TW-1: backend/contract/desktop 42 files / 2551 tests passed; renderer 37 files,
663 tests, 662 passed, 1 failed (the same TW-1 test). `npm run lint` separately: Pass (eslint
`--max-warnings 0`, Prettier check clean, including the edited specs).

E2E: `npm run test:e2e -- test/e2e/layout.e2e.ts` (21:25:11-21:25:36 +0100) -> Pass, 6 passed
(layout + welcome screen, welcome navigation, Ctrl+W does not close the window, sidebar width
restored after restart, screenshots Business light / Tron dark).

## .taskcheck

Result:

Fail (`.taskcheck` runs `npm run check`; same single failure TW-1). It passes at committed HEAD
without the uncommitted test; it will pass with the kept test once TW-1 is fixed.

## Bugs found

### Ctrl/Cmd+W with focus on the closed tab drops focus to `document.body`

Finding ID:

`TW-1`

Test:

`AppShell > keyboard > Ctrl+W with focus on the closed tab moves focus to the newly selected tab`
(`packages/renderer/src/app/layout/app-shell.spec.ts:280`)

Production source:

`packages/renderer/src/app/layout/app-shell.ts` `onKeydown` (Ctrl/Cmd+W branch calls
`this.workspace.close()` directly); compare `packages/renderer/src/app/layout/tab-bar.ts` `closeTab`
/ `focusSelected`, which only the close button, middle click and Delete use.

Requirement:

Review finding CR-3 (d), accepted and fixed in 1f564b5: closing the focused active tab must move focus
to the newly active tab instead of losing it with the removed element. The fix covers the close
button, middle click and Delete, but not the task's own keyboard close shortcut (AC2 Ctrl/Cmd+W).

Expected behavior:

With tabs a, b open, b selected and its tab element focused, Ctrl+W closes b and focus moves to the
newly selected tab a (or to the Start tab when no tab is left), as it does for Delete.

Actual behavior:

The tab is closed (`tabIds()` is `['a']`), but `document.activeElement` is `document.body`: the focused element
was removed and focus is lost; keyboard and screen reader users must start over from the top.

Severity:

Low (accessibility; the close itself works, no data loss).

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.`

## Coverage

Status: partial (diagnostic). The coverage run with the full suite exits nonzero because of TW-1 and
writes no report, so the renderer numbers below come from a second run that excludes only the TW-1
test via `--filter`; they are not a passing-suite measurement. Desktop and contract runs are clean.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured (the configured tooling has no changed-line mode).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: app-layout; base
  e22e728c6dd49cccef7ced082fc77f44b64dc05d; HEAD 1f564b567f9f8994a1661862093e84c18eb2f759; commits
  36a39bf, 181af61, ea8451a, 1f564b5 from the parent, file list from
  `git diff --name-only e22e728..HEAD -- '*.ts' '*.css'`.
- Source/test snapshot identifier (including uncommitted inputs): HEAD 1f564b5 plus sha256
  `app-shell.spec.ts` 2f0279f5cbdd8fae5448e01677747181d3ce433c08e1153d56a7e975cea5e83f,
  `sidebar-width.service.spec.ts` 8c8c71a6973a56b017f5b97f4a46ccc1e62be34dc6c69f2651291846f108e219,
  `tab-bar.spec.ts` f81e5390eaec40b7c30856890c9f4e9106b0d78c4dfb8d79fa4b4518bfe07536 (same before and
  after all runs); no production file modified.
- Exact included files: renderer `src/app/app.routes.ts`, `src/app/layout/{app-shell,index,navigation,
  planned-page,sidebar-width.service,status-bar,status.service,tab-bar,tab-placeholder,tab-views,
  welcome,workspace.service}.ts`; desktop `src/settings/store.ts`; contract `src/app.ts`. Excluded:
  `packages/renderer/src/app/home.ts` (deleted by the task, nothing to instrument),
  `layout/app-shell.css` and `layout/tab-bar.css` (styles, no executable code), `test/e2e/layout.e2e.ts`
  and all `*.spec.ts` (tests), `docs/`, `reviews/`. No scoped file is missing from the reports.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 +
  `@vitest/coverage-v8` 5.1.0.
  Renderer (`packages/renderer`): `npx ng test --coverage --include='src/app/**/*.spec.ts'
  --coverage-include=src/app/... (one per renderer file above) --coverage-reporters=json-summary
  --coverage-reporters=text` -> exit nonzero (TW-1), no report written (fresh empty `coverage/`); rerun
  with `--filter='^(?!.*with focus on the closed tab)'` -> 33 files, 516 passed, 1 skipped (TW-1).
  Desktop (`apps/desktop`): `npx vitest run --coverage --coverage.include='src/settings/store.ts'
  src/settings` -> 72 passed. Contract (`packages/contract`): `npx vitest run --coverage
  --coverage.include='src/app.ts'` -> 711 passed.
- Run start/completion time and exit status: renderer failing run 21:23:14 (exit nonzero); renderer
  filtered run 21:23:29-21:23:37 +0100, all selected tests passed; desktop 21:23:58, contract
  21:23:59, both passed.
- Generated report paths and report hashes/run identifier:
  `packages/renderer/coverage/renderer/coverage-summary.json` sha256
  e847d5dffb45c5c4adcafc2adfc6d5c3ae3028b26461d924003b7ae13cb0e154;
  `apps/desktop/coverage/coverage-summary.json` sha256
  eecc73958cb6adbbd72027e8b8bc0dfc9a1fb73dc6952df8bee98d18c166dc9f;
  `packages/contract/coverage/coverage-summary.json` sha256
  8245f4145c2340f85fd3c7147c17d184247c7d50d33d3d96142015d00a6625a2.
- Evidence outputs are fresh and inputs stayed unchanged: the renderer report directory was created
  by the filtered run (timestamp 21:23:33-21:23:37, after the failing run left it empty); snapshot
  hashes identical before and after.
- Final run after latest test additions and production fixes: yes for the tests (no tests changed
  after the runs); no production fix for TW-1 exists yet, so coverage must be re-measured after it.

Values below use covered/total (percentage); zero-denominator metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/app.routes.ts` | 3/3 (100%) | N/A | 2/2 (100%) | 2/2 (100%) |
| `packages/renderer/src/app/layout/app-shell.ts` | 107/107 (100%) | 64/64 (100%) | 22/22 (100%) | 79/79 (100%) |
| `packages/renderer/src/app/layout/index.ts` | N/A | N/A | N/A | N/A |
| `packages/renderer/src/app/layout/navigation.ts` | 1/1 (100%) | N/A | N/A | 1/1 (100%) |
| `packages/renderer/src/app/layout/planned-page.ts` | 18/18 (100%) | 11/12 (91.67%) | 2/2 (100%) | 8/8 (100%) |
| `packages/renderer/src/app/layout/sidebar-width.service.ts` | 49/49 (100%) | 30/31 (96.77%) | 7/7 (100%) | 39/39 (100%) |
| `packages/renderer/src/app/layout/status-bar.ts` | 51/51 (100%) | 23/24 (95.83%) | 4/4 (100%) | 31/31 (100%) |
| `packages/renderer/src/app/layout/status.service.ts` | 26/26 (100%) | 9/9 (100%) | 11/11 (100%) | 18/18 (100%) |
| `packages/renderer/src/app/layout/tab-bar.ts` | 131/131 (100%) | 64/64 (100%) | 22/22 (100%) | 95/95 (100%) |
| `packages/renderer/src/app/layout/tab-placeholder.ts` | 16/16 (100%) | 11/12 (91.67%) | 1/1 (100%) | 7/7 (100%) |
| `packages/renderer/src/app/layout/tab-views.ts` | 3/3 (100%) | N/A | 2/2 (100%) | 3/3 (100%) |
| `packages/renderer/src/app/layout/welcome.ts` | 35/35 (100%) | 10/10 (100%) | 4/4 (100%) | 19/19 (100%) |
| `packages/renderer/src/app/layout/workspace.service.ts` | 55/55 (100%) | 37/38 (97.37%) | 16/16 (100%) | 38/38 (100%) |
| `apps/desktop/src/settings/store.ts` | 101/101 (100%) | 50/50 (100%) | 25/25 (100%) | 87/87 (100%) |
| `packages/contract/src/app.ts` | 8/8 (100%) | N/A | N/A | 8/8 (100%) |
| Aggregate (all 15 measured files, summed counters) | 604/604 (100%) | 309/314 (98.41%) | 118/118 (100%) | 435/435 (100%) |

Aggregate excludes only the files listed as excluded above (deleted `home.ts`, CSS, tests); none is
missing. Renderer figures are from the filtered (TW-1-excluded) run.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `sidebar-width.service.ts:70` (`typeof settings.sidebarWidth === 'number'` false) | save answer without `sidebarWidth`; main and contract ship together in this task, so the answer always carries it | justified gap, defensive |
| `workspace.service.ts:85` (`tabs[next]?.id ?? null` fallback) | unreachable: `next` is always a valid index for a non-empty list | justified gap, defensive |
| `planned-page.ts:46` (`data['heading'] ?? ''`) | route without heading data; every planned route sets one | justified gap, defensive |
| `status-bar.ts:155` (`conn ? ... : ''`, empty branch of a computed not rendered without a connection) | template only shows the text when a connection exists | justified gap, non-material |
| `tab-placeholder.ts:12` (`@if (tab().detail)` branch) | placeholder without detail; a template branch | justified gap, non-material |
| `app-shell.ts` Ctrl+W branch (covered, but behavior wrong) | CR-3 (d) focus after keyboard close | TW-1 test kept failing |

## Unable to test

- Cmd+W against the macOS default application menu (Electron `role: 'close'` accelerator): no macOS
  here; covered at unit level with `metaKey` only. Needs a macOS run if required.
- Actual non-Latin keyboard layouts (Cyrillic/Greek) and AZERTY in the real Electron app: simulated in
  unit tests through `key`/`code` pairs; the e2e Ctrl+W test uses the US layout.
- Screen reader behavior of the tab strip: only the ARIA structure is asserted; no axe or screen
  reader run is configured in the project.
- The Business light / Tron dark screenshots were regenerated by the e2e run but not visually
  re-inspected in this run.

## Summary

Tests added; production defects were discovered and must be passed to the `fixer` before task
completion. All acceptance criteria and the CR-1, CR-2, CR-4 fixes are covered by passing tests
(unit, `npm run check` apart from TW-1, and 6/6 e2e). TW-1 (Low): Ctrl/Cmd+W with focus on the closed
tab loses focus to `document.body`, the CR-3 (d) gap left for the keyboard shortcut; its failing test is kept
and makes `npm run check` / `.taskcheck` fail until fixed. Coverage after the fix must be re-measured
on a passing suite.

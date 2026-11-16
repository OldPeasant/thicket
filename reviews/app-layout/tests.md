# Test Report

Date: 2026-11-16

Task: app-layout (M0: Application layout: sidebar, tabs, status bar, welcome screen)

Scope: `git diff bb928680cc4d76df66a7e2d239b2ceb368ef23ef..81c219e0bf8c8d8ea31b19fece85b6e35db79487`
(task commits cedff49 "main window layout ..." and 81c219e "e2e for welcome navigation ...", branch
`main`, HEAD 81c219e0bf8c8d8ea31b19fece85b6e35db79487). Base and commits supplied by the parent worker
and confirmed with `git log --oneline bb92868..HEAD`. The working tree was clean at the start; the only
uncommitted changes are the test-writer's test edits listed below.

Requirements:
- `tasks/app-layout.md` acceptance criteria and recorded assumptions (sidebarWidth 180..560, default 260;
  welcome routes `/connections/new` and `/connections/import/compass`; Ctrl/Cmd+W always consumed;
  Ctrl+PageUp/PageDown cycle, Ctrl+Shift+PageUp/PageDown move)
- `docs/ARCHITECTURE.md` "Coverage", `docs/QUALITY.md`, `AGENTS.md`
- Parent worker instructions (SidebarWidthService edge cases, StatusService.track, store and contract
  validation of sidebarWidth)

## Test files changed

- `packages/renderer/src/app/layout/sidebar-width.service.spec.ts` (new)
- `packages/renderer/src/app/layout/status.service.spec.ts` (new)
- `packages/renderer/src/app/layout/status-bar.spec.ts` (new)
- `packages/renderer/src/app/layout/tab-bar.spec.ts` (new)
- `packages/renderer/src/app/layout/app-shell.spec.ts` (tests added; existing tests unchanged)
- `apps/desktop/src/settings/store.spec.ts` (tests added)
- `packages/contract/src/index.spec.ts` (tests added)
- `test/e2e/layout.e2e.ts` (type error fixed, see TW-1; no assertion changed)

## Tests added or updated

Count: 86 new test cases (68 renderer, 16 settings store, 2 contract) plus 1 updated e2e test
(`screenshot: layout in ${style} ${mode}`, type fix only).

- `sidebar-width.service.spec.ts` (22): `clampSidebarWidth` range ends, just outside, far outside,
  rounding, NaN/Infinity -> default; `init` loads once, keeps default when main is unavailable or
  sends no `sidebarWidth`, clamps an out-of-range stored width, unsubscribes on injector destroy;
  broadcasts followed, ignored without `sidebarWidth`, ignored for display during a drag (the drag's
  width is still saved), a drag ending on the broadcast width sends no save, followed again after the
  drag; `preview` clamps without saving; `commit` saves shown/given width clamped and rounded, skips an
  unchanged width; failed save reverts to the stored width and rejects, retry sends again; a failed
  save does not undo a newer preview shown meanwhile (deferred response); failure after a success
  reverts to the last saved width.
- `status.service.spec.ts` (9): initial state, set/clear connection, newest operation is current,
  unique ids for equal labels, `update` touches only its operation, `done` idempotent and `update`
  after `done` does not resurrect; `track` shows the label while pending and resolves with the value,
  removes on rejection and rejects, overlapping tracked work finishing in reverse order.
- `status-bar.spec.ts` (10): idle state, the four connection state texts, production/read-only flags,
  indeterminate bar, percentage with clamping (>1, <0), "+N more", `role=status` / `aria-live`.
- `tab-bar.spec.ts` (11): `aria-selected` on tab/home, detail and tooltip, close-button label,
  non-middle auxclick ignored, `dragstart` dataTransfer, drop on right half places after, drop-after
  marker on last tab, drop onto itself keeps order, dragend clears markers / stray drop ignored, drop
  without dragover ignored, closing the active tab via button.
- `app-shell.spec.ts` (16): separator range attributes; splitter ignores other keys, non-primary
  button, foreign pointer ids and moves without a drag; pointercancel saves; click without move saves
  nothing; failed save logs and shows the stored width again; Ctrl+Shift+PageUp/Down on the start page
  and at the ends; Cmd+PageDown not consumed; Ctrl+Tab without tabs; Ctrl+W on the start page closes
  nothing; closing the last tab shows the welcome screen; placeholder detail and tabpanel labelling;
  background tab views stay alive; sidebar "New connection" link navigates and shows the routed page.
- `store.spec.ts` (16): default 260; a pre-sidebarWidth settings.json keeps its other settings;
  save, listener notification, file content and reload after restart; both range ends accepted;
  179, 561, 300.5, 0, -1, NaN refused with nothing written; stored 179, 561, 300.5, "300", null replaced
  by the default; `undefined` keeps the width.
- `index.spec.ts` (2): `settings.sidebarWidth` accepts 180/181/260/559/560, refuses 179, 561, 260.5,
  "260", null, NaN, Infinity and a missing key; `app.settings.set` accepts `sidebarWidth` alone and
  refuses 100, 600, 300.5.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 Tabs open/close/reorder (component tests) | `AppShell › tabs` (existing 8), `TabBar` (11 new), `WorkspaceService` (existing 9), new AppShell keyboard/view edge cases | `cd packages/renderer && npx ng test --include='src/app/layout/**/*.spec.ts'` | Pass (final run: layout specs + `app.spec.ts`, 8 files, 106 tests) |
| AC1 Sidebar width persists in settings (component tests) | `AppShell › sidebar width` (existing 6) + `sidebar width edge cases` (7 new), `SidebarWidthService` (22 new), `SettingsStore sidebarWidth` (15 new + 1), contract `settings.sidebarWidth ...` (2 new) | renderer command above; `npx vitest run packages/contract apps/desktop/src/settings` | Pass (renderer as above; 782 passed) |
| AC2 Ctrl/Cmd+W closes a tab, Ctrl/Cmd+Tab cycles (test) | `AppShell › keyboard` (existing 5), `keyboard edge cases` (6 new) | renderer command above | Pass |
| AC2 Ctrl+W does not close the window (running app) | e2e `Ctrl+W does not close the window` | `npm run test:e2e -- test/e2e/layout.e2e.ts` (headless Ozone, no xvfb) | Pass |
| AC3 Welcome buttons emit the right navigation (test) | `Welcome` (existing 4), new `the sidebar "New connection" link ...` | renderer command above | Pass |
| AC3 e2e screenshot in Business light and Tron dark | e2e `screenshot: layout in business light`, `screenshot: layout in tron dark` | `npm run test:e2e -- test/e2e/layout.e2e.ts` | Pass (6 passed, 13.0 s) after the TW-1 type fix |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/app/layout/**/*.spec.ts'`

Result:

Pass (7 files / 86 tests on the first run with the new renderer specs; app-shell additions then
`--include='src/app/layout/app-shell.spec.ts'` -> 37 passed). Final layout + app.spec run: 8 files,
106 tests passed (coverage run below).

`npx vitest run packages/contract/src/index.spec.ts apps/desktop/src/settings/store.spec.ts` -> 2 files,
393 passed; final `npx vitest run packages/contract apps/desktop/src/settings` -> 5 files, 782 passed.

`npm run test:e2e -- test/e2e/layout.e2e.ts` -> 6 passed (13.0 s).

## Full test execution

Command:

`npm run check` (repository root; lint + Prettier + typecheck + vitest + ng test)

Result:

First run: Fail at lint on the test-writer's own new specs (unused `_omit` destructuring); fixed in
the specs. Second run: Fail at `typecheck`:
`test/e2e/layout.e2e.ts(108,33): error TS2584: Cannot find name 'document'` (TW-1, present at HEAD
81c219e, independent of the new tests). After fixing that test file: Pass (lint and Prettier clean,
all workspace typechecks, vitest 37 files / 2335 tests, renderer ng test 37 files / 626 tests).

## .taskcheck

Result:

Pass: `.taskcheck` runs `npm run check`, which passed on the final working tree (see above). At the
committed HEAD 81c219e without the TW-1 fix it fails at typecheck.

## Bugs found

### The e2e layout spec breaks the project typecheck (`npm run check` / `.taskcheck` fails at HEAD)

Finding ID:

`TW-1`

Test:

`npm run typecheck` (root `tsc -p tsconfig.json`), file `test/e2e/layout.e2e.ts`, test
`screenshot: layout in ${style} ${mode}`

Production source:

`test/e2e/layout.e2e.ts:108` (test code committed in 81c219e, not production code)

Requirement:

AGENTS.md: `tasks.py done` runs `.taskcheck` (`npm run check`) and refuses the task when it fails.

Expected behavior:

`npm run check` passes.

Actual behavior:

`window.evaluate(() => document.fonts.ready)` does not compile under the root tsconfig (no DOM lib):
`TS2584: Cannot find name 'document'`. Playwright's own TS transform does not type-check, so the e2e
run passed while the project check failed.

Severity:

High (blocks `tasks.py done`)

Fix required:

Applied by the test-writer in the working tree, because it is a test file: the call now reads
`document` through `globalThis` with a minimal structural type and awaits `fonts.ready` without
returning it. Behavior is unchanged; `npm run check` passes and the e2e file re-ran with 6 passed.
The parent worker must review and commit this change. No production code fix is needed.

No production defects were found: every new test passed against the unchanged production code.

Observations (not defects, no fix requested):
- `SidebarWidthService.commit` records the width main returns in `stored` but keeps showing the
  requested width; main echoes the requested value, so the two cannot differ in practice.
- The welcome screenshot test waits a fixed 400 ms for the theme transition
  (`waitForTimeout(400)`); it passed reliably here, but it is time-based.

## Coverage

Status: verified (whole-file coverage of the task-changed production files; all runs exited 0 with
fresh reports).

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured (the tooling has no changed-line report; every scoped renderer file
except `app.routes.ts` is a file new in this task, so whole-file equals changed-file coverage there).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: app-layout; base
  bb928680cc4d76df66a7e2d239b2ceb368ef23ef; HEAD 81c219e0bf8c8d8ea31b19fece85b6e35db79487; commits
  cedff49 and 81c219e named by the parent and confirmed with `git log bb92868..HEAD` and
  `git diff --stat bb92868..HEAD`.
- Source/test snapshot identifier (including uncommitted inputs): production code = HEAD 81c219e
  (no production file modified; `git status` shows only the test files listed above). Test snapshot:
  sha256 over `sha256sum packages/renderer/src/app/layout/*.spec.ts apps/desktop/src/settings/store.spec.ts packages/contract/src/index.spec.ts test/e2e/layout.e2e.ts`
  = `b7a0f7e5f091ce8f234d9c77be92f9e1305100cd00e014b64e2bb830e20107db`, taken after the last edit
  and unchanged through the final coverage runs.
- Exact included files: `packages/renderer/src/app/layout/{app-shell,navigation,planned-page,sidebar-width.service,status-bar,status.service,tab-bar,tab-placeholder,tab-views,welcome,workspace.service,index}.ts`,
  `packages/renderer/src/app/app.routes.ts`, `apps/desktop/src/settings/store.ts`,
  `packages/contract/src/app.ts`. Excluded: `*.css` (styles, no executable behavior),
  `docs/ARCHITECTURE.md` (documentation), all `*.spec.ts` and `test/e2e/layout.e2e.ts` (tests).
  Deleted: `packages/renderer/src/app/home.ts` (removed by the task; cannot be instrumented at HEAD).
  No renames.
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8` 5.1.0
  (vitest 5.1.0).
  1. `packages/renderer`: `npx ng test --coverage --include='src/app/layout/**/*.spec.ts' --include='src/app/app.spec.ts' --coverage-include='src/app/layout/**/*.ts' --coverage-include='src/app/app.routes.ts' --coverage-reporters=json-summary`
  2. `apps/desktop`: `npx vitest run --coverage --coverage.include='src/settings/store.ts' --coverage.reporter=json-summary --coverage.reporter=text-summary src/settings`
  3. `packages/contract`: `npx vitest run --coverage --coverage.include='src/app.ts' --coverage.reporter=json-summary --coverage.reporter=text-summary`
- Run start/completion time and exit status: (1) bundle 2026-11-16T20:06:24Z, tests 21:06:24 local,
  report written 21:06:27 local, 8 files / 106 tests passed, exit 0; (2) and (3) run right after
  (about 21:07 local), passed, exit 0.
- Generated report paths and report hashes/run identifier:
  `packages/renderer/coverage/renderer/coverage-summary.json` sha256 `3290e1ebd4fb428597c7f737d3afe2a80e2eee6973884bda23ba64f43579bf4e`
  (mtime 2026-11-16 21:06:27 +0100; the earlier run at 21:04 on a spec snapshot before a lint-only
  refactor produced the same hash, as expected for identical counters);
  `apps/desktop/coverage/coverage-summary.json` sha256 `eecc73958cb6adbbd72027e8b8bc0dfc9a1fb73dc6952df8bee98d18c166dc9f`;
  `packages/contract/coverage/coverage-summary.json` sha256 `8245f4145c2340f85fd3c7147c17d184247c7d50d33d3d96142015d00a6625a2`.
- Evidence outputs are fresh and inputs stayed unchanged: yes; the renderer report mtime is the run
  time, the snapshot hash above was taken after the run and no file was edited afterwards.
- Final run after latest test additions and production fixes: yes (no production fixes were made).

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/layout/app-shell.ts` | 101/101 (100%) | 58/58 (100%) | 22/22 (100%) | 74/74 (100%) |
| `packages/renderer/src/app/layout/sidebar-width.service.ts` | 42/42 (100%) | 18/18 (100%) | 7/7 (100%) | 32/32 (100%) |
| `packages/renderer/src/app/layout/status.service.ts` | 26/26 (100%) | 9/9 (100%) | 11/11 (100%) | 18/18 (100%) |
| `packages/renderer/src/app/layout/status-bar.ts` | 51/51 (100%) | 23/24 (95.8%) | 4/4 (100%) | 31/31 (100%) |
| `packages/renderer/src/app/layout/tab-bar.ts` | 83/83 (100%) | 35/35 (100%) | 15/15 (100%) | 54/54 (100%) |
| `packages/renderer/src/app/layout/workspace.service.ts` | 55/55 (100%) | 37/38 (97.4%) | 16/16 (100%) | 38/38 (100%) |
| `packages/renderer/src/app/layout/welcome.ts` | 35/35 (100%) | 10/10 (100%) | 4/4 (100%) | 19/19 (100%) |
| `packages/renderer/src/app/layout/planned-page.ts` | 18/18 (100%) | 11/12 (91.7%) | 2/2 (100%) | 8/8 (100%) |
| `packages/renderer/src/app/layout/tab-placeholder.ts` | 16/16 (100%) | 11/12 (91.7%) | 1/1 (100%) | 7/7 (100%) |
| `packages/renderer/src/app/layout/tab-views.ts` | 3/3 (100%) | N/A (0/0) | 2/2 (100%) | 3/3 (100%) |
| `packages/renderer/src/app/layout/navigation.ts` | 1/1 (100%) | N/A (0/0) | N/A (0/0) | 1/1 (100%) |
| `packages/renderer/src/app/layout/index.ts` | N/A (0/0, re-exports only) | N/A | N/A | N/A |
| `packages/renderer/src/app/app.routes.ts` | 1/3 (33.3%) | N/A (0/0) | 0/2 (0%) | 1/2 (50%) |
| `apps/desktop/src/settings/store.ts` | 101/101 (100%) | 50/50 (100%) | 25/25 (100%) | 87/87 (100%) |
| `packages/contract/src/app.ts` | 8/8 (100%) | N/A (0/0) | N/A (0/0) | 8/8 (100%) |

Aggregate over all 15 scoped files (summed counters from the three reports): statements 541/543
(99.6%), branches 262/266 (98.5%), functions 109/111 (98.2%), lines 381/382 (99.7%). No scoped file is
missing from the reports; excluded: `*.css`, docs, tests; deleted `home.ts` not measurable.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/renderer/src/app/app.routes.ts:17` (2 functions) | `loadComponent` of the pre-existing `dev/explorer` route; the task only moved it | Not task behavior; the task-owned routes (`''`, `connections/new`, `connections/import/compass`) are covered by the Welcome and AppShell specs |
| `packages/renderer/src/app/layout/status-bar.ts:155` (1 branch) | `stateText` returning `''` with no connection; the template only reads it inside `@if (connection)` | Unreachable from the template; idle rendering is tested (`shows "No connection" ...`) |
| `packages/renderer/src/app/layout/workspace.service.ts:85` (1 branch) | `tabs[next]?.id ?? null` fallback; `next` is always a valid index when tabs exist | Defensive for `noUncheckedIndexedAccess`; not reachable |
| `packages/renderer/src/app/layout/planned-page.ts:46` (1 branch) | `data['heading'] ?? ''` for a route without `heading` | Defensive; both task routes set `heading`, and both are tested |
| `packages/renderer/src/app/layout/tab-placeholder.ts:12` (1 branch) | Compiled template branch at the `<h1>` binding; both `@if (tab().detail)` cases are tested | Compiler-generated branch, no behavior left untested |

## Unable to test

- Native drag-and-drop in a real browser (pointer layout, `DataTransfer`): jsdom has no layout or
  `DragEvent`; the component tests stub `getBoundingClientRect` and `dataTransfer`. The real
  splitter drag and restart persistence are covered by the e2e test
  `the sidebar width is dragged, saved and restored after a restart` (Pass). Tab drag-and-drop is not
  exercised end to end; no follow-up required by the criteria (component tests are what AC1 names).
- Cmd+Tab on macOS is usually taken by the OS before the renderer; only the renderer handler is
  tested. No macOS available here; not required by the criteria beyond "(test)".
- The screenshots are produced and written but not compared against a baseline (the criterion asks
  for the screenshots, not visual regression); a human must look at
  `test-results/screenshots/layout-business-light.png` and `layout-tron-dark.png`.

## Summary

Tests added and all validation passed: 86 new tests, no production defects found. One test-code
defect (TW-1, the e2e file broke `npm run check` typecheck) was fixed in the test file and must be
reviewed and committed by the parent worker; with it `npm run check` and the layout e2e suite pass.

# Test Report

Date: 2026-11-16

Task: sidebar-tree - M1: Sidebar tree of connections, databases, collections

Scope: `git diff 1a756a7058ed6daa7b9f7404f4e82d98142a1674..5c68bbe84202eb77b87b63b00fbfbeb9dc1652f2`
on branch `main` (task commits 7192ed0, c65d52d, 65bdcc3, 5c68bbe, supplied by the parent worker
and matching `git log 1a756a7..HEAD`). Production files in scope:
`packages/renderer/src/app/sidebar/{sidebar-tree.service.ts, sidebar-tree.ts, sidebar-tree.html,
sidebar-format.ts, index.ts}`, `packages/renderer/src/app/layout/app-shell.ts`. Uncommitted inputs
at measurement time: only the test changes listed below.

Requirements:
- `tasks/sidebar-tree.md` acceptance criteria and recorded assumptions
- `docs/ARCHITECTURE.md` "Sidebar tree" and "Coverage" sections
- `SPEC.md` (M1 safety rules via WriteGuard)
- parent worker instructions (gap list)

## Test files changed

- `packages/renderer/src/app/sidebar/sidebar-tree.service.spec.ts` (new)
- `packages/renderer/src/app/sidebar/sidebar-tree.spec.ts` (new describe blocks appended; no existing test changed)
- `test/e2e/sidebar.e2e.ts` (Prettier formatting only: the committed file failed `prettier --check`, which broke `npm run check`; no assertion changed)

## Tests added or updated

Count: 111 test cases (78 in the new service spec, counting `it.each` rows; 33 in the component spec)

- Service spec: `dbNameProblem` (forbidden characters, 63/64-byte boundary, multi-byte names),
  `collNameProblem` (empty, `$`, null char, `system.` prefix, leading/trailing dot), `formatBytes`
  (B..PB, thresholds, beyond PB), `formatDocs` (singular, thousands); tab id / keys; profiles
  (safety flags registered, conn.status applied, conn.status failure, `start()` once, no loading
  flicker on reload, stale older success and stale older failure ignored); lists (case-insensitive
  numeric sort, stale `db.listDatabases` / `coll.list` answers ignored, per-database generations,
  loading vs reload, NOT_CONNECTED vs other errors); stats (`raw` stripped, error paths, stale
  `coll.stats`); connections (connecting state, conn.open failure, password passed only when
  given, `asksPassword`, disconnect forgets only that profile, disconnect with failing
  `conn.close`, error broadcast forgets lists, `backend.restarted` resets everything); writes and
  tabs (`openCollection` data/production/fallback, drop database closes only that database's
  collection tabs, drop collection closes only its tab, cancelled/failed drop closes nothing,
  drops require the typed name on non-production, rename closes old tab and clears stats,
  create/rename without dialog on non-production, production confirm/cancel, read-only refusal
  for every write).
- Component spec: menu keyboard nav (arrows with wrap, Home/End, skipping disabled items, Tab
  closes and refocuses), outside vs inside mousedown, ContextMenu key, disconnected-connection
  menu, view menu items, menu Refresh, failed coll/db stats on the node, notice dismiss; prompt
  focus (from the menu and for the password prompt), Escape closes and refocuses, Escape ignored
  while busy, focus trap Tab/Shift+Tab, rename to the same name, invalid collection name,
  failed password connect keeps prompt, cancelled production confirm keeps prompt; empty lists,
  collapse without disconnect, Home/End/Space, connecting line, failed database list + retry,
  Connect link after a disconnect, already-open connection loads without `conn.open`, Open menu
  item, stats placeholder, double submit sends once, ArrowRight/ArrowUp/F10, refresh button,
  backend restart resets the tree.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: component tests with the fake API for lazy load | `SidebarTree > lazy loading` (existing), `tree details` (connecting line, already-open connection, empty lists, collapse), `SidebarTreeService > lists`, `> profiles` | `cd packages/renderer && npx ng test --include src/app/sidebar` | Pass |
| AC1: errors | `SidebarTree > errors` (existing), `tree details > shows a failed database list with a retry`, `menu details > shows a failed (database) stats request…`, service `lists`/`stats`/`connections` error tests, stale-response tests | same | Pass |
| AC1: context actions | `SidebarTree > context actions` (existing), `menu details`, `prompt details` (except the one below), service `writes and tabs` | same | Pass, except TW-1 |
| AC1: context-action prompt gets keyboard focus (prompt is `aria-modal` with a focus trap; implementation sets `promptFocusPending`) | `SidebarTree > prompt details > focuses the first field of a prompt opened from the context menu` | same | Fail (TW-1) |
| AC2: e2e create db+collection, rename, drop with typed name | `test/e2e/sidebar.e2e.ts` (2 tests) | `npm run test:e2e -- test/e2e/sidebar.e2e.ts` (Podman mongo fixture) | Pass (2 passed, 7.5 s) |
| AC3: read-only profile disables write actions | `SidebarTree > read-only profiles` (existing), service `writes on a read-only profile are refused without a request`, e2e `a read-only profile disables the write actions` | ng test as above; e2e as above | Pass |
| ARCHITECTURE: slower older answer never overwrites a newer one | service `ignores an older …` (profiles, db list, coll list failure, coll.stats), `lists of different databases do not share a generation` | ng test as above | Pass |
| ARCHITECTURE: `backend.restarted` clears everything | service `backend.restarted resets …`, component `resets the tree when the backend restarts` | ng test as above | Pass |
| ARCHITECTURE: drop and rename close the affected collection tabs | service `dropping a database closes …`, `dropping a collection closes only its tab`, `renaming closes the tab …`, `a cancelled drop …`, `a failed drop closes no tab` | ng test as above | Pass |
| Assumption: drops always confirm with typed name; create/rename confirm only on production | service `drops always ask for the typed name…`, `create and rename on a non-production profile…`, `create on a production profile asks first…`, `rename on a production profile…` | ng test as above | Pass |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include src/app/sidebar`

Result:

Fail: 137 passed, 1 failed (TW-1). Service spec alone: 78 passed.

## Full test execution

Command:

`npm run check` (repo root)

Result:

Fail. `eslint . --max-warnings 0`, `prettier --check .` and all typechecks pass (after the
formatting-only fix of `test/e2e/sidebar.e2e.ts`); root `vitest run` 44 files / 2684 tests pass;
renderer `ng test`: 974 passed, 1 failed (TW-1).

Also run: `npm run test:e2e -- test/e2e/sidebar.e2e.ts` -> 2 passed (after the formatting change).

## .taskcheck

Result:

Fail (`.taskcheck` runs `npm run check`; fails only on TW-1).

## Bugs found

### Prompt opened from the context menu does not receive focus

Finding ID:

`TW-1`

Test:

`SidebarTree > prompt details > focuses the first field of a prompt opened from the context menu`

Production source:

`packages/renderer/src/app/sidebar/sidebar-tree.ts:520-525` (`chooseItem`) with the
`afterRenderEffect` at `sidebar-tree.ts:237-256`

Requirement:

Context actions (AC1) must be usable; the prompt is a modal dialog (`role="dialog"`,
`aria-modal="true"`, Tab focus trap in `onPromptKeydown`) and the component explicitly intends to
focus its first input (`promptFocusPending`). Keyboard use of the tree is documented in
`docs/ARCHITECTURE.md` "Sidebar tree".

Expected behavior:

After choosing "Create database…", "Create collection…" or "Rename…" from the context menu, focus
is in the prompt's first input, so the name can be typed and Escape/Tab work.

Actual behavior:

Focus ends on the tree node (`document.activeElement` is the database `li`). `chooseItem` calls
`refocus()` (sets `focusPending`) before `item.run()` opens the prompt; in the following
`afterRenderEffect` run the input is focused first and then `focusPending` moves focus back to the
tree node. A keyboard user's typing, Escape and Enter go to the tree instead of the dialog. The
password prompt opened by clicking a connection is not affected (separate test passes).

Severity:

Medium

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.`

## Coverage

Status: partial-failed. The official task-scoped coverage command exits non-zero because of TW-1
and writes no report (`coverage/renderer` absent after the run). A diagnostic run that deselects
only the TW-1 test (via `--filter`, not by skipping it in the file) passed and produced the
numbers below; they are diagnostic, not a passing validation.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured (the tooling has no changed-line mode configured).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `sidebar-tree`;
  base `1a756a7058ed6daa7b9f7404f4e82d98142a1674`; HEAD `5c68bbe84202eb77b87b63b00fbfbeb9dc1652f2`;
  commits 7192ed0, c65d52d, 65bdcc3, 5c68bbe as supplied by the parent and confirmed with
  `git log --oneline 1a756a7..HEAD` / `git diff --stat 1a756a7..HEAD`.
- Source/test snapshot identifier (including uncommitted inputs): HEAD 5c68bbe plus uncommitted
  test files, sha256: `sidebar-tree.service.spec.ts` 07415c1c0228480d1a4835fee97233b60663006c45c2d7916cee3cfe1483aec3,
  `sidebar-tree.spec.ts` 77924ea086606c18360303ae0b36d12ef1e650d418e9f451da32ee1a4b0eda2d,
  `test/e2e/sidebar.e2e.ts` 031d104c389e15e2d4a390ca1663823be4be6fdbe6f88939972229427961bdaf.
  Production (unchanged, = HEAD): `sidebar-tree.service.ts` 88378af9…5d, `sidebar-tree.ts`
  568208ca…d5, `sidebar-tree.html` 7e22f21b…18d5, `sidebar-format.ts` 103a560a…1b51,
  `app-shell.ts` 950b7156…ef648. Recorded 22:32:14 before the final runs; no input changed afterwards.
- Exact included files; renamed/deleted/excluded files and reasons: included
  `src/app/sidebar/sidebar-tree.service.ts`, `src/app/sidebar/sidebar-tree.ts` (template
  `sidebar-tree.html` is compiled into it), `src/app/sidebar/sidebar-format.ts`,
  `src/app/layout/app-shell.ts`. Excluded: `src/app/sidebar/index.ts` (re-exports only),
  `sidebar-tree.css`, `app-shell.css` (styles), `docs/ARCHITECTURE.md` (docs), spec/e2e files (tests).
  No renames or deletions.
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8` 5.1.0 via
  `@angular/build` 22.2.7 unit-test builder, in `packages/renderer`.
  Official: `npx ng test --include src/app/sidebar --coverage --coverage-include='src/app/sidebar/sidebar-tree.service.ts' --coverage-include='src/app/sidebar/sidebar-tree.ts' --coverage-include='src/app/sidebar/sidebar-format.ts' --coverage-include='src/app/layout/app-shell.ts'`.
  Diagnostic: same plus `--include src/app/layout/app-shell.spec.ts --filter '^(?!.*focuses the first field of a prompt opened from the context menu)' --coverage-reporters json --coverage-reporters json-summary`.
- Run start/completion time and exit status: official run started 22:33:05, 138 tests, 1 failed,
  non-zero exit, no report written. Diagnostic run started 22:33:15, 189 passed / 1 deselected,
  report written 22:33:20.
- Generated report paths and report hashes/run identifier:
  `packages/renderer/coverage/renderer/coverage-summary.json` sha256 89f51b06439f2a0bc46dcf5d48e055b59ed1db3d33cb25dda759577665b5fb51,
  `packages/renderer/coverage/renderer/coverage-final.json` sha256 4e1532c118443705c97df0a9d77260dc4e3a243c11c18aeeef4cbb8a9d79f889 (git-ignored).
- Evidence outputs are fresh and inputs stayed unchanged: yes; the preceding official run removed
  the coverage directory, the diagnostic run recreated it (mtime 22:33:20), and inputs match the
  22:32:14 hashes.
- Final run after latest test additions and production fixes: yes for test additions; no
  production fix has been made yet (TW-1 open). Coverage must be re-measured after the fix.

Values below use covered/total (percentage); diagnostic run.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/sidebar/sidebar-tree.service.ts` | 207/207 (100%) | 80/81 (98.76%) | 61/61 (100%) | 167/167 (100%) |
| `packages/renderer/src/app/sidebar/sidebar-tree.ts` | 358/366 (97.81%) | 213/248 (85.88%) | 81/81 (100%) | 310/311 (99.67%) |
| `packages/renderer/src/app/sidebar/sidebar-format.ts` | 9/9 (100%) | 8/8 (100%) | 2/2 (100%) | 9/9 (100%) |
| `packages/renderer/src/app/layout/app-shell.ts` | 117/118 (99.15%) | 74/74 (100%) | 24/25 (96%) | 85/85 (100%) |
| Aggregate (summed counters, the 4 files above; excluded: index.ts, CSS) | 691/700 (98.71%) | 375/411 (91.24%) | 168/169 (99.40%) | 571/572 (99.82%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `sidebar-tree.service.ts:274` (stale branch of `loadDbStats`) | stale-answer guard; same helper is tested for db list, coll list, profiles, coll.stats | Justified gap: identical generation pattern covered 4 times |
| `sidebar-tree.ts:278` (coll stats `loading` text) | placeholder while stats load | Same branch for db stats tested (`shows a placeholder while stats load`); low risk |
| `sidebar-tree.ts:306` (`toggle` on a collection row) | defensive; `activate`/keys never call `toggle` for collections | Not reachable through the UI |
| `sidebar-tree.ts:308-312, 318-319` (toggle no-op / connected-with-list branches) | expand/collapse edge combinations | Main paths tested (collapse, re-expand without reload, already-open connection); remaining combinations low risk |
| `sidebar-tree.ts:515, 521, 547` (closeMenu with no menu, disabled item click, mousedown with no menu) | defensive guards | Disabled-item click is covered for the write-control path (read-only test); the rest are guards |
| `sidebar-tree.ts:585-587` (prompt replaced while its submit is running) | race: a second prompt opened during a pending submit | Not reachable while the prompt is modal (backdrop blocks the tree); justified gap |
| `sidebar-tree.ts:633` (`move` with no target) | empty node list | Not reachable: keydown always comes from an existing node |
| `sidebar-tree.ts` other branch-only locations (155, 221, 232, 254, 336-342, 467, 477, 501-507, 540, 566, 607, 619, 654, 661, 703, 714) | `??` fallbacks for unknown profiles/messages, optional-chaining on missing elements, menu position fallbacks | Defensive fallbacks; no requirement depends on them |
| `app-shell.ts:116` (`viewChild.required` initializer function) | pre-existing code, not changed by this task | Outside task scope |

## Unable to test

- Visual appearance (connection color guide line, CSS) is not asserted by unit tests; the e2e
  writes a screenshot (`sidebar-tree.png`) but nothing compares it. No follow-up needed for the
  acceptance criteria.
- Observation (not a test failure, no requirement violated): a database list request still
  pending when the profile is disconnected writes its answer back after `forgetProfile` (the
  generation is not bumped on disconnect/restart). It is invisible while disconnected and replaced
  on reconnect, so no test was added; the parent may decide whether it matters.

## Summary

Tests added; production defects were discovered and must be passed to the `fixer` before task
completion (TW-1: prompt opened from the context menu does not get focus; `npm run check` fails
until it is fixed).

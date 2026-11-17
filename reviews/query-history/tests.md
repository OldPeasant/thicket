# Test Report

Date: 2026-11-17

Task: query-history (M1: Query history and favorites)

Scope: `git diff fa76101757695f9e1a2be5acdb8940ec705749ed..e3701a6ff6705783d6312f72dfd07f3d2ab05b58 -- . ':!tasks' ':!reviews'`
on branch `main`, restricted to the task's files (the range also contains the already finished
task conflict-partial-docs, plus README/docs/user changes from other tasks; these are excluded).
Task commits: 3045006 (contract `history.*`), d7f5204 (HistoryStore in `apps/desktop/src/history`),
46e4aef (renderer `QueryHistory` service and `QueryHistoryMenu`, wired into `collection-view`),
47573ce (tests and helper reports), e3701a6 (fixes TW-1, CR-1..CR-4). This is the re-run on the final
revision e3701a6 after the fixes. The base and final revision were supplied by the parent worker and
checked against the task's `touches`, acceptance criteria and `reviews/query-history/fixes.md`.
Uncommitted inputs: none from this run (no test or production file was changed; the working tree
differs from HEAD only in `reviews/query-history/review.md`, which belongs to the code-reviewer).

Requirements:
- `tasks/query-history.md` acceptance criteria and its recorded assumptions (limit 50, dedupe after
  trimming, per collection, empty queries / opening query / Reset not recorded, favorites per
  collection with case-insensitive name replace)
- `SPEC.md` section 5 (history/ and favorites.json in main), `docs/ARCHITECTURE.md` "Coverage" and
  conventions, `AGENTS.md`
- Findings TW-1 (this report, previous run) and CR-1..CR-4 (`reviews/query-history/review.md`), as
  fixed in `reviews/query-history/fixes.md`

## Test files changed

- None in this run. Tests from the first run (already committed in 47573ce):
  `apps/desktop/src/history/store.spec.ts`, `apps/desktop/src/main/handlers.spec.ts`,
  `packages/contract/src/history.spec.ts`,
  `packages/renderer/src/app/collection/history/query-history.service.spec.ts`,
  `packages/renderer/src/app/collection/history/query-history.spec.ts`.
- Tests added by the fixer in e3701a6 (reviewed here): 2 in `store.spec.ts`, 1 in
  `query-history.service.spec.ts`, 5 in `query-history.spec.ts`.

## Tests added or updated

Count: 0 in this run. The fixer's 8 new tests cover every fix (see the table below); fresh coverage
shows 100% statements/branches/functions/lines on the changed renderer files and no uncovered
changed line in the desktop store/handlers, so no real gap remained that justified another test.
Considered and not added: (a) deleting a favorite while the panel is closed in the meantime
(`remove` early return on `!this.open()`): the code path is executed, and focusing in a closed panel
would be a harmless no-op anyway; (b) two `history.add` answers in reverse order: main now answers
in request order, and the same sequence guard is already exercised by the TW-1 and favorites tests.

The previous run's TW-1 test (`shows the latest history when the list answers after a query was
recorded`) was kept unchanged and now passes.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 store: limit | `keeps at most limit entries`, `defaults to 50 entries per collection`, `re-running the oldest query at the limit moves it up without dropping another`, `treats a limit below 1 as 1`, `reads at most limit entries from a file written with a larger limit` | `npx vitest run apps/desktop/src/history packages/contract` | Pass (6 files, 830 tests) |
| AC1 store: dedupe | `moves a query run again to the top...`, `tells queries apart by every field`, `an all-empty query leaves an existing history unchanged`, `records a query whose only non-empty field is not the filter`, `saves the same name concurrently as one favorite` | same | Pass |
| AC1 store: per collection | `keeps one history per collection and profile`, `clears one collection only`, `deletes a favorite of the collection only`, `keeps favorites of a collection apart from the same-named one of another profile` | same | Pass |
| Store robustness (corrupt/unreadable files, failed writes, atomic writes) | `edge cases` block (corrupt layout, unmovable corrupt file, unreadable file, failed request recovery, clear of a removed file, failed remove, no write for unknown id, no temp file left, copies) | same | Pass |
| CR-4: files with unknown extra fields (newer version) are read, not moved aside | `reads files with unknown extra fields (from a newer version) without moving them aside` | same | Pass |
| TW-1 (main): `history.list` answers in request order with one consistent snapshot | `answers history.list from the state before an add sent after it` | same | Pass |
| history.* wired into main, served over the window port with contract validation | `serves history.* only when a HistoryStore is given, never on the privileged port`, `answers history.* over a window port within the contract; invalid params write nothing` | `cd apps/desktop && npx vitest run src/history src/main/handlers.spec.ts --coverage ...` | Pass (2 files, 69 tests) |
| Contract `history.*` params/results | `packages/contract/src/history.spec.ts` (8 tests) | `npx vitest run apps/desktop/src/history packages/contract` | Pass |
| AC2 component: run -> appears in history; re-run fills the query bar | `shows a run query in the history; picking it fills the query bar and runs it`, `records a run on the collection the tab shows now`, `a favorite saved from an invalid bar fills the bar and shows the error without running` | `cd packages/renderer && npx ng test --watch=false --include src/app/collection` | Pass (7 files, 269 tests) |
| AC2 component: save favorite | `saves the query bar as a favorite and re-runs it from the favorites`, `Enter in the name field saves the favorite...`, `offers to replace a favorite of the same name...`, `shows a failed history request in the panel`, `Enter with a blank name neither saves nor runs the query` | same | Pass |
| TW-1 (renderer): a late `history.list` answer does not hide a query run meanwhile | `QueryHistory > shows the latest history when the list answers after a query was recorded` (previously failing), `keeps a favorite saved while the list was pending, and still applies the list entries` | same | Pass |
| CR-1: keyboard focus after pick / delete | `picking a query returns focus to the History button`, `deleting a favorite focuses the next favorite, or the name field when none is left`, `a failed delete leaves the favorite and the focus where they are` | same | Pass |
| CR-2: disclosure button, no `aria-haspopup` | `is a disclosure button, not a menu button` | same | Pass |
| CR-3: press outside closes the panel, press inside keeps it | `a press outside closes the panel; a press inside keeps it open` | same | Pass |
| Menu keyboard/toggle behavior | `Escape closes the panel...`, `Escape with the panel closed is left to the surrounding view`, `the History button toggles the panel` | same | Pass |
| QueryHistory drops stale answers after switching collection; errors / no target | `drops a list answer for a collection the tab no longer shows`, `empties the lists at once when switching collection`, `drops an add, save, delete or clear answer that arrives after switching collection`, `does not show the error of a request for a collection the tab no longer shows`, `does nothing before a collection is loaded`, `sends only the five query fields`, `shows a failed request and clears the error on the next success`, `resolves saveFavorite true on success and false on failure`, `a reload of the same collection clears an earlier error`, `loads the entries and favorites of the collection` | same | Pass |

## Focused test execution

Command:

`npx vitest run apps/desktop/src/history packages/contract` (repo root)

Result:

Pass (6 files, 830 tests)

Command:

`cd packages/renderer && npx ng test --watch=false --include src/app/collection`

Result:

Pass (7 files, 269 tests)

## Full test execution

Command:

`npm run check` (repo root: eslint + prettier, typecheck, unit tests of all workspaces)

Result:

Pass: lint and prettier clean, typecheck clean, vitest 78 files / 4222 tests passed, renderer
`ng test` 100 files / 3254 tests passed (no failure or error lines in the output).

## .taskcheck

Result:

Pass (`.taskcheck` runs `npm run check`; same run as above).

## Bugs found

### A stale `history.list` answer hides a query that was just run

Finding ID:

`TW-1`

Test:

`packages/renderer/src/app/collection/history/query-history.service.spec.ts` >
`QueryHistory > shows the latest history when the list answers after a query was recorded`

Production source:

`packages/renderer/src/app/collection/history/query-history.service.ts` (`load`, `call`) and
`apps/desktop/src/history/handlers.ts` (`history.list`)

Requirement:

AC2 "run -> appears in history".

Expected behavior:

After a query is run while the collection's `history.list` request is still pending, the history
shows the run query (the newest state wins).

Actual behavior (before the fix):

The late `history.list` answer overwrote the `history.add` answer and the run query disappeared.

Severity:

Low

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.`

Disposition: Fixed in e3701a6 and verified. Main reads entries and favorites in one serialized
`HistoryStore.list` operation (test `answers history.list from the state before an add sent after it`
passes); the renderer applies an answer only if it is newer than what each list shows (the original
TW-1 test now passes unchanged, plus `keeps a favorite saved while the list was pending, and still
applies the list entries`).

No new production defects were found in this run. CR-1..CR-4 fixes are covered by passing tests
(table above).

## Coverage

Status: verified for all task-changed production files that can be loaded in unit tests (all three
runs passed, exit status 0, fresh reports). The renderer is now measured with the full
`src/app/collection` selection, no test filtered out.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured with a tool. Manual check against the fresh lcov data: the
renderer task files are fully covered; in the desktop files the only uncovered branch is
`store.ts:98` (`errorCode`, unchanged by the fixes); the uncovered `collection-view.ts` lines
(325-330, 498-509) are pre-existing code outside this task.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: query-history;
  base fa76101757695f9e1a2be5acdb8940ec705749ed; HEAD e3701a6ff6705783d6312f72dfd07f3d2ab05b58;
  commits 3045006, d7f5204, 46e4aef, 47573ce, e3701a6 supplied by the parent / `fixes.md` and
  matching the task's `touches`.
- Source/test snapshot identifier (including uncommitted inputs): commit e3701a6; no uncommitted
  source or test changes (`git status --short` shows only `reviews/query-history/review.md`,
  before and after the runs).
- Exact included files; renamed/deleted/excluded files and reasons: included
  `apps/desktop/src/history/{store,handlers,index}.ts`, `apps/desktop/src/main/handlers.ts`,
  `packages/contract/src/{history,index}.ts`,
  `packages/renderer/src/app/collection/history/{query-history.service,query-history-menu,index}.ts`,
  `packages/renderer/src/app/collection/collection-view.ts`. Excluded:
  `apps/desktop/src/main/index.ts` (Electron bootstrap, `historyStore()` lazy singleton; not
  loadable in unit tests), `query-history-menu.html/.css`, `collection-view.html` (templates/styles;
  behavior covered by the component tests), docs, spec files. No renames or deletions.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with v8 coverage.
  1. `apps/desktop`: `npx vitest run src/history src/main/handlers.spec.ts --coverage --coverage.include='src/history/store.ts' --coverage.include='src/history/handlers.ts' --coverage.include='src/history/index.ts' --coverage.include='src/main/handlers.ts'`
  2. `packages/contract`: `npx vitest run --coverage --coverage.include='src/history.ts' --coverage.include='src/index.ts'` (all contract tests)
  3. `packages/renderer`: `npx ng test --watch=false --include src/app/collection --coverage --coverage-reporters json-summary --coverage-reporters lcov --coverage-reporters text --coverage-include='src/app/collection/history/query-history.service.ts' --coverage-include='src/app/collection/history/query-history-menu.ts' --coverage-include='src/app/collection/history/index.ts' --coverage-include='src/app/collection/collection-view.ts'`
- Run start/completion time and exit status (2026-11-17, +01:00): (3) started 05:40:39, report
  written 05:40:55, 269 passed; (1) started 05:41:05, report written 05:41:07, 69 passed;
  (2) started 05:41:07, report written 05:41:08, 790 passed. All passed (no failures).
- Generated report paths and report hashes/run identifier (sha256):
  `apps/desktop/coverage/coverage-summary.json`
  e48e16a5de0f57a3328bbff2fbe2c05b88910225a9e815a2844bf03438bc2976,
  `apps/desktop/coverage/lcov.info`
  79e4a2ba43f2414ffe38d137009de9d04f92cfcf475f2693c800745bbbcac6b7,
  `packages/contract/coverage/coverage-summary.json`
  69dfaf276c417c42af24636f07169d4e4556fc22d631102d3cc8d900356074ca (same as the previous run:
  the contract files did not change; file mtime 05:41:08 shows it was rewritten by this run),
  `packages/renderer/coverage/renderer/coverage-summary.json`
  0d2412f3302e23336ca4e8c9ba282e69ce397b4c9e190134f14f5e0d923d31f3,
  `packages/renderer/coverage/renderer/lcov.info`
  53bb756366196a88cab1892157edcd3ab084efe2950890d8aa032c4e5bfee79b.
- Evidence outputs are fresh and inputs stayed unchanged: every report's mtime falls within its
  run above; the desktop and renderer hashes differ from the previous (pre-fix) run; no source or
  test file changed during or after the runs.
- Final run after latest test additions and production fixes: yes (revision e3701a6, which
  contains all fixes and the fixer's tests).

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `apps/desktop/src/history/store.ts` | 124/124 (100%) | 49/50 (98.0%) | 45/45 (100%) | 104/104 (100%) |
| `apps/desktop/src/history/handlers.ts` | 7/7 (100%) | N/A (0/0) | 7/7 (100%) | 7/7 (100%) |
| `apps/desktop/src/history/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `apps/desktop/src/main/handlers.ts` | 18/18 (100%) | 18/18 (100%) | 6/6 (100%) | 15/15 (100%) |
| `packages/contract/src/history.ts` | 11/11 (100%) | N/A (0/0) | N/A (0/0) | 11/11 (100%) |
| `packages/contract/src/index.ts` | 25/25 (100%) | 14/14 (100%) | 10/10 (100%) | 21/21 (100%) |
| `packages/renderer/src/app/collection/history/query-history.service.ts` | 74/74 (100%) | 25/25 (100%) | 20/20 (100%) | 60/60 (100%) |
| `packages/renderer/src/app/collection/history/query-history-menu.ts` | 76/76 (100%) | 44/44 (100%) | 18/18 (100%) | 56/56 (100%) |
| `packages/renderer/src/app/collection/history/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/renderer/src/app/collection/collection-view.ts` | 262/290 (90.3%) | 136/172 (79.1%) | 78/83 (94.0%) | 227/242 (93.8%) |

Aggregate over the measured files (summed counters): statements 597/625 (95.5%), branches
286/323 (88.5%), functions 184/189 (97.4%), lines 501/516 (97.1%). Not measured:
`apps/desktop/src/main/index.ts` (excluded, see above).

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `apps/desktop/src/history/store.ts:98` (`errorCode`: a thrown value without `code`) | Defensive: non-object errors from fs | Left: Node fs always throws errors with `code`; the `code` path is tested |
| `packages/renderer/src/app/collection/collection-view.ts:325-330, 498-509` and branches in pre-existing code | Pre-existing collection-view behavior (not changed by this task) | Left: outside this task; all task-changed lines are covered |
| `apps/desktop/src/main/index.ts` (`historyStore()` wiring) | Electron wiring of `HistoryStore` in `userData` | Not unit-testable without Electron; the handler wiring is covered via `mainHandlers` |

## Unable to test

- The Electron wiring in `apps/desktop/src/main/index.ts` (`historyStore()` with
  `app.getPath('userData')`): needs a running Electron app; no follow-up needed for the criteria,
  an e2e test could cover it later.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found.
(Re-run on e3701a6: TW-1 is fixed and its regression tests pass; the CR-1..CR-4 fixes are covered by
passing tests; no new defects; focused tests, `npm run check` and `.taskcheck` pass; task-scoped
coverage re-measured on the final revision, including the renderer.)

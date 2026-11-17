# Test Report

Date: 2026-11-17

Task: query-history (M1: Query history and favorites)

Scope: `git diff fa76101757695f9e1a2be5acdb8940ec705749ed..ee1d4f64afa5240c5e30c96273022633c431323f -- . ':!tasks' ':!reviews'` on branch `main`.
Task commits: d7a046d (contract `history.*`), c03b0ca (HistoryStore in `apps/desktop/src/history`),
ee1d4f6 (renderer `QueryHistory` service and `QueryHistoryMenu`, wired into `collection-view`).
Base and commits were supplied by the parent worker and checked against the task's `touches` and
acceptance criteria. Uncommitted inputs: only the test files listed below (no production changes).

Requirements:
- `tasks/query-history.md` acceptance criteria and its recorded assumptions (limit 50, dedupe after
  trimming, per collection, empty queries / opening query / Reset not recorded, favorites per
  collection with case-insensitive name replace)
- `SPEC.md` section 5 (history/ and favorites.json in main), `docs/ARCHITECTURE.md` "Coverage" and
  conventions, `AGENTS.md`

## Test files changed

- `apps/desktop/src/history/store.spec.ts` (extended: `edge cases` block)
- `apps/desktop/src/main/handlers.spec.ts` (extended: `main handlers with a HistoryStore`)
- `packages/contract/src/history.spec.ts` (new)
- `packages/renderer/src/app/collection/history/query-history.service.spec.ts` (new)
- `packages/renderer/src/app/collection/history/query-history.spec.ts` (extended)

## Tests added or updated

Count: 43 (store 17, main handlers 2, contract 8, QueryHistory service 11, component 5). No
existing test was changed, weakened or skipped.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 store: limit | `keeps at most limit entries`, `defaults to 50 entries per collection` (existing); `re-running the oldest query at the limit moves it up without dropping another`, `treats a limit below 1 as 1`, `reads at most limit entries from a file written with a larger limit` (new) | `cd apps/desktop && npx vitest run src/history` | Pass (38/38) |
| AC1 store: dedupe | `moves a query run again to the top...`, `tells queries apart by every field` (existing); `an all-empty query leaves an existing history unchanged`, `records a query whose only non-empty field is not the filter`, `saves the same name concurrently as one favorite` (new) | same | Pass |
| AC1 store: per collection | `keeps one history per collection and profile`, `clears one collection only`, `deletes a favorite of the collection only` (existing); `keeps favorites of a collection apart from the same-named one of another profile` (new) | same | Pass |
| Store robustness (corrupt/unreadable files, failed writes, atomic writes) | `treats a history file with an unknown layout (version 0) as corrupt`, `fails and logs when a corrupt file cannot be moved aside`, `logs a file that cannot be read`, `keeps serving requests after a failed one`, `clears a history whose file was already removed`, `fails clear (keeping the history) when the file cannot be removed`, `does not write favorites.json when deleting an unknown id`, `leaves no temporary file behind after a write`, `returns copies...` | same | Pass |
| history.* wired into main, served over the window port with contract validation | `serves history.* only when a HistoryStore is given, never on the privileged port`, `answers history.* over a window port within the contract; invalid params write nothing` | `cd apps/desktop && npx vitest run src/history src/main/handlers.spec.ts` | Pass (67/67) |
| Contract `history.*` params/results | `packages/contract/src/history.spec.ts` (8 tests: route main, text kept as typed, strict query object, field length limit, name trim/length/blank, collection required, result shapes) | `cd packages/contract && npx vitest run` | Pass (790/790) |
| AC2 component: run -> appears in history; re-run fills the query bar | `shows a run query in the history; picking it fills the query bar and runs it` (existing); `records a run on the collection the tab shows now`, `a favorite saved from an invalid bar fills the bar and shows the error without running` (new) | `cd packages/renderer && npx ng test --include src/app/collection/history` | Pass |
| AC2 component: save favorite | `saves the query bar as a favorite and re-runs it from the favorites`, `Enter in the name field saves the favorite...`, `offers to replace a favorite of the same name...`, `shows a failed history request in the panel` (existing); `Enter with a blank name neither saves nor runs the query` (new) | same | Pass |
| Menu keyboard/toggle behavior | `Escape closes the panel...` (existing); `Escape with the panel closed is left to the surrounding view`, `the History button toggles the panel` (new) | same | Pass |
| QueryHistory drops stale answers after switching collection | `drops a list answer for a collection the tab no longer shows`, `empties the lists at once when switching collection`, `drops an add, save, delete or clear answer that arrives after switching collection`, `does not show the error of a request for a collection the tab no longer shows` | same | Pass |
| QueryHistory errors / no target | `does nothing before a collection is loaded`, `sends only the five query fields`, `shows a failed request and clears the error on the next success`, `resolves saveFavorite true on success and false on failure`, `a reload of the same collection clears an earlier error`, `loads the entries and favorites of the collection` | same | Pass |
| Run -> appears in history when main answers `history.list` after `history.add` (reverse order) | `QueryHistory > shows the latest history when the list answers after a query was recorded` | same | Fail (TW-1) |

## Focused test execution

Command:

`cd apps/desktop && npx vitest run src/history src/main/handlers.spec.ts`

Result:

Pass (2 files, 67 tests)

Command:

`cd packages/contract && npx vitest run src/history.spec.ts`

Result:

Pass (8 tests)

Command:

`cd packages/renderer && npx ng test --include src/app/collection/history`

Result:

Fail: 1 failed (TW-1), all other tests in the two history spec files pass.

## Full test execution

Command:

`npm run check` (repo root: lint, typecheck, unit tests of all workspaces)

Result:

Fail. Lint (eslint + prettier) and typecheck pass; the vitest workspaces pass (78 files, 4220
tests); the renderer `ng test` has 1 failed / 3227 passed: the TW-1 test only.

## .taskcheck

Result:

Fail (it runs `npm run check`; same result as above, caused only by TW-1).

## Bugs found

### A stale `history.list` answer hides a query that was just run

Finding ID:

`TW-1`

Test:

`packages/renderer/src/app/collection/history/query-history.service.spec.ts` >
`QueryHistory > shows the latest history when the list answers after a query was recorded`

Production source:

`packages/renderer/src/app/collection/history/query-history.service.ts:39-51` (`load`) and `:96-107`
(`call` only checks the target, not the request's age); the ordering comes from
`apps/desktop/src/history/handlers.ts:14-18` (`history.list` awaits `store.history()` and
`store.favoritesOf()` as two separately queued operations).

Requirement:

AC2 "run -> appears in history".

Expected behavior:

After a query is run while the collection's `history.list` request is still pending, the history
shows the run query (the newest state wins).

Actual behavior:

`QueryHistory` applies every answer for the current collection in arrival order, so the late
`history.list` answer (read before the add) overwrites the `history.add` answer and the run query
disappears from the dropdown until the tab is reopened. This order really happens in main:
a throwaway probe calling the real handlers with `history.list` then `history.add` concurrently
(deleted afterwards, not part of the change) answered `add` first and `list` second with 0 entries,
because the store queue runs list's `history()`, then the add, then list's `favoritesOf()`.
Window: running a query before the first `history.list` answer arrives (first disk read of the tab).

Severity:

Low

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.`
(For example: drop answers of requests older than the newest applied one, or read entries and
favorites in one serialized store operation so main answers in request order.)

## Coverage

Status: verified for `apps/desktop` and `packages/contract` (passing runs); partial for
`packages/renderer`: the run passed but deliberately excluded the one failing TW-1 test, because the
renderer builder writes no coverage report when a test fails (the full run, which includes TW-1,
produced an empty `coverage/` folder).

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured with a tool. Manual check against the lcov `DA`/`BRDA` data:
every added or modified executable line of `collection-view.ts` (inject at 157, `load`/`execute` at
365-366, `run`/`applyQuery`/`execute`/`reset` at 419-463) is hit; its uncovered lines (325-330,
498-509, 527-528) are pre-existing code outside this task.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: query-history;
  base fa76101757695f9e1a2be5acdb8940ec705749ed; HEAD ee1d4f64afa5240c5e30c96273022633c431323f;
  commits d7a046d, c03b0ca, ee1d4f6 supplied by the parent and matching the task's `touches`.
- Source/test snapshot identifier (including uncommitted inputs): HEAD above plus uncommitted test
  files (sha256): `apps/desktop/src/history/store.spec.ts`
  4c9f1d69c9edc559cb45c396d02f02acd1708c1350d43c4148e4851d063ae053,
  `apps/desktop/src/main/handlers.spec.ts`
  f066d95a7d0118aa774f4055d3969e56cb8d38fafbb39f16e345e064d379a42,
  `packages/contract/src/history.spec.ts`
  13bd37d02968cce6997dc9716775862beeb86865ff8b0b3e53ddbf2275456c2d,
  `packages/renderer/src/app/collection/history/query-history.service.spec.ts`
  f99e3329eba2b703603db14cd0f76d07bd9d409386b5e378924c6786b7cbd8b6,
  `packages/renderer/src/app/collection/history/query-history.spec.ts`
  111726d6526e7ebd1cd524afda192bc33f85b84c70ca3dbd8b9037629c72bdb4. No production file differs from HEAD
  (`git diff --quiet HEAD -- ':!*.spec.ts' ':!reviews'`).
- Exact included files; renamed/deleted/excluded files and reasons: included
  `apps/desktop/src/history/{store,handlers,index}.ts`, `apps/desktop/src/main/handlers.ts`,
  `packages/contract/src/{history,index}.ts`, `packages/renderer/src/app/collection/history/{query-history.service,query-history-menu,index}.ts`,
  `packages/renderer/src/app/collection/collection-view.ts`. Excluded: `apps/desktop/src/main/index.ts`
  (Electron app bootstrap, `historyStore()` lazy singleton; not loadable in unit tests),
  `query-history-menu.html/.css` and `collection-view.html` (templates/styles; behavior covered by the
  component tests), `docs/ARCHITECTURE.md`, spec files. No renames or deletions.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with
  `@vitest/coverage-v8` (Node 24.21.0).
  1. `apps/desktop`: `npx vitest run src/history src/main/handlers.spec.ts --coverage --coverage.include='src/history/store.ts' --coverage.include='src/history/handlers.ts' --coverage.include='src/history/index.ts' --coverage.include='src/main/handlers.ts'`
  2. `packages/contract`: `npx vitest run --coverage --coverage.include='src/history.ts' --coverage.include='src/index.ts'` (all contract tests)
  3. `packages/renderer`: `npx ng test --include src/app/collection --filter '^(?!.*shows the latest history when the list answers after a query was recorded)' --coverage --coverage-reporters json-summary --coverage-reporters lcov --coverage-reporters text-summary --coverage-include='src/app/collection/history/query-history.service.ts' --coverage-include='src/app/collection/history/query-history-menu.ts' --coverage-include='src/app/collection/history/index.ts' --coverage-include='src/app/collection/collection-view.ts'`
- Run start/completion time and exit status: (1) 05:31:52, 1.84 s, 67 passed, exit 0;
  (2) 05:32:05, 0.30 s, 790 passed, exit 0; (3) 05:33:17, 11.55 s, 259 passed / 1 skipped by the
  filter (TW-1), exit 0. All on 2026-11-17 (+01:00).
- Generated report paths and report hashes/run identifier (sha256):
  `apps/desktop/coverage/coverage-summary.json`
  f09af8aa3800a531f7339413eb03a81e1effbde9a8c7c58616f588544963fbb6,
  `apps/desktop/coverage/lcov.info`
  c08c9899e1fc7e03fed05efe79485917cb45fbcfc7f92eb2e0032a04d39cfffc,
  `packages/contract/coverage/coverage-summary.json`
  69dfaf276c417c42af24636f07169d4e4556fc22d631102d3cc8d900356074ca,
  `packages/renderer/coverage/renderer/coverage-summary.json`
  013a07a9e90e005a1be0f7818a594d5d8a7d4d22c99f36ed5a27c54038f87bf8,
  `packages/renderer/coverage/renderer/lcov.info`
  b9d7eab89ad089e255ae9f895714edf86496e83889289a168991f7eaa1a591aa.
- Evidence outputs are fresh and inputs stayed unchanged: each report was regenerated by the run
  above (the renderer folder was empty after the failed full run and was rewritten by run 3); the
  test-file hashes were taken after the last edit and no source changed afterwards.
- Final run after latest test additions and production fixes: yes for the tests (no production
  fixes have been made yet; after the TW-1 fix the coverage must be measured again).

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `apps/desktop/src/history/store.ts` | 121/121 (100%) | 49/50 (98.0%) | 43/43 (100%) | 102/102 (100%) |
| `apps/desktop/src/history/handlers.ts` | 8/8 (100%) | N/A (0/0) | 7/7 (100%) | 8/8 (100%) |
| `apps/desktop/src/history/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `apps/desktop/src/main/handlers.ts` | 18/18 (100%) | 18/18 (100%) | 6/6 (100%) | 15/15 (100%) |
| `packages/contract/src/history.ts` | 11/11 (100%) | N/A (0/0) | N/A (0/0) | 11/11 (100%) |
| `packages/contract/src/index.ts` | 25/25 (100%) | 14/14 (100%) | 10/10 (100%) | 21/21 (100%) |
| `packages/renderer/src/app/collection/history/query-history.service.ts` | 58/58 (100%) | 21/21 (100%) | 18/18 (100%) | 46/46 (100%) |
| `packages/renderer/src/app/collection/history/query-history-menu.ts` | 57/57 (100%) | 32/32 (100%) | 15/15 (100%) | 42/42 (100%) |
| `packages/renderer/src/app/collection/history/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/renderer/src/app/collection/collection-view.ts` | 262/290 (90.3%) | 136/172 (79.1%) | 78/83 (94.0%) | 227/242 (93.8%) |

Aggregate over the measured files (summed counters): statements 560/588 (95.2%), branches
270/307 (87.9%), functions 177/182 (97.3%), lines 472/487 (96.9%). Not measured:
`apps/desktop/src/main/index.ts` (excluded, see above). Renderer figures come from the run that
skipped the failing TW-1 test.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `apps/desktop/src/history/store.ts:92` (false branch of `errorCode`: a thrown value without `code`) | Defensive: non-object errors from fs | Left: Node fs always throws errors with `code`; the `code` path is tested |
| `packages/renderer/src/app/collection/collection-view.ts:325-330, 498-509, 527-528` and branches at 200-241, 268, 301, 350-381, 469-590 | Pre-existing collection-view behavior (not changed by this task) | Left: outside this task; all task-changed lines are covered |
| `apps/desktop/src/main/index.ts:113-122, 189` | Electron wiring of `HistoryStore` in `userData` | Not unit-testable without Electron; the handler wiring is covered via `mainHandlers` |

## Unable to test

- The Electron wiring in `apps/desktop/src/main/index.ts` (`historyStore()` with
  `app.getPath('userData')`): needs a running Electron app; no follow-up needed for the criteria,
  an e2e test could cover it later.
- Coverage of the renderer files including the TW-1 test: the builder writes no report on a test
  failure; re-measure after the fix.

## Summary

Tests added; production defects were discovered and must be passed to the `fixer` before task completion.
(TW-1, Low: a late `history.list` answer overwrites a newer `history.add` answer. All other new
tests pass; both acceptance criteria are otherwise met by passing tests.)

# Test Report

Date: 2026-11-17

Task: raw-cmd-read-pref (M2: Raw-command reads follow the profile read preference, writes its write concern)

Scope: `git diff 277e22aee71aac1d9ff5d214ba4be544ed50782c..e19cc6a2284d5295270c3dfeb648d8dcc22e05fc`
(task commits 74254089, 34048f9c, dcac112a, 13d39f13, ba871169, 8a4e44f0, e19cc6a2 on `main`, supplied by
the parent worker). This is a re-run on the final code after the review fixes (8a4e44f0: typed
`ReadPreference`, shared `rawOptions`/`isOpenCursor`, int test for cancel during getMore; e19cc6a2:
unit test that `close()` waits for an in-flight batch). Working tree clean; no uncommitted inputs.

Requirements:
- `tasks/raw-cmd-read-pref.md` acceptance criteria and its five recorded assumptions
- `docs/ARCHITECTURE.md` "Coverage"; `docs/QUALITY.md`; `AGENTS.md`
- `reviews/raw-cmd-read-pref/review.md` (CR-1..CR-4) and `reviews/raw-cmd-read-pref/fixes.md`

## Test files changed

None in this run. The production changes since the previous test report (8a4e44f0) are refactors
(`ReadPreferenceLike` -> `ReadPreference`, `rawOptions`, exported `isOpenCursor`) that the fix commits
already cover with tests (`rawOptions ...`, `isOpenCursor ...`, the `ReadPreference` instance assertions,
the `close()`-waits `it.each` and the int test for cancel during a getMore). Changed-line coverage is
100% for statements and branches, and every acceptance criterion has a passing test, so no further test
was added.

Task test files at the measured revision:
- `packages/backend/src/browse/read-preference.spec.ts`
- `packages/backend/src/docs/query/read-preference.spec.ts`
- `packages/backend/src/docs/write/read-preference.spec.ts`
- `packages/backend/src/io/import.spec.ts`
- `test/integration/raw-cmd-read-pref.int.spec.ts`

## Tests added or updated

Count: 0 (this run). Task total: 103 unit tests across the four backend spec files (all task-related
plus the pre-existing import tests) and 7 integration tests.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: `docs.find` with > 1 batch on `secondaryPreferred` reads every batch from `rs-b:27017`; cancelling kills the cursor there (int, SOCKS5 replica set fixture) | `secondaryPreferred: the find and every getMore run on rs-b`, `cancelling a multi-batch find on rs-b kills its cursor there`, `cancelling while a getMore runs on rs-b kills it and its cursor there`, `primary (the default): the find and its getMores run on rs-a` | `npm run test:int -- raw-cmd-read-pref` (Podman, SOCKS replica set fixture) | Pass (7/7 in file) |
| AC1 unit support: one pinned driver cursor; cancel during first batch/getMore; cursor closed only after the batch settles, also when `close()` is called at once | `Operation` tests in `docs/query/read-preference.spec.ts` (20 `it`/`it.each`, incl. `cancel during the %s, close() at once: ...`) | `npx vitest run src/browse/read-preference.spec.ts src/docs/query/read-preference.spec.ts src/docs/write/read-preference.spec.ts src/io/import.spec.ts` (packages/backend) | Pass |
| AC2: `docs.insert` with `writeConcern: { w: 3 }` answers `SERVER_ERROR`; with `w: 2` a secondary read sees the document (int) | `w: 3 on two members answers SERVER_ERROR (write concern error)`, `w: 2: a secondary read sees the inserted document right away` | `npm run test:int -- raw-cmd-read-pref` | Pass |
| AC2 unit support: document writes (insert/update/replace/delete/updateMany/deleteMany, import) carry the write concern, no read preference; `MongoWriteConcernError` -> SERVER_ERROR | write spec (8 tests), query spec write tests, `inserts carry the profile write concern and no read preference (raw-cmd-read-pref)` | focused command above | Pass |
| AC3: browse reads (`listCollections`, counts, stats) honour the read preference (unit) | `browse reads honour the profile read preference` (7 tests: listDatabases, db.stats, listCollections, coll.stats/$collStats counts, ...), `readOptions / withWriteConcern` (7), `ReadCursor` (5) | focused command above | Pass |
| AC3 also on a real replica set | `listCollections and coll.stats run on rs-b with secondaryPreferred` | `npm run test:int -- raw-cmd-read-pref` | Pass |
| Assumption: reads tied to a write go to the primary (`ReadPreference.primary` instance) | write spec "reads that belong to a write go to the primary" tests, query spec `the primary option reads from the primary (run and open)` | focused command above | Pass |
| Review CR-3/CR-4 fixes (typed `ReadPreference`, `rawOptions`, `isOpenCursor`) | `rawOptions adds an explicit read preference, none means the primary (RAW as is)`, `isOpenCursor is false for a missing or zero cursor id`, `readOptions adds the database read preference to the raw options` | focused command above | Pass |

## Focused test execution

Command:

`cd packages/backend && npx vitest run src/browse/read-preference.spec.ts src/docs/query/read-preference.spec.ts src/docs/write/read-preference.spec.ts src/io/import.spec.ts`

Result:

Pass (4 files, 103 tests)

## Full test execution

Command:

`npm run check` (lint, Prettier, type check, all workspace unit tests incl. renderer) and
`npm run test:int -- raw-cmd-read-pref`

Result:

Pass. Unit: 81 files / 4270 tests; renderer: 100 files / 3254 tests. Integration: 1 file / 7 tests,
2026-11-17T06:03:27+01:00, 26.9 s.

## .taskcheck

Result:

Pass (`sh .taskcheck` -> `npm run check`, exit 0, at HEAD e19cc6a2 with a clean working tree)

## Bugs found

No production defects were found.

## Coverage

Status: verified (fresh task-scoped run at the final revision, all tests passed).

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: measured. Method: added/modified lines of `git diff -U0 277e22ae..e19cc6a2` for the
five production files intersected with statement start lines and branch start lines of the v8
`coverage-final.json` (source-mapped, Istanbul format). Statements on changed lines: 134/134 (100%)
(browse.ts 82/82, query.ts 47/47, write.ts 4/4, import.ts 1/1, manager.ts 0/0 = types only). Branch
outcomes whose branch starts on a changed line: 73/73 (100%) (browse.ts 48/48, query.ts 25/25). The
branch figure is attributed by branch start line, an approximation.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `raw-cmd-read-pref`; base `277e22aee71aac1d9ff5d214ba4be544ed50782c` (= `git merge-base HEAD origin/main`); HEAD `e19cc6a2284d5295270c3dfeb648d8dcc22e05fc`; commits 74254089..e19cc6a2 supplied by the parent, matched against the task's `touches` and acceptance criteria.
- Source/test snapshot identifier (including uncommitted inputs): HEAD e19cc6a2, clean working tree (no uncommitted inputs). sha256: browse.ts `1a022e4e…79c1`, manager.ts `a07d2cb0…852d`, query.ts `9c8c0377…67c8`, write.ts `11bdc5cb…06ee`, import.ts `b029ca27…eefc`; browse/read-preference.spec.ts `a32f1a54…c0a85`, docs/query/read-preference.spec.ts `85545bd3…4f0c`, docs/write/read-preference.spec.ts `d3f5187a…08a6`, io/import.spec.ts `b884240e…3fc8`, raw-cmd-read-pref.int.spec.ts `65ac8a39…00ef`.
- Exact included files: `packages/backend/src/browse/browse.ts`, `packages/backend/src/connections/manager.ts`, `packages/backend/src/docs/query/query.ts`, `packages/backend/src/docs/write/write.ts`, `packages/backend/src/io/import.ts`. Excluded: `docs/ARCHITECTURE.md` (documentation), `reviews/*` (reports), spec files (tests). No renames or deletions.
- Provider/version, command, working directory, and test selection: vitest 5.1.0 + `@vitest/coverage-v8`; `npx vitest run --coverage --coverage.clean=true --coverage.include='src/browse/browse.ts' --coverage.include='src/connections/manager.ts' --coverage.include='src/docs/query/query.ts' --coverage.include='src/docs/write/write.ts' --coverage.include='src/io/import.ts' --coverage.reporter=json-summary --coverage.reporter=json --coverage.reporter=text` in `packages/backend`; all backend unit specs (1723 tests).
- Run start/completion time and exit status: started 2026-11-17T06:02:42+01:00, report written 06:02:59+01:00; 1723/1723 passed.
- Generated report paths and report hashes/run identifier: `packages/backend/coverage/coverage-final.json` sha256 `9f7088958c83a436a623ce6354962e80235cc1e67dcd5a540674649546be4629`; `packages/backend/coverage/coverage-summary.json` sha256 `8cbedeea94ea9b3220bf5a71f879c8ebfc42c0c19e4c36a7e6ecb6a2b243c96d` (git-ignored; directory cleaned by the run, files timestamped 06:02:59).
- Evidence outputs are fresh and inputs stayed unchanged: yes; HEAD and file hashes rechecked after the coverage, integration and check runs, working tree still clean.
- Final run after latest test additions and production fixes: yes (measured at e19cc6a2, which includes all fixes; no tests added in this run).

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/browse/browse.ts` | 235/235 (100%) | 170/173 (98.27%) | 48/48 (100%) | 192/192 (100%) |
| `packages/backend/src/connections/manager.ts` | 271/273 (99.27%) | 143/145 (98.62%) | 51/51 (100%) | 235/236 (99.58%) |
| `packages/backend/src/docs/query/query.ts` | 278/278 (100%) | 225/226 (99.56%) | 51/51 (100%) | 234/234 (100%) |
| `packages/backend/src/docs/write/write.ts` | 144/144 (100%) | 102/102 (100%) | 26/26 (100%) | 126/126 (100%) |
| `packages/backend/src/io/import.ts` | 125/125 (100%) | 69/77 (89.61%) | 14/14 (100%) | 108/108 (100%) |
| Aggregate (summed counters; all 5 files measured, none missing or excluded) | 1053/1055 (99.81%) | 709/723 (98.06%) | 190/190 (100%) | 895/896 (99.89%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `browse.ts:370,444,457` (cond-expr branches) | Name sort ties / non-Error EJSON parse failure; pre-existing (926d3ea0), not changed by this task | Outside task changes; no test added |
| `manager.ts:359,516-517` | Close-while-connecting race and NOT_CONNECTED path; pre-existing (5f686174, 2f0b3d73); task only added types | Outside task changes; no test added |
| `query.ts:64` (cond-expr branch) | Non-Error EJSON parse failure message; pre-existing (e7c0a75c) | Outside task changes; no test added |
| `import.ts:47,65,152,153,193,218,224,227` (branches) | Pre-existing import branches; the task changed only line 211 (`op.write`), covered | Outside task changes; no test added |

## Unable to test

- Whether `currentOp`/`killOp` with a `secondaryPreferred` read preference reach the same member as an in-flight command when several secondaries are eligible: the driver has no public API to target one server for a raw command (recorded task assumption). The 2-member fixture has one secondary, so the int test cannot distinguish. Follow-up only if humans reject the assumption.
- `$out`/`$merge` aggregations without the profile write concern (review CR-2) are outside this task's `touches` and recorded as an assumption; not tested here.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. All acceptance criteria pass
(integration 7/7 on the SOCKS replica set fixture, focused unit 103/103, `npm run check` / `.taskcheck`
pass) at the final revision e19cc6a2.

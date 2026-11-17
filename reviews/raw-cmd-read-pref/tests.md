# Test Report

Date: 2026-11-17

Task: raw-cmd-read-pref (M2: Raw-command reads follow the profile read preference, writes its write concern)

Scope: `git diff 87a98f10781c7633bad5346c9cc76e76ceb8bb68..83dd724840a51997173c06348223edef7ea74e99`
(task commits 4fa0d8dc, 93dcba8b, e2e70cf4, 83dd7248 on branch `main`, supplied by the parent worker),
plus the uncommitted test-file changes listed below. No production file differs from HEAD.

Requirements:
- `tasks/raw-cmd-read-pref.md` acceptance criteria and its four recorded assumptions
- `docs/ARCHITECTURE.md` "Coverage" and "Conventions"; `docs/QUALITY.md`; `AGENTS.md`
- Parent worker's focus list (Operation with `runCursorCommand`, cancel cleanup, `primary` option,
  `write()` write concern, `MongoWriteConcernError` handling, write.ts primary reads)

## Test files changed

- `packages/backend/src/docs/query/read-preference.spec.ts` (new)
- `packages/backend/src/docs/write/read-preference.spec.ts` (new)
- `packages/backend/src/browse/read-preference.spec.ts` (4 tests added)
- `packages/backend/src/io/import.spec.ts` (1 test added)
- `test/integration/raw-cmd-read-pref.int.spec.ts` (type fix only, see "Bugs found" TW-1)

## Tests added or updated

Count: 32 added (19 query, 8 write, 4 browse, 1 import), 1 test file type-fixed.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: `docs.find` > 1 batch on `secondaryPreferred` reads every batch from `rs-b`, cancel kills the cursor there (int) | existing `raw-cmd-read-pref.int.spec.ts` (6 tests) | `npx vitest run --config test/integration/vitest.config.ts test/integration/raw-cmd-read-pref.int.spec.ts` (Podman, SOCKS replica set fixture) | Pass (6 passed) |
| AC1 unit support: open/more use one driver cursor (`raw: true`, read preference, comment, batch size) | `open()/more() use one driver cursor with the read preference, comment and batch size`, `opening a second cursor closes the first one before it runs` | `npx vitest run src/docs/query/read-preference.spec.ts` (packages/backend) | Pass |
| AC1 unit support: cancel during first batch / during getMore: killOp with the read preference, cursor closed only after the batch settles (also when it fails) | `cancel during the first batch: ...`, `cancel during a getMore: ...`, `cancel during a getMore that then fails still closes the cursor`, `a cancelled primary-read operation looks for the command with the primary read preference` | same | Pass |
| Cancelled `run()` with a late cursor reply kills it with the read preference; failing killCursors ignored | `a cancelled run() whose late reply opened a cursor kills it with the read preference`, `a failing killCursors of a late run() reply does not fail close()` | same | Pass |
| AC2: `docs.insert` with `w: 3` answers SERVER_ERROR; `w: 2` secondary read sees doc (int) | existing int spec | int command above | Pass |
| AC2 unit support: `write()` adds `writeConcern`, no read preference; own write concern kept; no defaults -> nothing added; cancelled write looks on the primary | `run() sends the profile read preference; write() sends none and adds the write concern`, `write() keeps a write concern the command names itself`, `without profile defaults ...`, `a cancelled write() looks for the command on the primary` | query spec command | Pass |
| AC2 unit support: `MongoWriteConcernError` reply -> insert SERVER_ERROR "applied but not acknowledged" with server code; write errors reported first; updateMany/deleteMany same | `a MongoWriteConcernError answers its reply`, `other server errors of a write are still SERVER_ERROR`, `docs.insert answers SERVER_ERROR "applied but not acknowledged" ...`, `write errors in the same reply are reported first ...`, `updateMany and deleteMany report an unacknowledged write the same way` | `npx vitest run src/docs/query/read-preference.spec.ts src/docs/write/read-preference.spec.ts` | Pass |
| All document writes (insert/update/replace/delete/updateMany/deleteMany, import) carry the write concern on the primary | `insert, update, replace and delete carry writeConcern and no read preference`, `inserts carry the profile write concern and no read preference (raw-cmd-read-pref)` | `npx vitest run src/docs/write/read-preference.spec.ts src/io/import.spec.ts` | Pass |
| Assumption: reads tied to a write (conflict detail, previewMany, expectedCount) go to the primary | `docs.update conflict detail ...`, `docs.delete with expected values ...`, `docs.previewMany counts and samples on the primary`, `the expectedCount check of updateMany/deleteMany counts on the primary`, `countDocuments ... { primary: true }` | write + query spec commands | Pass |
| AC3: browse reads (listCollections, counts, stats) honour the read preference (unit) | existing browse `read-preference.spec.ts` tests plus added `a failing db.stats read ...`, `withWriteConcern sends only the parts the profile sets`, `without a read preference the driver cursor gets none`, `close() ignores a failing driver cursor close` | `npx vitest run src/browse/read-preference.spec.ts` | Pass |
| `killOperations` sends currentOp, `$ownOps` retry and killOp with the given read preference | `sends currentOp, the $ownOps retry and killOp with the given read preference` | query spec command | Pass |

## Focused test execution

Command:

`cd packages/backend && npx vitest run src/browse/read-preference.spec.ts src/docs/query/read-preference.spec.ts src/docs/write/read-preference.spec.ts` (43 passed) and
`npx vitest run src/io/import.spec.ts src/docs src/browse` (all passed)

Result:

Pass

## Full test execution

Command:

`npm run check` (lint + Prettier, `tsc` root + workspaces, all workspace unit tests incl. renderer `ng test`);
`npx vitest run --config test/integration/vitest.config.ts test/integration/raw-cmd-read-pref.int.spec.ts`

Result:

Pass (unit: 79 files / 4176 tests; renderer: 98 files / 3218 tests; integration: 6 passed, 22 s).
At HEAD 83dd7248 without the TW-1 fix, `npm run check` failed in `tsc` (see TW-1).

## .taskcheck

Result:

Pass (`sh .taskcheck`, exit 0, on the working tree including the new tests and the TW-1 type fix)

## Bugs found

No production defects were found.

### Task integration test does not type-check (breaks `npm run check`)

Finding ID:

`TW-1`

Test:

`npm run check` -> `tsc -p tsconfig.json`

Production source:

Not production code: `test/integration/raw-cmd-read-pref.int.spec.ts:101` (committed in e2e70cf4)

Requirement:

`.taskcheck` (`npm run check`) must pass before `tasks.py done`.

Expected behavior:

The project type check passes.

Actual behavior:

`error TS2345: Argument of type '{ _id: number; pad: string; }[]' is not assignable to parameter of type 'readonly OptionalId<Document>[]'` (`insertMany` on an untyped collection with numeric `_id`).

Severity:

Medium (the task cannot pass `done`'s check at HEAD).

Fix required:

Already fixed in the test file only (`.collection<{ _id: number; pad: string }>(coll)`); the integration test was re-run and passes. The parent worker must commit it. No production change needed.

## Coverage

Status: verified (task-scoped, fresh run after the latest test additions; production code unchanged since HEAD).

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: measured. Method: added/modified lines from `git diff -U0 87a98f10..83dd7248` intersected with the statement start lines and branch start lines of the v8 `coverage-final.json` (source-mapped, Istanbul format). Statement lines on changed lines: 113/113 (100%) (browse.ts 67/67, query.ts 41/41, write.ts 4/4, import.ts 1/1, manager.ts 0/0 = types only). Branches whose start is on a changed line: 80/80 (100%) (browse.ts 50/50, query.ts 30/30). The branch figure is attributed by branch start line, an approximation.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `raw-cmd-read-pref`; base `87a98f10781c7633bad5346c9cc76e76ceb8bb68`; HEAD `83dd724840a51997173c06348223edef7ea74e99`; commits 4fa0d8dc, 93dcba8b, e2e70cf4, 83dd7248 (supplied by the parent, matched against the task's `touches` and acceptance criteria).
- Source/test snapshot identifier (including uncommitted inputs): HEAD 83dd7248 plus sha256 of the uncommitted test files: browse/read-preference.spec.ts `815fefd5…0c3a`, docs/query/read-preference.spec.ts `2e1177dd…5ab2`, docs/write/read-preference.spec.ts `f1b68b7e…5a6b`, io/import.spec.ts `b884240e…11` (`b884240e13af8061088d117ebd884bd38f281c909bcaed11aac16eeb007c3fc8`), raw-cmd-read-pref.int.spec.ts `7f381701…dbd11`. Production sha256 (same as HEAD): browse.ts `d547091f…2c3b`, manager.ts `a07d2cb0…5a2d`, query.ts `e8cd2cbf…4ba5`, write.ts `11bdc5cb…06ee`, import.ts `b029ca27…efc`.
- Exact included files: `packages/backend/src/browse/browse.ts`, `packages/backend/src/connections/manager.ts`, `packages/backend/src/docs/query/query.ts`, `packages/backend/src/docs/write/write.ts`, `packages/backend/src/io/import.ts`. Excluded: `docs/ARCHITECTURE.md` (documentation), the spec files (tests). No renames or deletions.
- Provider/version, command, working directory, and test selection: vitest 5.1.0 + `@vitest/coverage-v8`, node v24.22.1; `npx vitest run --coverage --coverage.reportsDirectory=/tmp/tw-cov-final2 --coverage.include='src/browse/browse.ts' --coverage.include='src/connections/manager.ts' --coverage.include='src/docs/query/query.ts' --coverage.include='src/docs/write/write.ts' --coverage.include='src/io/import.ts' --coverage.reporter=json-summary --coverage.reporter=json --coverage.reporter=text-summary` in `packages/backend`; all backend unit specs (1719 tests).
- Run start/completion time and exit status: 2026-11-17T05:47:38+01:00 to 05:47:53+01:00; all tests passed, report written.
- Generated report paths and report hashes/run identifier: `/tmp/tw-cov-final2/coverage-final.json` sha256 `a13dc8f1fdc9df83927e2ef7554c6b37bcf3e46920b72f27247997407ae968b2`; `/tmp/tw-cov-final2/coverage-summary.json` sha256 `678c8e59c11bc2dc2ad4eaa8215d50c0439feb8096e05fee98f4797c1971a781` (fresh, previously non-existent directory).
- Evidence outputs are fresh and inputs stayed unchanged: yes, file hashes taken before the run; no edits during or after it.
- Final run after latest test additions and production fixes: yes (no production fixes were made).

Baseline before the new tests (same command, `/tmp/tw-cov-base`): statements 1047/1058, branches 705/730, functions 187/190, lines 892/898; query.ts lines 233/236 (uncovered 103 `MongoWriteConcernError` reply, 319-324 `killCursorId`), browse.ts 190/192.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/browse/browse.ts` | 235/235 (100%) | 172/175 (98.29%) | 47/47 (100%) | 192/192 (100%) |
| `packages/backend/src/connections/manager.ts` | 271/273 (99.27%) | 143/145 (98.62%) | 51/51 (100%) | 235/236 (99.58%) |
| `packages/backend/src/docs/query/query.ts` | 281/281 (100%) | 230/231 (99.57%) | 52/52 (100%) | 236/236 (100%) |
| `packages/backend/src/docs/write/write.ts` | 144/144 (100%) | 102/102 (100%) | 26/26 (100%) | 126/126 (100%) |
| `packages/backend/src/io/import.ts` | 125/125 (100%) | 69/77 (89.61%) | 14/14 (100%) | 108/108 (100%) |
| Aggregate (summed counters, all 5 files measured, none missing) | 1056/1058 (99.81%) | 716/730 (98.08%) | 190/190 (100%) | 897/898 (99.89%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `browse.ts:366,440,453` (cond-expr) | Pre-existing collection/db helpers, not changed by this task | Outside task changes; no test added |
| `manager.ts:359,516-517` | Pre-existing connect race / NOT_CONNECTED paths; task only added types | Outside task changes; no test added |
| `query.ts:63` (cond-expr) | Pre-existing helper, not changed by this task | Outside task changes; no test added |
| `import.ts:47,65,152,153,193,218,224,227` (branches) | Pre-existing import branches; the task changed only line 211 (`op.write`), covered | Outside task changes; no test added |

## Unable to test

- Whether `currentOp`/`killOp` with a `secondaryPreferred` read preference reach the same member as the in-flight command when several secondaries are eligible: not deterministic with the driver's public API (recorded task assumption). Unit tests only verify that the same read preference is sent. Follow-up only if humans reject the assumption.
- Driver `RunCommandCursor` behavior (e.g. `hasNext()` issuing a `getMore` when a first batch is empty but the cursor is open) is only exercised by the integration test, not by unit fakes. No defect seen.

## Summary

Tests added and all validation passed. No production defects found. One test-only defect (TW-1, the task's integration test failing `tsc`) was fixed in the test file and must be committed by the parent worker.

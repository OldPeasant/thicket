# Test Report

Date: 2026-11-16

Task: diff-ops - Core: edit diff → update operations and conflict filter

Scope: `git diff 47ace471e394cdd872f6045a03d410b73abf14e8..3599312440001055ef1c4e8bee56b58b8dbbfe65`
(branch `main`, HEAD 3599312440001055ef1c4e8bee56b58b8dbbfe65). Task-owned code commits at HEAD:
92d15dc3b97c10831b1752f777e59042e191ab54 "Add edit diff to update operations and conflict filter" and
3599312440001055ef1c4e8bee56b58b8dbbfe65 "Add diff-ops unit and integration tests". The parent named
them d8fc1f2 / a697f60; those hashes do not exist in this clone (the commits were rebased); the
subjects, base and file list match the task, so ownership was established from the base commit, the
commit subjects and the task's `touches: [packages/core/src/diff]`. The other commits in the range
only touch `tasks/diff-ops.md` (assumptions). Uncommitted: only this test-writer's test changes
(listed below) plus `reviews/diff-ops/review.md` from the code-reviewer (not touched).

Requirements:
- `tasks/diff-ops.md` acceptance criteria and recorded assumptions
- `SPEC.md` "Documents" (Save: minimal `$set`/`$unset`, `$push` for pure appends, conflict filter
  = `_id` + original values of every changed top-level field)
- `docs/ARCHITECTURE.md` (test conventions, "Coverage")

## Test files changed

- `packages/core/src/diff/fixtures.ts` (15 new shared edit cases, used by the unit and the integration test)
- `packages/core/src/diff/diff.spec.ts` (edge-case unit tests)
- `test/integration/diff-ops.int.spec.ts` (concurrent-removal conflict test, stale-save test; harness fix)

## Tests added or updated

Count: 23 new unit tests (75 → 98 in `src/diff`); integration: 15 new fixture cases × (apply +
conflict filter + concurrent removal) and a new concurrent-removal check for every existing case and
a stale-save test, each against mongo8 and mongo7 (diff-ops file 128 → 284 tests: 47 changing
cases × 3 + 1, per server; full int suite 312).

New fixture cases: null → value (top level); value → null is a `$set`; empty nested document gets a
field; last nested field removed; array emptied; append of an item equal to the last → `$push`; nested
array appended as one item; array → document type change; decimal/binary/timestamp changes; nested
reorder + new sibling + unset elsewhere; top-level reorder + value change (filter checks only the
changed field); new nested empty key → replace parent; changed top-level empty key → replace with
`$expr`; removed top-level `$` key → replace with `$expr`; top-level reorder in a document that keeps
a `$` key → replace.

New unit tests: int vs long `_id` is a changed `_id`; pure top-level reorder checks every original
field; `changedFields` order of a replace; inputs are not mutated; structurally equal documents
(NaN, nested) → `none`; document `_id`; reordered embedded `_id` refused; `toUpdateDocument` operator
grouping/order.

Harness fix (not a weakening): the existing "conflict filter" integration test rewrote the server
document with `replaceOne`, which the server rejects for documents with a top-level `$` key; it now
uses delete + insert, with the same assertion.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 table-driven tests: nested set, unset, rename, type change, append → `$push`, item change → replace, reorder → replace parent | `diffDocuments > $name` (DIFF_CASES, 48 cases), edge-case suite, `toUpdateDocument`, `isAddressableKey`, `bsonEquals` | `cd packages/core && npx vitest run src/diff` | Pass (98/98) |
| AC2 applying the update to the original on a real server yields the edited doc | `diff-ops against mongo8/mongo7 > applying the update yields the edited document: $name` | `npm run test:int` (repo root, Podman) | Fail: 1 case × 2 servers, TW-2; all other cases pass |
| AC3 conflict filter matches the unchanged server doc, not one with a changed field modified | `conflict filter: $name`, `conflict filter detects a concurrent removal: $name`, `a stale save does not overwrite a concurrent change` | `npm run test:int` (repo root, Podman) | Fail: 1 case × 2 servers, TW-1; all other cases pass |
| Project check | lint, typecheck, unit tests of all workspaces | `npm run check` (= `.taskcheck`) | Pass (core 1467 tests, renderer 181 tests) |

## Focused test execution

Command:

`cd packages/core && npx vitest run src/diff`

Result:

Pass (98 tests)

## Full test execution

Command:

`npm run test:int` (repo root; Testcontainers on Podman, MongoDB 8 and 7)

Result:

Fail: 4 failed, 308 passed (312). The 4 failures are the new tests for TW-1 and TW-2 (each on both
servers); all other integration tests pass.

## .taskcheck

Result:

Pass (`npm run check`: eslint, Prettier, typecheck, unit tests; the integration tests are not part of it)

## Bugs found

### Conflict filter misses a concurrent removal of a field whose original value is null

Finding ID:

`TW-1`

Test:

`diff-ops against mongo8 > conflict filter detects a concurrent removal: null → value (top-level)` (and the mongo7 variant)

Production source:

`packages/core/src/diff/diff.ts:188` (`conflict`: `{ key: '$eq', value: ov }`)

Requirement:

AC3 / SPEC "Documents": the filter checks the original values of every changed top-level field, so it
must not match a server document in which a changed field was modified.

Expected behavior:

Original `{_id, a: null, b: 1}` edited to `a: "set"`; another user removed `a` on the server; the
filter `{_id, a: {$eq: null}}` should match nothing (conflict).

Actual behavior:

`{$eq: null}` also matches documents where the field is missing, so the filter matches (count 1) and
the save silently overwrites the concurrent removal. A null check needs e.g. `{$type: 'null'}` (or
`$eq: null` plus `$exists: true`). The recorded assumption lists other `$eq` limits (array/number
semantics) but not this one.

Severity:

Medium

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.`

### A `replace` diff for a document with a top-level `$` key is rejected by the server

Finding ID:

`TW-2`

Test:

`diff-ops against mongo8 > applying the update yields the edited document: top-level reorder in a document that keeps a $-prefixed key → replace` (and the mongo7 variant)

Production source:

`packages/core/src/diff/diff.ts:86` (returns `kind: 'replace'` with `replacement: edited`), together
with the replace decision at `diff.ts:140`/`:156`

Requirement:

AC2: applying the produced update to the original yields the edited document for every case; the
recorded assumption says unaddressable top-level keys produce a `replace` for `docs.replace`.

Expected behavior:

The produced operation can be applied, or the diff reports explicitly that it cannot express the edit.

Actual behavior:

`replaceOne` fails with `MongoServerError: The dollar ($) prefixed field '$k' in '$k' is not allowed
in the context of an update's replacement document` on MongoDB 8 and 7. This applies whenever the
edited document contains a top-level `$` key and the diff falls back to `replace` (top-level reorder,
a new or changed top-level `$` key, as in the existing unit test "replaces the document for a
top-level key with a $ prefix"). No data is corrupted (the write fails), but the user gets a raw server
error. The server suggests an aggregation-pipeline update (`$replaceWith` with `$literal`/`$setField`).
Top-level keys containing `.` or empty keys do work with `replaceOne` (their cases pass).

Severity:

Low

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.`

## Coverage

Status: verified (fresh run on the final test snapshot; production code unchanged from HEAD)

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured separately; both files are new in this task, so every executable
line is a changed line and whole-file coverage equals changed-line coverage here.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: diff-ops; base
  47ace471e394cdd872f6045a03d410b73abf14e8; HEAD 3599312440001055ef1c4e8bee56b58b8dbbfe65; commits
  92d15dc, 3599312 (see Scope)
- Source/test snapshot identifier (including uncommitted inputs): sha256 diff.ts 831b4843…a9110,
  equals.ts 340ddc7c…124ad1, index.ts 4cbea9d0…0a5981 (all equal to HEAD); diff.spec.ts
  f2b335b7…4738d4, fixtures.ts beac5859…a239, diff-ops.int.spec.ts 34ecd1c9…e8f5 (uncommitted test changes)
- Exact included files; renamed/deleted/excluded files and reasons: included
  `packages/core/src/diff/diff.ts`, `packages/core/src/diff/equals.ts`. Excluded:
  `packages/core/src/diff/index.ts` and the added line in `packages/core/src/index.ts` (re-exports
  only, no executable behavior); `fixtures.ts`, `*.spec.ts`, `test/integration/*` (test code). No
  renames or deletions.
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8` with
  vitest 5.1.0 (node v24.22.1); `npx vitest run --coverage --coverage.include='src/diff/diff.ts'
  --coverage.include='src/diff/equals.ts'` in `packages/core`; all core unit tests (14 files, 730 tests)
- Run start/completion time and exit status: started 2026-11-16 20:03:03 +01:00, completed within
  ~2 s; all tests passed, exit status 0
- Generated report paths and report hashes/run identifier: `packages/core/coverage/coverage-summary.json`
  (sha256 8246ebb0…102ed08), `packages/core/coverage/lcov.info`, `packages/core/coverage/lcov-report/`
- Evidence outputs are fresh and inputs stayed unchanged: yes; the report is regenerated by each run
  (an earlier run at 20:01:27 gave identical counters); source hashes were taken after the final run
  and match the measured snapshot
- Final run after latest test additions and production fixes: yes for the test additions; no
  production fixes have been made yet (TW-1, TW-2 open), so a rerun is needed after the fixer

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/core/src/diff/diff.ts` | 111/111 (100%) | 72/72 (100%) | 25/25 (100%) | 83/83 (100%) |
| `packages/core/src/diff/equals.ts` | 24/24 (100%) | 61/61 (100%) | 3/3 (100%) | 21/21 (100%) |
| Total (summed counters; excluded: re-export-only `diff/index.ts`, `src/index.ts`) | 135/135 (100%) | 133/133 (100%) | 28/28 (100%) | 104/104 (100%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| none | The unit coverage was already complete; 100% line/branch coverage did not reveal TW-1 and TW-2, which depend on server query/replace semantics | Integration tests added (TW-1, TW-2) |

## Unable to test

- BSON `undefined` originals: the Node driver cannot store BSON undefined from canonical EJSON (it
  arrives as null), so the conflict filter for an undefined original cannot be verified against a
  real server here. It behaves like the null case (TW-1) as far as the driver is concerned. No
  follow-up beyond TW-1.
- Known `$eq` limits listed in the task assumptions (a scalar/array original also matches a server
  array containing it; numbers match across int/long/double) were not turned into failing tests,
  because they are recorded, human-reviewable assumptions.

## Summary

Tests added; production defects were discovered and must be passed to the `fixer` before task completion.

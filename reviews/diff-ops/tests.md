# Test Report

Date: 2026-11-16

Task: diff-ops - Core: edit diff → update operations and conflict filter

Scope: re-run on the final code after the fixer. Base 47ace471e394cdd872f6045a03d410b73abf14e8,
HEAD 27c090bf14df5e0bbbd6eb8363b58ac14e14a237 (branch `main`). Task-owned code commits: ca0dc56
(implementation), 3a14f33 and f9cd936 (tests, reports), 27c090b (fixes for TW-1/CR-1, CR-2, TW-2,
see `reviews/diff-ops/fixes.md`). Ownership was established from the parent's base/HEAD, the commit
subjects and the task's `touches: [packages/core/src/diff]`; the other commits in the range belong
to other tasks (merged main: explorer-copy, secrets-store, ...) or to TFP state (`tasks/`). Production
code at HEAD is unchanged in the working tree. Uncommitted: this run's test changes
(`diff.spec.ts`, `fixtures.ts`) and `reviews/diff-ops/review.md` (code-reviewer, not touched).

Requirements:
- `tasks/diff-ops.md` acceptance criteria and recorded assumptions (incl. the 20:08 assumption:
  null/undefined originals checked with `$type`; a replace whose edited document has a top-level
  `$` key throws `BsonModelError`)
- `SPEC.md` "Documents" (Save: minimal `$set`/`$unset`, `$push` for pure appends, conflict filter =
  `_id` + original values of every changed top-level field)
- `docs/ARCHITECTURE.md` (test conventions, "Coverage")
- `reviews/diff-ops/fixes.md` (fix intent to verify)

## Test files changed

- `packages/core/src/diff/fixtures.ts` (4 new shared edit cases, run by the unit and the integration test)
- `packages/core/src/diff/diff.spec.ts` (5 new unit tests)

## Tests added or updated

Count: 9 (4 shared fixture cases, 5 unit tests). Unit tests in `src/diff`: 103 → 112. Integration
`diff-ops` file: 284 → 308 (each new case × apply + conflict filter + concurrent removal × mongo8/mongo7).

New fixture cases (server-verified):
- `null field removed → unset, $type check` — TW-1 fix for the unset path: a concurrent removal of
  the null field, or a concurrent change, is detected.
- `null dotted key changed and a new dotted key → replace, $and of $type checks` — `$expr` null
  check combined with a `missing` check in `$and`, and the replace is accepted by the server.
- `update of a document that keeps an unchanged top-level $-prefixed key` — TW-2 fix must not
  affect updates: `$set` is applied by the server and the filter works with the `$k` field present.
- `top-level reorder in a document with a nested $-prefixed key → replace` — the TW-2 throw is
  limited to top-level `$` keys; the server accepts a replacement with nested `$` keys.

New unit tests:
- `throws for a changed top-level $ key and for any replace that keeps one` (changed `$k` value;
  a dotted-key change forcing a replace while `$k` is kept)
- `names a repeated top-level $ key only once in the error`
- `does not throw for a replace whose $ keys are only nested`
- `checks a null original that was removed by $type in the update path` (ops and full filter)
- `keeps $eq for an original array containing null` (the `$type` rule applies only to a null value
  itself, not to containers holding null)

The fixer's own tests (null top-level and `$expr` fixtures, BSON undefined unit test, `$x`/reorder
throw tests, unchanged `$k` update, nested null `$eq`) were reviewed and kept as they are. The
fixer removed the fixture `top-level reorder in a document that keeps a $-prefixed key → replace`
(it expected a server-rejected `replace`); that follows the parent's TW-2 decision, and the same
input is now a unit test expecting the `BsonModelError`, so it is not a weakening.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 table-driven tests: nested set, unset, rename, type change, append → `$push`, item change → replace, reorder → replace parent | `diffDocuments > $name` (DIFF_CASES, 52 cases), edge-case unit tests, `toUpdateDocument`, `isAddressableKey`, `bsonEquals` | `npx vitest run --root packages/core src/diff` | Pass (112/112) |
| AC2 applying the update to the original on a real server yields the edited doc | `diff-ops against mongo8/mongo7 > applying the update yields the edited document: $name` (51 changing cases per server) | `npm run test:int -- diff-ops` (repo root, Testcontainers on Podman, MongoDB 8 and 7) | Pass |
| AC3 conflict filter matches the unchanged server doc, not one with a changed field modified | `conflict filter: $name`, `conflict filter detects a concurrent removal: $name`, `a stale save does not overwrite a concurrent change` | `npm run test:int -- diff-ops` | Pass (308/308 in the file) |
| Fix TW-1/CR-1: null original checked by `$type` (query and `$expr`) | fixtures `null → value (top-level)`, `null → value for a top-level key with a dot …`, `null field removed …`, `null dotted key changed and a new dotted key …`; unit `checks a null original by $type…`, `checks a null original that was removed…` | unit + int commands above | Pass (concurrent removal detected on both servers) |
| Fix CR-2: BSON undefined original checked by `$type` | unit `checks a BSON undefined original by $type…` | unit command above | Pass (unit only; see "Unable to test") |
| Fix TW-2: replace with a top-level `$` key throws `BsonModelError`; updates and nested `$` keys unaffected | unit throw tests (new `$x`, reorder with `$k`/`$m`, changed `$k`, dotted change with kept `$k`, repeated `$k`), `does not throw … only nested`; fixtures `update of a document that keeps an unchanged top-level $-prefixed key`, `top-level reorder in a document with a nested $-prefixed key` | unit + int commands above | Pass |
| Project check | lint, Prettier, typecheck, unit tests | `npm run check` (= `.taskcheck`) | Fail, environment only: renderer cannot resolve `@angular/router`/`ajv` (see below) |

## Focused test execution

Command:

`npx vitest run --root /home/felix/work/thicket-agents/agent-2/packages/core src/diff`

Result:

Pass (112 tests)

Integration:

`npm run --prefix /home/felix/work/thicket-agents/agent-2 test:int -- diff-ops`

Result:

Pass (308 tests, mongo8 and mongo7, 28.5 s). The rest of the integration suite was not re-run (no
other production file changed).

## Full test execution

Command:

`npm run --prefix /home/felix/work/thicket-agents/agent-2 check` (lint && typecheck && test)

Result:

Fail, not caused by this task. `eslint` and `prettier --check .` pass (with the new tests);
`tsc` passes for root, desktop, contract, core and backend; root `vitest run` passes (29 files,
1642 tests). The renderer workspace fails both `typecheck` (`ngc`) and `ng test` with
`TS2307: Cannot find module '@angular/router'` and `Cannot find module 'ajv/dist/2020'` (plus
follow-on type errors in `src/app/schema/schema-validator.ts`). These modules were added by the
explorer-copy task (merged from main, commits e77e1cd/a459cb1); `package-lock.json` lists
`node_modules/@angular/router`, but this clone's `node_modules/@angular` has no `router`, i.e. the
local install is stale. No diff-ops file is involved. Follow-up for the parent: run the project's
install (`npm ci`, per `docs/ARCHITECTURE.md`) and re-run `npm run check`; the test-writer may not
install dependencies.

## .taskcheck

Result:

Fail (same as `npm run check` above: renderer dependencies missing from the local `node_modules`;
unrelated to diff-ops). Must be re-run by the parent after reinstalling dependencies.

## Bugs found

None. TW-1 and TW-2 from the previous run are fixed and verified on MongoDB 8 and 7; CR-2 is
verified at unit level.

## Coverage

Status: verified (fresh run on the final snapshot: HEAD 27c090b production code plus this run's tests)

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured separately; both files are new in this task, so every
executable line is a changed line and whole-file coverage equals changed-line coverage here.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: diff-ops; base
  47ace471e394cdd872f6045a03d410b73abf14e8; HEAD 27c090bf14df5e0bbbd6eb8363b58ac14e14a237; commits
  ca0dc56, 3a14f33, f9cd936, 27c090b (see Scope)
- Source/test snapshot identifier (including uncommitted inputs): sha256 `diff.ts`
  4a41df0d…e73a (= HEAD), `equals.ts` 340ddc7c…124ad1 (= HEAD), `diff.spec.ts` acb7a084…045a9b and
  `fixtures.ts` 0bf3acb7…96fe1 (uncommitted test changes), `test/integration/diff-ops.int.spec.ts`
  34ecd1c9…0a5981 (= HEAD)
- Exact included files; renamed/deleted/excluded files and reasons: included
  `packages/core/src/diff/diff.ts`, `packages/core/src/diff/equals.ts`. Excluded:
  `packages/core/src/diff/index.ts` and the added line in `packages/core/src/index.ts`
  (re-exports only, no executable behavior); `fixtures.ts`, `*.spec.ts`, `test/integration/*`
  (test code). No renames or deletions.
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8`, vitest
  5.1.0; `npm run --prefix packages/core coverage -- src/diff --coverage.include=src/diff/diff.ts
  --coverage.include=src/diff/equals.ts` (runs `vitest run --coverage` in `packages/core`); tests
  in `src/diff` (1 file, 112 tests)
- Run start/completion time and exit status: started 2026-11-16 20:10:29 +01:00, duration 202 ms;
  112 passed, exit status 0
- Generated report paths and report hashes/run identifier:
  `packages/core/coverage/coverage-summary.json` (sha256 aa33bece…49bcb),
  `packages/core/coverage/lcov.info`, `packages/core/coverage/lcov-report/`
- Evidence outputs are fresh and inputs stayed unchanged: yes; the summary counters differ from the
  previous run (diff.ts 111 → 125 statements), so the report was regenerated; source/test hashes
  taken before and after the run are identical
- Final run after latest test additions and production fixes: yes (after fix commit 27c090b and
  after this run's test additions)

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/core/src/diff/diff.ts` | 125/125 (100%) | 82/82 (100%) | 28/28 (100%) | 92/92 (100%) |
| `packages/core/src/diff/equals.ts` | 24/24 (100%) | 61/61 (100%) | 3/3 (100%) | 21/21 (100%) |
| Total (summed counters; excluded: re-export-only `diff/index.ts`, `src/index.ts`) | 149/149 (100%) | 143/143 (100%) | 31/31 (100%) | 113/113 (100%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| none | Unit coverage is complete; the server-dependent behavior of the fixes (null `$type` vs. missing field, accepted replacements) is covered by the integration cases above | Fixtures added and run on MongoDB 8 and 7 |

## Unable to test

- BSON `undefined` originals against a real server (CR-2): the Node driver turns BSON undefined
  from canonical EJSON into null on insert, so the `$type: "undefined"` filter is verified only at
  unit level (generated filter shape). No follow-up unless such documents can be produced by
  another means.
- `npm run check` / `.taskcheck` could not pass in this clone because the renderer's dependencies
  (`@angular/router`, `ajv`) are not installed locally; the parent must reinstall and re-run.
- Known `$eq`/`$type` limits recorded in the task assumptions (a scalar or null original also
  matches a server array containing it; numbers match across int/long/double) were not turned into
  failing tests: they are recorded, human-reviewable assumptions.

## Summary

Tests added and the fixes are verified (focused unit tests 112/112, diff-ops integration 308/308 on
MongoDB 8 and 7, task-scoped coverage 100% on all metrics); no production defects found.
`npm run check` / `.taskcheck` fails only in the renderer workspace because of a stale local
`node_modules` (missing `@angular/router`, `ajv`) unrelated to this task; the parent must reinstall
dependencies and re-run the check before `tasks.py done`.

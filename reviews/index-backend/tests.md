# Test Report

Date: 2026-11-17

Task: index-backend - M3: Index management backend

Scope: immutable base `71c78ae8c9e4c27b8027ea70543d78bda7d7e011`; task code commits as supplied by the
parent (`1805029`, `1a57567`), which were rebased in this clone to `e5c306d` and `27c0d2f`
(`git diff 1a57567 27c0d2f -- packages test` is empty, so the code is identical). Measured HEAD
`cc20a4d305916756c4301b94f31ce3ae4c3b7800` (adds only `reviews/index-backend/review.md` on top), plus
the two new untracked test files listed below. Commits between base and the task commits touch only
`tasks/index-backend.md` (assumptions).

Requirements:
- `tasks/index-backend.md` acceptance criteria: (1) integration tests for each index option and for
  hide/unhide; (2) read-only refuses create/drop (int test). Goal: idx.list with size and `$indexStats`
  usage, create (compound, unique, sparse, partial, TTL, collation, hidden, text, 2dsphere, wildcard),
  drop, hide/unhide, through the guard.
- `packages/contract/src/idx.ts` (`idx.*` params/results), `docs/ARCHITECTURE.md` "Coverage".
- Parent instructions: unit tests next to the code with a fake `ClientLike` as in
  `src/browse/browse.spec.ts`.

## Test files changed

- `packages/backend/src/indexes/indexes.spec.ts` (new)
- `packages/backend/src/indexes/handlers.spec.ts` (new)

`test/integration/indexes.int.spec.ts` was reviewed and left unchanged: it already has one test per
index option (compound, unique+name, sparse, partial, TTL, collation, hidden, text, 2dsphere,
wildcard), hide/unhide with a planner check, drop and `"*"` refusal, NOT_FOUND/SERVER_ERROR paths,
the read-only and production guard, and the Unauthorized `$indexStats` fallback against a server with
access control. No real gap was found there.

## Tests added or updated

Count: 76 (56 in `indexes.spec.ts`, 20 in `handlers.spec.ts`, counting each `it.each` row).

Covered in `indexes.spec.ts`:
- `defaultIndexName`: plain, compound, dotted, text/2dsphere/wildcard keys, BSON Int32/Long values.
- `toIndexInfo`: defaults, canonical `key`/`raw`, flags only when exactly `true`, TTL from
  Int32/Long/Double (truncated), TTL omitted when negative/NaN/Infinity/non-numeric/null,
  `partialFilterExpression` kept as canonical EJSON or ignored when not a document, all options kept
  in `raw`, missing key.
- `listIndexes`: command shape and raw-batch options, server order, contract-valid result, getMore
  paging, BSON-bytes batches, NOT_FOUND, cancel kills the cursor.
- `indexStatistics`: exact command shapes, Int32/Long/Double sizes and Long ops, sharded summing of
  sizes and accesses with the earliest `since` (both orders), shards over getMore, zero/negative/
  non-numeric sizes, indexes known only to `$indexStats`, negative/missing/fractional ops, invalid or
  non-Date `since`, BSON-bytes batches, Unauthorized fallback by code 13, by code name and by Int32
  code, other errors propagating (SERVER_ERROR, NETWORK_ERROR, NOT_FOUND), cancel during
  `$indexStats` stays CANCELLED, empty `$collStats` is NOT_FOUND without `$indexStats`, failing
  `$collStats` (even Unauthorized) propagates.
- `createIndex`: command shape, default name, compound key order, explicit name, every option passed
  through with its BSON type, text/2dsphere/wildcard default names, `key` option cannot override the
  key, empty options; INVALID_PARAMS without sending for empty key, non-JSON key, array key, EJSON
  value as key, non-JSON options, non-document options, empty/numeric/null `name`; DuplicateKey and
  IndexOptionsConflict mapped.
- `dropIndex`: command shape, `"*"` refused before sending, a name containing `*` (`$**_1`) is
  dropped, IndexNotFound -> SERVER_ERROR, NamespaceNotFound -> NOT_FOUND.
- `hideIndex`: `collMod` shape for hide and unhide, server refusal mapped.

Covered in `handlers.spec.ts`: exact handler set, NOT_CONNECTED for every method without sending,
parameters routed to the right db/collection/command, `idx.drop` `"*"` refusal, reads cancellable
while pending, writes not cancellable once sent, writes still sent with an aborted signal, an
already-cancelled read answers CANCELLED.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: integration tests for each index option | `idx.create with each option (8.x replica set)` (11 tests) in `test/integration/indexes.int.spec.ts` | `npx vitest run --config test/integration/vitest.config.ts test/integration/indexes.int.spec.ts` (rootless Podman containers) | Pass (26/26 in file) |
| AC1: integration tests for hide/unhide | `idx.hide hides and unhides an index; a hidden index is not used by the planner`, `idx.hide of a missing index is SERVER_ERROR` | same as above | Pass |
| AC2: read-only refuses create/drop (int test) | `the write guard on idx.*` (`%s is READ_ONLY on a read-only profile, even confirmed`, `reads work on the read-only profile`, `a production profile needs confirmed: true`) | same as above | Pass |
| Goal: idx.list with size and `$indexStats` usage | unit `listIndexes`/`indexStatistics` suites (incl. sharded summing, Unauthorized fallback, error propagation); int `idx.stats reports a size...`, `answers sizes without accesses` | `cd packages/backend && npx vitest run src/indexes`; integration command above | Pass |
| Goal: create options, default name, input validation | unit `createIndex` and `defaultIndexName` suites | `cd packages/backend && npx vitest run src/indexes` | Pass |
| Goal: drop one index, `"*"` refused | unit `dropIndex` suite, handler `idx.drop refuses "*"`; int `idx.drop drops one index by name; "*" is refused` | unit and integration commands above | Pass |
| Handlers on the open connection, read cancel / write completion semantics | `handlers.spec.ts` | `cd packages/backend && npx vitest run src/indexes` | Pass |

## Focused test execution

Command:

`cd packages/backend && npx vitest run src/indexes`

Result:

Pass (2 files, 76 tests). Also `npx prettier --check` and `npx eslint --max-warnings 0` on both
spec files: clean; `npm run typecheck` in `packages/backend`: clean.

## Full test execution

Command:

`npm run check` (repository root: lint, typecheck, `vitest run`, renderer `ng test`)

Result:

Pass (root Vitest 57 files / 3341 tests; renderer 72 files / 2154 tests).

Integration: `npx vitest run --config test/integration/vitest.config.ts test/integration/indexes.int.spec.ts`
-> Pass (26 tests). The rest of the integration suite was not run (outside this task's scope).

## .taskcheck

Result:

Pass. `.taskcheck` runs `npm run check` when `package.json` exists; that command was run directly
(see above) and passed.

## Bugs found

None. No production defect was found; all new tests pass against the current implementation.

## Coverage

Status: verified

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: all executable changed lines are covered. Method: the task diff adds
`src/indexes/{indexes,handlers,index}.ts` as new files (whole-file numbers below apply; all lines
hit), one executable line in `src/browse/browse.ts` (line 138, `export const runCommand = run`,
lcov `DA:138,15`; the `export` keyword added on `runCursor` is not a separate executable line),
one re-export line in `src/index.ts` (hit), and an import plus a spread line in
`src/server/backend.ts` (file lines 28/28 hit). Changed-branch coverage was not measured separately.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `index-backend`;
  base `71c78ae8c9e4c27b8027ea70543d78bda7d7e011`; HEAD `cc20a4d305916756c4301b94f31ce3ae4c3b7800`;
  task commits named by the parent (`1805029`, `1a57567`, rebased as `e5c306d`, `27c0d2f`, code
  identical); file scope from `git diff 71c78ae..HEAD --stat`.
- Source/test snapshot identifier (including uncommitted inputs), sha256 before and after the run:
  `src/indexes/indexes.ts` 7969503f2ac4982195a925af51ebbd4f88f5555ee4fc16743549c205b96907ed,
  `src/indexes/handlers.ts` ed3da39d7fb5323b404458de108649932862bb7b92f0a188e8a88bc468107cc1,
  `src/indexes/index.ts` f4e61a7c828733a2cf5140ce3348601b0dbedb2fbba8f3f52fa2c7327a26eb9f,
  `src/browse/browse.ts` 1e050e785e35070a565ecbd80d0ceacf628e5f8e9b0ee21475980b7ff8690971,
  `src/server/backend.ts` 92a093b39e5f7dfbdc00f68ba6739222a1bb1266c39da8f7446bd2d825bb4f32,
  `src/index.ts` b96354e356407872e62ffdf9bcb3083b2c3a03ae768f51701fa982cf36da790c,
  untracked `src/indexes/indexes.spec.ts` d86f5e96d9c4c48f1004c8c52413bbdc829950fb5f701ea45463d6eeb761c156,
  untracked `src/indexes/handlers.spec.ts` f287f726fb0c930e3d2d05812399ce00964f2f4062f3c2b2b45c9ce9bf9a7ccd
  (paths relative to `packages/backend`).
- Exact included files: `src/indexes/indexes.ts`, `src/indexes/handlers.ts`, `src/indexes/index.ts`,
  `src/browse/browse.ts`, `src/server/backend.ts`, `src/index.ts`. Excluded: `src/server/backend.spec.ts`
  and `test/integration/indexes.int.spec.ts` (tests). No renames or deletions.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with
  `@vitest/coverage-v8` (^5.1.0), node v24.21.0; `npx vitest run --coverage
  --coverage.include='src/indexes/**' --coverage.include='src/browse/browse.ts'
  --coverage.include='src/server/backend.ts' --coverage.include='src/index.ts'` in `packages/backend`;
  whole backend unit suite (22 files, 1009 tests). Integration tests are not part of this measurement.
- Run start/completion time and exit status: 2026-11-17T03:14:13+01:00 to 03:14:20+01:00; exit 0,
  1009 passed.
- Generated report paths and report hashes/run identifier: `packages/backend/coverage/coverage-summary.json`
  (sha256 e99bd7a9f0c2317759b1846f1faf239f23a47c1f7c571a5eb2ac0916cdd3e983),
  `packages/backend/coverage/lcov.info`, `packages/backend/coverage/lcov-report/` (git-ignored).
- Evidence outputs are fresh and inputs stayed unchanged: the report was rewritten by this run (its hash
  changed from the previous run's 17fbe39c...); source and test hashes were identical before and after.
- Final run after latest test additions and production fixes: yes (no production fixes were made;
  the run includes the last test edit).

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/indexes/indexes.ts` | 67/67 (100%) | 61/61 (100%) | 10/10 (100%) | 64/64 (100%) |
| `packages/backend/src/indexes/handlers.ts` | 6/6 (100%) | N/A (0/0) | 6/6 (100%) | 6/6 (100%) |
| `packages/backend/src/indexes/index.ts` | N/A (0/0) | N/A (0/0) | N/A (0/0) | N/A (0/0) |
| `packages/backend/src/browse/browse.ts` | 171/171 (100%) | 128/131 (97.71%) | 34/34 (100%) | 141/141 (100%) |
| `packages/backend/src/server/backend.ts` | 30/32 (93.75%) | 9/10 (90%) | 10/12 (83.33%) | 28/28 (100%) |
| `packages/backend/src/index.ts` | 1/1 (100%) | N/A (0/0) | N/A (0/0) | 1/1 (100%) |
| Aggregate (summed counters, all 6 files, none missing or excluded) | 275/277 (99.28%) | 198/202 (98.02%) | 60/62 (96.77%) | 240/240 (100%) |

The aggregate matches the provider's own total (`coverage-summary.json` "total": statements 275/277,
branches 198/202, functions 60/62, lines 240/240; its text summary truncates to 99.27% / 98.01%).
All uncovered counters are in pre-existing code of `browse.ts` and `backend.ts`, outside the lines
this task changed.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/backend/src/indexes/indexes.ts:125` (later `since` not replacing an earlier one) | sharded `$indexStats`: keep the earliest `since` | Was uncovered in the first run; covered by reordering one index's shards in `on a sharded cluster sums sizes and accesses over shards and keeps the earliest since` |
| `packages/backend/src/browse/browse.ts:222, 296, 309` (sort comparator ties, non-Error parse failure) | pre-existing browse behavior, not changed by this task | Out of task scope; not tested here |
| `packages/backend/src/server/backend.ts:35` and two anonymous functions (default logger, missing privileged link) | pre-existing backend wiring, not changed by this task | Out of task scope; the task's changed lines (import, `...indexHandlers(connections)`) are hit |

## Unable to test

- A real sharded cluster for `idx.stats` summing: no sharded fixture is named by the task; covered by
  unit tests with fake per-shard answers only. No follow-up needed for this task's criteria.
- The full integration suite beyond `indexes.int.spec.ts` was not run (other tasks' scope).

## Summary

Tests added and all validation passed. Tests and task-scoped coverage are sufficient; no production
defects found.

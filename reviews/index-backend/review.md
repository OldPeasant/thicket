# Code Review

Date: 2026-11-17

Task: index-backend - M3: Index management backend

Scope: final task code, `git diff 5ae4d005cf68ba0021d0a2f0aee39399dce638f4..782ea95430abf6dc996f877ee92de2f2001a2767`
excluding `tasks/` and `reviews/`. Reviewed revision 782ea95430abf6dc996f877ee92de2f2001a2767.
This is a re-review: since the first review (findings CR-1 P2 missing unit tests, CR-2 P3 duplicated
`isUnauthorized`), the test-writer added `packages/backend/src/indexes/indexes.spec.ts` and
`handlers.spec.ts`, and `docs/ARCHITECTURE.md` gained an "Indexes" bullet. No production code changed
since the first review. Working tree clean; no uncommitted changes reviewed.

Requirements:
- `tasks/index-backend.md` acceptance criteria and recorded assumptions
- `SPEC.md` M3 "Index management"
- `packages/contract/src/idx.ts` (`idx.list`, `idx.stats`, `idx.create`, `idx.drop`, `idx.hide`)
- `docs/ARCHITECTURE.md` (contract, write guard, test layout conventions)
- `AGENTS.md`

Git range:
- Branch: main
- HEAD: 782ea95430abf6dc996f877ee92de2f2001a2767
- Base/start: 5ae4d005cf68ba0021d0a2f0aee39399dce638f4 (`git merge-base HEAD origin/main`)
- Commits reviewed: 5 (af1f624, 4521edb, b959cf5, 3894a9a, 782ea95; b959cf5 touches only `reviews/`)

Summary: 0 P0, 0 P1, 0 P2, 1 P3

## Commands run

- `cd packages/backend && npx vitest run src/indexes` -> 2 files, 76 tests passed.
- `npx vitest run --config test/integration/vitest.config.ts test/integration/indexes.int.spec.ts`
  (container fixtures) -> 1 file, 26 tests passed.
- `npx eslint --max-warnings 0 packages/backend/src/indexes` -> clean.
- `npx prettier --check packages/backend/src/indexes docs/ARCHITECTURE.md` -> all files formatted.
- `cd packages/backend && npm run typecheck` (`tsc -p tsconfig.json`) -> no errors.

## Acceptance criteria

1. Integration tests for each index option and for hide/unhide: met. `test/integration/indexes.int.spec.ts`
   creates compound, unique, sparse, partial, TTL, collation, hidden, text, 2dsphere and wildcard
   indexes through the served, contract-validated, guarded handlers and checks the server's
   `listIndexes` entry and `idx.list`; hide/unhide is checked on the spec, in `idx.list` and in the
   query plan. Observed passing (26/26).
2. Read-only refuses create/drop (int test): met. `idx.create`, `idx.drop`, `idx.hide` answer
   `READ_ONLY` on a read-only profile with and without `confirmed: true`, and the indexes are
   unchanged; the production profile needs `confirmed: true`. Observed passing.

## Status of earlier findings

- CR-1 (P2, missing unit tests for `indexes.ts`, sharded aggregation unverified): resolved.
  `indexes.spec.ts` drives `indexStatistics` with a fake `ClientLike` answering two shard documents
  for `$collStats` and `$indexStats` and asserts summed sizes/accesses and the earliest `since` in
  both orders (`indexes.spec.ts:325`), multi-batch shards via getMore (`:347`), zero/negative/NaN/
  non-numeric sizes (`:362`), indexes only in `$indexStats` (`:379`), the `Unauthorized` fallback by
  code, code name and Int32 code (`:443-488`), and rethrow of other errors (`:490`). `toIndexInfo`,
  `defaultIndexName`, `createIndex` option validation, `dropIndex` `*` refusal and `hideIndex` are
  also covered. I checked each expectation against `indexes.ts`; they assert observable results and
  sent commands rather than internals, and they would fail on the regressions CR-1 named (e.g.
  overwriting instead of summing).
- CR-2 (P3, duplicated `isUnauthorized`): still present; carried forward as CR-1 below.

## Review of the new tests and doc (no finding)

- `handlers.spec.ts` uses a real `ConnectionManager` over a fake client, as `browse/handlers.spec.ts`
  does. It checks the exact handler set, `NOT_CONNECTED` without sending, routing of db/coll/params,
  cancellable reads and non-cancellable writes. The "write with an already aborted signal still
  sends" case matches the established `browse/handlers.spec.ts:225` behavior for guarded writes.
- No test was weakened, skipped or deleted; the only pre-existing spec touched
  (`server/backend.spec.ts`) gains one assertion that `startBackend` serves the `idx.*` handlers.
- `docs/ARCHITECTURE.md:285-290` matches the code: `listIndexes` in server order, `$collStats`
  `indexSizes` plus `$indexStats`, shard summing with earliest `since`, sizes only without the
  `indexStats` privilege, driver default name returned, `*` refused with `INVALID_PARAMS`, `collMod`
  `index.hidden`, writes behind the guard, int test path correct.
- Fixtures use `example.test` hosts and no credentials.

## Other checks (no finding)

- Guard integration: the three writes are `write: 'always'` in the contract; `startBackend` spreads
  `indexHandlers(connections)` among the guarded handlers (`packages/backend/src/server/backend.ts:93`).
- Error mapping through `runCommand`/`runCursor` (`toBrowseError`); empty `$collStats` is `NOT_FOUND`;
  only `Unauthorized` on `$indexStats` is swallowed.
- Contract conformance: `expireAfterSeconds` non-negative integer, `accesses` non-negative integer,
  `sizeBytes` non-negative, `since` ISO; results are parsed by the contract schemas in the unit tests.
- The `browse.ts` change only exports existing `run` (as `runCommand`) and `runCursor`; no behavior change.
- No secrets or credentials in the diff.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | Third copy of `UNAUTHORIZED`/`isUnauthorized`**
    - File: `packages/backend/src/indexes/indexes.ts:17`, `packages/backend/src/indexes/indexes.ts:58`
    - Category: Quality
    - Problem: `UNAUTHORIZED = 13` and `isUnauthorized` (reading `RpcError.detail.serverCode` /
      `codeName`) duplicate `packages/backend/src/docs/query/query.ts` (same constant and helper);
      `browse.ts` holds a further variant for raw driver errors.
    - Why it matters: The rule for recognising a privilege refusal lives in several places; a change
      (another code or code name) must be repeated in each.
    - Suggested fix: Export one helper next to `toBrowseError` in `browse.ts` (which already exports
      `runCommand`/`runCursor` to this module) and use it from `query.ts` and `indexes.ts`. Optional.

## Review conclusion

No material issues found. Both acceptance criteria are met and were observed passing in the
integration suite; the earlier P2 test gap is resolved by the new unit tests (76 passing). The only
remaining item is an optional P3 cleanup.

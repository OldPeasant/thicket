# Code Review

Date: 2026-11-17

Task: index-backend - M3: Index management backend

Scope: committed task changes `git diff 71c78ae..1a57567` (commits 1805029, 1a57567). The branch was
later rebased to HEAD 27c0d2f (task commits e5c306d, 27c0d2f); `git diff 1a57567 27c0d2f` differs
only in `tasks/index-backend.md` (three assumption lines), so the reviewed code is identical at
27c0d2f. Uncommitted files (test-writer work in progress) are not reviewed.

Requirements:
- `tasks/index-backend.md` acceptance criteria and recorded assumptions
- `SPEC.md` M3 "Index management"
- `packages/contract/src/idx.ts` (`idx.list`, `idx.stats`, `idx.create`, `idx.drop`, `idx.hide`)
- `docs/ARCHITECTURE.md` (contract, write guard, test layout conventions)
- `AGENTS.md`

Git range:
- Branch: main
- HEAD: 27c0d2f3e10bd551c7a43101efb4940dfda037f1
- Base/start: 71c78ae8c9e4c27b8027ea70543d78bda7d7e011
- Commits reviewed: 2 (1805029, 1a57567; rebased as e5c306d, 27c0d2f)

Summary: 0 P0, 0 P1, 1 P2, 1 P3

## Commands run

- `npx vitest run --config test/integration/vitest.config.ts test/integration/indexes.int.spec.ts`
  (Podman, 8.x replica set fixture plus an auth-enabled 8.x fixture) -> 1 file, 26 passed.
- `npm run check` -> ran to completion; the final (renderer) step reported 72 files, 2154 tests
  passed. Only the tail of the output was inspected.

## Acceptance criteria

1. Integration tests for each index option and hide/unhide: met. `indexes.int.spec.ts` creates
   compound (mixed directions, default name), unique (custom name, enforcement checked), sparse,
   partial filter, TTL, collation, hidden-at-creation, text (weights, default_language, `$text` use),
   2dsphere (`$near` use) and wildcard (with `wildcardProjection`) indexes through the served,
   contract-validated, guarded handlers and checks the server's `listIndexes` entry and `idx.list`.
   Hide/unhide is checked on the server spec, in `idx.list` and in the query plan
   (COLLSCAN while hidden, IXSCAN after unhide).
2. Read-only refuses create/drop (int test): met. `idx.create`, `idx.drop` and `idx.hide` answer
   `READ_ONLY` on a read-only profile with and without `confirmed: true`, and the server's indexes
   are unchanged. The production profile requires `confirmed: true`.

## Other checks (no finding)

- Guard integration: the three writes are `write: 'always'` in the contract and listed in
  `EXPECTED_WRITES`; `startBackend` adds `indexHandlers` inside `guardWrites`
  (`packages/backend/src/server/backend.ts:54-70`).
- Error mapping: server errors go through `toBrowseError` (`NamespaceNotFound` -> `NOT_FOUND`,
  other server refusals -> `SERVER_ERROR`, messages redacted); a missing collection in `idx.stats`
  (empty `$collStats`) is `NOT_FOUND`. Only `Unauthorized` on `$indexStats` is swallowed; other
  errors are rethrown.
- Contract: `IndexInfo.expireAfterSeconds` is truncated to a non-negative integer and NaN/negative
  values are dropped; `accesses` is a non-negative integer; `since` is ISO. Results are validated
  by `serve` in the integration tests.
- Safety: `idx.drop` refuses `*` (recorded assumption); reads are cancellable via `abortable` and
  `killCursors`, writes run to completion, consistent with the other handler modules.
- Sharded handling: per-shard `$collStats` sizes and `$indexStats` ops are summed and the earliest
  `since` kept (recorded assumption). Logic reads correctly; see CR-1 for the missing test.
- No secrets or credentials in the diff; test passwords are generated with `randomBytes`.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | No unit tests for `indexes.ts`; sharded aggregation in `idx.stats` is unverified**
    - File: `packages/backend/src/indexes/indexes.ts:71`
    - Category: Tests
    - Problem: The task adds no `indexes.spec.ts` or `handlers.spec.ts`, unlike every sibling module
      (`browse/`, `agg/`, `docs/` each have `*.spec.ts` next to the code, as
      `docs/ARCHITECTURE.md:587` asks). The integration tests run only against a single replica set,
      so the multi-document paths of `indexStatistics` (summing `indexSizes` and `accesses.ops`
      over several `$collStats`/`$indexStats` documents, keeping the earliest `since`, ignoring
      non-finite or non-positive sizes, creating entries for indexes present only in `$indexStats`)
      never execute with more than one document. `toIndexInfo` edge cases (NaN/negative/Long TTL,
      non-object partial filter), `defaultIndexName` with Int32/Double/string values, the
      `options.name` validation, and the rethrow of non-`Unauthorized` `$indexStats` errors are
      also untested at unit level.
    - Why it matters: Sharded clusters are the only place the summing logic matters, there is no
      sharded fixture, and a regression there (e.g. overwriting instead of summing) would pass the
      current suite. The `npm run check` gate exercises none of this module.
    - Suggested fix: Add `packages/backend/src/indexes/indexes.spec.ts` with a fake `ClientLike`
      answering two shard documents for `$collStats` and `$indexStats` (different `since` values,
      Long ops, a zero/NaN size), an `Unauthorized` and a non-`Unauthorized` `$indexStats` failure,
      and `toIndexInfo`/`defaultIndexName`/`createIndex` option-validation cases.

## P3 Low

- [ ] **CR-2 | Third copy of `UNAUTHORIZED`/`isUnauthorized`**
    - File: `packages/backend/src/indexes/indexes.ts:17`, `packages/backend/src/indexes/indexes.ts:58`
    - Category: Quality
    - Problem: `UNAUTHORIZED = 13` and `isUnauthorized` (reading `RpcError.detail.serverCode` /
      `codeName`) are a verbatim copy of `packages/backend/src/docs/query/query.ts:38` and `:91`;
      `browse.ts:49`/`:103` holds a third variant for raw driver errors.
    - Why it matters: The "is this a privilege refusal" rule now lives in three places; a change
      (e.g. also treating code 18 or a new code name) must be made in each.
    - Suggested fix: Export one helper next to `toBrowseError` in `browse.ts` (which already
      exports `runCommand`/`runCursor` for this module) and use it from `query.ts` and `indexes.ts`.

## Review conclusion

No material issues found. Both acceptance criteria are met and were observed passing in the
integration suite. CR-1 is a non-blocking test gap that is worth closing (the test-writer can add
the unit spec); CR-2 is optional cleanup.

# Code Review

Date: 2026-11-16

Task: docs-query-backend - M1: Query documents with paging, counts, cancel and slices

Scope: implementation commits cd14a90 and d5ac993 (`git diff fb6e570..d5ac993`), production code at d5ac993 plus `test/integration/docs-query.int.spec.ts`. Uncommitted unit-test changes by the concurrent test-writer (`packages/backend/src/server/rpc.spec.ts`) are not part of this review.

Requirements:
- tasks/docs-query-backend.md (goal, 3 acceptance criteria, recorded assumptions #1-#5)
- SPEC.md (section 4 transport: EJSON, `cancel(id)` kills the server-side operation)
- docs/ARCHITECTURE.md (streams, document reads, fixtures)
- docs/QUALITY.md (report contract)
- packages/contract/src/envelope.ts and conn.ts (event/cancel contract, `conn.close` cancels streams)
- Integration counterparts: packages/renderer/src/app/api/api.service.ts (`ApiService.stream`), apps/desktop/src/preload/bridge.ts (stream owner routing and cancel)

Git range:
- Branch: main
- HEAD: d5ac993
- Base/start: fb6e57008bb6247d6b10de8ee893c0e382df077c
- Commits reviewed: 2

Summary: 0 P0, 0 P1, 2 P2, 5 P3

Checked and found sound: paging via paging-core `findPlan` (range after/before, `fromEnd` with the reversed sort, reversal of backward reads into display order, null/missing sort keys handled by core's `rangeFilter`, `DEFAULT_SORT` for an empty sort, missing sort key in a bound rejected as `INVALID_PARAMS`); lossless EJSON (cursor batches kept raw and decoded without promotion, canonical stringify; filter and bounds parsed non-relaxed); stream lifecycle in `serve()` (response sent before the producer starts, producer never starts for a cancelled or failed request, one terminal event, `CANCELLED` after producer cleanup with a 5 s cap, invalid data ends the stream with `INTERNAL`); integration with the preload `Bridge` (stream owner recorded from the `{ streamId }` response, stream cancel routed to the backend) and `ApiService.stream` (data before `end`/`error`, unsubscribe cancels the stream id). `hint` and `path` cannot inject other command fields (`hint` is a single value field; `path` components starting with `$` are rejected). The integration tests cover all three acceptance criteria; criterion evidence has not been recorded with `tasks.py verify` yet (parent's step).

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | A cancel issued before the server registered the operation leaves the query running and its cursor open**
    - File: `packages/backend/src/docs/query/query.ts:165`
    - Category: Correctness
    - Problem: `Operation.cleanUp` runs `killOperations` exactly once, immediately after the abort, and then waits for the interrupted command at most `CANCEL_SETTLE_MS` (4 s, line 174). If the cancel arrives before the command shows up in `currentOp` (pool checkout, connection establishment/auth, network latency: the command and the `currentOp` probe use different pooled connections), `currentOp` finds nothing and nothing is killed. The command keeps running on the server; if it returns after the 4 s race (e.g. the `$where` sleep query in the integration test needs about 5 s for its first batch), its cursor id is dropped by `Promise.race` and the cursor stays open until the server's idle-cursor timeout. The integration test only cancels after it saw the operation in `currentOp` (`waitFor(... ops.length > 0)`), so this path is untested. In the UI, cancelling a stream right after starting it is a normal pattern (unsubscribe on a new query or page change via `ApiService.stream`).
    - Why it matters: criterion 2 ("the server op is gone") and SPEC section 4 (`cancel(id)` kills the server-side operation) do not hold for early cancels; abandoned slow queries keep consuming server resources and leak cursors.
    - Suggested fix: after an abort, keep watching `pending`: always kill the cursor of a late reply (`pending.then(reply => killCursors(...))`, independent of the 4 s cap, which should only bound how long `close()` waits), and retry `killOperations` a few times (or until `pending` settles) when the first `currentOp` found no operation. Add an integration test that cancels immediately after the `docs.find` response and then checks `currentOp` (including idle cursors) becomes empty.

- [ ] **CR-2 | docs.get with sliceAbove turns an inclusion projection of only the large array into a `$slice`-only projection, which returns the whole document**
    - File: `packages/backend/src/docs/query/query.ts:440`
    - Category: Correctness
    - Problem: for an inclusion projection, an array that is included as a whole is replaced by `{ $slice: sliceAbove }` (line 447). When that array is the only included field (`{"items":1}` or `{"_id":0,"items":1}`), the resulting projection is `{items: {$slice: n}}` (plus `_id: 0`). MongoDB treats a projection that contains only `$slice` (and exclusions) as an exclusion projection and returns every other field. The user's projection is silently lost, and other large fields of a large document travel anyway, defeating the purpose of `sliceAbove`. The local `isInclusion`/`isIncluded`/`relatedPath` (lines 369-380) also duplicate `packages/core/src/paging/projection.ts` with different semantics (e.g. `{_id: 1}` alone is an inclusion in core but not here).
    - Why it matters: `docs.get` returns fields the user excluded, and the large-document protection does not work for this projection shape.
    - Suggested fix: for inclusion projections, keep the field included while slicing, e.g. use the aggregation expression form `items: {$slice: ['$items', n]}` (an expression counts as inclusion), or keep an explicit inclusion marker; reuse a shared projection classifier from `@thicket/core` instead of the local copy. Add a test with `projection: {"items":1}` and `sliceAbove`.

## P3 Low

- [ ] **CR-3 | `conn.close` does not cancel running docs.find streams, although the contract says it does**
    - File: `packages/backend/src/docs/query/handlers.ts:23`
    - Category: Integration
    - Problem: `packages/contract/src/conn.ts:67` documents `conn.close` as "Close the connection of a profile (cancels its streams and shells)". `docs.find` is the first stream bound to a connection, but the stream captures `manager.client(...)` and is not registered with the `ConnectionManager`, so closing the connection makes a running stream fail with whatever error the closed driver client raises instead of `CANCELLED`.
    - Why it matters: the renderer sees an unexpected error instead of a cancellation when the user disconnects during a query.
    - Suggested fix: register stream cancellation with the manager per profile (abort on close), or create a follow-up task for it if this belongs to the conn-manager area.

- [ ] **CR-4 | getSlice silently returns wrong data for paths through arrays or with numeric components**
    - File: `packages/backend/src/docs/query/query.ts:464`
    - Category: Correctness
    - Problem: assumption #5 says array indexes in the path are not supported, but `fieldExpression` accepts them. In an aggregation, `$items.3` (or `$a.b` where `a` is an array of documents) evaluates to an array of the elements' fields, so `$isArray` is true and the call returns `{ items: "[]", total: 0 }` or a slice of the wrong array instead of an error.
    - Why it matters: a wrong result is presented as valid data in the tree view.
    - Suggested fix: reject purely numeric path components with `INVALID_PARAMS`, and document (or check on the server) that intermediate path components must be documents.

- [ ] **CR-5 | fromEnd and before without a limit read and buffer the whole result**
    - File: `packages/backend/src/docs/query/query.ts:320`
    - Category: Quality
    - Problem: the contract allows `fromEnd`/`before` without `limit` (`limit` is optional, line 265 maps it to 0 = no limit). Rows read backwards are collected in memory until the cursor is exhausted (lines 323 and 328) before anything is sent, so a missing limit loads the entire (filtered) collection into the backend process and sends it in one go at the end.
    - Why it matters: memory spike and no streaming for a request shape the contract accepts.
    - Suggested fix: require `limit` with `fromEnd`/`before` in the contract refinements (or in `buildFind`), since a "last page" or "previous page" without a page size has no meaning.

- [ ] **CR-6 | docs.get and docs.getSlice match the id with implicit equality**
    - File: `packages/backend/src/docs/query/query.ts:450`
    - Category: Correctness
    - Problem: the filters `{ _id: id }` (lines 403, 450, 493) take the parsed EJSON value as is. An `id` such as `{"$ne":null}` becomes a query operator and matches an arbitrary document instead of being rejected or compared literally.
    - Why it matters: low impact for reads (the user reads their own database), but the same pattern copied into the coming write methods would update or delete an arbitrary document.
    - Suggested fix: use `{ _id: { $eq: id } }` in the three filters.

- [ ] **CR-7 | Streams still send events after `serve()` was stopped**
    - File: `packages/backend/src/server/rpc.ts:303`
    - Category: Quality
    - Problem: the stop function aborts running streams and clears the map, but each stream's `finish` (line 136) is not marked over, so when a producer settles (or the grace timer from `cancelStream` fires) it still calls `port.send`. Requests behave differently: after stop, `answer` drops their responses.
    - Why it matters: inconsistent lifecycle; sends on a closed port and timers outliving the server.
    - Suggested fix: on stop, mark every running stream as finished without sending (e.g. a `stopped` flag checked in `finish`).

## Review conclusion

Material issues found; fix before completing the task.

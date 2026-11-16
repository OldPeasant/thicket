# Code Review

Date: 2026-11-16

Task: docs-query-backend - M1: Query documents with paging, counts, cancel and slices

Scope: round 2, the whole task implementation on the final code, `git diff 8afb705..7ee7b7e` (production code, contract, core projection export, integration and unit tests, ARCHITECTURE notes). The branch was rewritten during the review (0216b68 -> 7ee7b7e, two `assume:` commits inserted). `git diff 0216b68 7ee7b7e` only adds two assumption lines to `tasks/docs-query-backend.md`, so the reviewed code is the same. Uncommitted test changes by the concurrent test-writer are not part of this review. This round also checks that round-1 findings CR-1 to CR-7 are resolved (fixes in commits 3fb3177 and 7ee7b7e; `fixes.md` refers to the first one by its pre-rebase hash 36d33f5).

Requirements:
- tasks/docs-query-backend.md (goal, 3 acceptance criteria, recorded assumptions including the two added for CR-3 and CR-5)
- SPEC.md (section 4: transport, `cancel(id)` kills the server-side operation; large documents loaded with `$slice`)
- docs/ARCHITECTURE.md (streams, document reads)
- AGENTS.md, docs/QUALITY.md (report contract)
- packages/contract/src/docs.ts and conn.ts (`conn.close` cancels the profile's streams)
- Round 1: reviews/docs-query-backend/review.md (previous version of this file), reviews/docs-query-backend/fixes.md

Git range:
- Branch: main
- HEAD: 7ee7b7e0da749cf2a7d10933f837a177fbd97c1e
- Base/start: 8afb705ebb60f27c7a261277d4ba56ecdbde88d7
- Commits reviewed: 7 (5 implementation, test and fix commits, plus 2 `assume:` commits)

Summary: 0 P0, 0 P1, 0 P2, 2 P3

## Round-1 findings

- CR-1 (early cancel left the op and cursor behind): resolved. `Operation.cleanUp` (`query.ts:179-197`) probes `currentOp` every 100 ms until it finds the op, the command settles or 4 s pass. A late reply's cursor is always killed (`pending.then(... killCursorId)`). The loop cannot spin after the command settled. `late` never rejects, so `close()` cannot fail because of it. The 4 s cap stays below `STREAM_CANCEL_GRACE_MS` (5 s), so `CANCELLED` still follows the cleanup. Unit tests cover the retry and late-reply cases. An integration test cancels right after the response and checks `currentOp` with idle cursors.
- CR-2 (inclusion projection turned into a `$slice`-only projection): resolved. Inclusion projections get the `$cond`/`$slice` expression (`query.ts:411-415`), which keeps the projection an inclusion. The local classifier was replaced by core's exported `isInclusion`/`isIncluded`. `{_id: 1}` alone, `{_id: 0}` alone, a user `$slice` and sub-path entries are handled. Unit and integration tests cover them.
- CR-3 (`conn.close` did not end the stream with `CANCELLED`): resolved as recorded in the assumption (`handlers.ts:36-46`). See CR-2 below for a remaining limitation.
- CR-4 (wrong data for paths through arrays): resolved. The server-side parent `$type == 'object'` check (`query.ts:531-562`) makes paths through arrays `NOT_FOUND`. The numeric-component refusal added with it is broader than needed (CR-1 below).
- CR-5 (before/fromEnd without limit buffered everything): resolved. `buildFind` refuses it with `INVALID_PARAMS` (`query.ts:270-273`). The contract comments and an assumption record it. The renderer does not use these params yet.
- CR-6 (implicit `_id` equality): resolved. All three filters use `idFilter` (`{_id: {$eq: id}}`).
- CR-7 (streams sent events after stop): resolved. `drop()` marks the stream over and clears its grace timer (`rpc.ts:113-163`). `answer` after stop aborts pending streams without starting them.

Also checked again and found sound: paging through `findPlan` (after, before, fromEnd, reversal into display order, `DEFAULT_SORT`, missing bound keys); lossless EJSON; the stream lifecycle in `serve()` (one terminal event, invalid data gives `INTERNAL`, a failed or cancelled request never starts its stream); and count, estimatedCount and the handlers' `abortable` wrapping. The integration tests address all three acceptance criteria: 10 000 docs in range and skip mode, forward, backward from the last page and a middle jump, each compared with a plain sorted find; a `$where` sleep cancel with a `currentOp` check; and getSlice on a 50 000-item array with an asserted response size. `python tasks.py verify docs-query-backend` still shows all three criteria unrecorded. Recording them is the parent's next step, so this is not a finding.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | getSlice refuses valid paths through documents with numeric field names**
    - File: `packages/backend/src/docs/query/query.ts:507`
    - Category: Correctness
    - Problem: the CR-4 fix refuses every purely numeric path component with `INVALID_PARAMS`. The same fix also checks on the server that every parent is a document (`$type` equals `object`), so a numeric component after a document parent is just a field name in an aggregation path. Only a numeric component after an array parent would be read as an index, and that is already `NOT_FOUND`. As a result, a large array in a document keyed by numbers, such as `{byYear: {"2024": [...50 000 items]}}` with path `byYear.2024`, or a top-level field named `"0"`, cannot be loaded with getSlice, although the result would be correct.
    - Why it matters: large arrays under numeric keys (maps keyed by year, id or index) are a common document shape, and the tree view cannot page them.
    - Suggested fix: drop the `/^\d+$/` test from `pathParts` and keep the server-side parent check. Alternatively, refuse a numeric component only when the client means an array index, which the contract cannot express today. Update the `items.3` / `0` / `a.10.b` unit and integration expectations: `items.3` over an array is then `NOT_FOUND` through the parent check.

- [ ] **CR-2 | A docs.find stream ended by conn.close leaves its server operation running**
    - File: `packages/backend/src/docs/query/handlers.ts:39`
    - Category: Correctness
    - Problem: the stream now ends with `CANCELLED` when its connection is closed, but no `killOp` runs. `ConnectionManager.close` (`connections/manager.ts:220-226`) closes the client first, so `Operation`'s cleanup has no client left to kill the operation with. The integration test says so itself ("the closed client cannot kill its own operation on the server") and uses a separate collection for that reason. A long query (large sort, `$where`) keeps running on the server after the user disconnected. SPEC section 4 says a cancel kills the server-side operation, and `conn.close` is documented as cancelling the profile's streams.
    - Why it matters: abandoned queries keep using server resources after a disconnect. The impact is limited because the server ends the op when it notices the closed socket or at `maxTimeMS`.
    - Suggested fix: let the `ConnectionManager` abort the profile's running streams (e.g. a per-profile abort signal or registered cancel callbacks) and wait briefly for their cleanup before it closes the client. A follow-up task in the conn-manager area is also fine, since the recorded CR-3 assumption chose the narrower approach on purpose.

## Review conclusion

No material issues found. All round-1 findings are resolved, and the two remaining P3 findings do not block the task. The acceptance criteria evidence still has to be recorded with `tasks.py verify`, and `quality.json` should reference the rewritten commit hashes (HEAD 7ee7b7e, not 0216b68 / 36d33f5).

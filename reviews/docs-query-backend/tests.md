# Test Report

Date: 2026-11-16

Task: docs-query-backend - M1: Query documents with paging, counts, cancel and slices

Scope: `git diff fb6e57008bb6247d6b10de8ee893c0e382df077c..d5ac993a4161f434fe7bd077bc0d6736f71c768c` (branch `main`, HEAD d5ac993a4161f434fe7bd077bc0d6736f71c768c; task commits cd14a90 and d5ac993, as given by the parent worker and matching `git log fb6e570..HEAD`). Uncommitted at measurement time: only the test files listed below (no production changes).

Requirements:
- `tasks/docs-query-backend.md` acceptance criteria and recorded assumptions (fromEnd flag, projection widening, stream support in `serve()`, cancel by comment + killOp, sliceAbove/getSlice path rules)
- `SPEC.md` (streams + `cancel(id)` kills the server operation with killCursors/killOp; `$slice` loading of large documents; canonical EJSON)
- `docs/ARCHITECTURE.md` "Coverage"; `docs/QUALITY.md`
- Doc comments of `serve()`/`StreamProducer`/`HandlerContext.openStream` in `packages/backend/src/server/rpc.ts` and of `packages/backend/src/docs/query/query.ts`
- Parent worker's list of behaviors to unit test

## Test files changed

- `packages/backend/src/server/rpc.spec.ts` (new `describe('serve: streams')`, 16 tests)
- `packages/backend/src/docs/query/query.spec.ts` (new, 78 tests)
- `packages/backend/src/docs/query/handlers.spec.ts` (new, 18 tests)
- `packages/backend/src/server/backend.spec.ts` (1 test: docs handlers registered and unguarded)
- `test/integration/docs-query.int.spec.ts`: not changed (no real gap found; see "Unable to test")

## Tests added or updated

Count: 113 (16 + 78 + 18 + 1); no existing test was changed, weakened or skipped.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: 10 000-doc fixture paged forward/backward/last in range and skip mode equals a plain sorted find | `docs-query.int.spec.ts` "docs.find paging in range/skip mode" (parent's tests, run unchanged) | `npm run test:int -- docs-query` (8.x replica-set container via Podman) | Pass (26/26) |
| AC1 unit level: buildFind after/before/fromEnd (reversed sort, range filter, reverse flag), default `{_id:1}` sort, skip, limit/batchSize/collation/hint/maxTimeMS pass-through | `query.spec.ts` "buildFind" (after/before/fromEnd/range without sort/fromEnd false/passes ... through/index-name hint) | `cd packages/backend && npx vitest run src/docs/query` | Pass |
| Opaque sort: refused for after/before/fromEnd, sent as-is in skip mode; bound missing a sort key refused | `refuses %s with an opaque sort`, `sends an opaque sort as given with skip paging...`, `refuses a %s bound that lacks a sort key`, `a bound for the default sort must carry _id` | same | Pass |
| Projection widening (assumption) | `projection widening` (5 tests: inclusion, exclusion, only sort keys excluded, skip mode, no sort / empty projection) | same | Pass |
| streamFind: batching into events, getMore loop with one comment, reversal of backward reads, server errors, killCursors on failure | `streamFind` describe (11 tests) | same | Pass |
| AC2: cancelling a slow query ends CANCELLED and the server op is gone (currentOp) | `docs-query.int.spec.ts` "cancel" (3 tests) | `npm run test:int -- docs-query` | Pass |
| AC2 unit level: killOp by comment (incl. `$ownOps` fallback, failures ignored), killCursors once the cursor id is known, settle timeout, abort between batches | `Operation cancel` describe (12 tests); `handlers.spec.ts` "a stream cancel kills the server operation before CANCELLED is sent" | `npx vitest run src/docs/query` | Pass |
| serve() streams: response before events, data/end, delivered fallback, RpcError vs INTERNAL (reported), schema-invalid data, cancel waits for producer then CANCELLED, grace timeout (`STREAM_CANCEL_GRACE_MS`), stream never starts when request fails or is cancelled, cancel isolation, stop() aborts | `rpc.spec.ts` "serve: streams" (15 passing tests) | `npx vitest run src/server/rpc.spec.ts` | Pass |
| serve() stop(): no more stream events after stop | `serve: streams > stop() stops sending stream events, also when the producer settles later` | same | Fail: TW-1 |
| count / estimatedCount | `countDocuments` (5), `estimatedCount` (2), handler tests | `npx vitest run src/docs/query` | Pass |
| docs.get slicing rules (no sliceAbove, unknown id, sizes on server, exclusion/inclusion projections, user `$slice`, `_id: 0` only, field no longer array, malformed sizes, abort) | `getDocument` describe (13 tests) | same | Pass |
| AC3: getSlice items n..m of a 50 000-item array without sending the whole document (response size) | `docs-query.int.spec.ts` "docs.get and docs.getSlice on a 50 000-item array" | `npm run test:int -- docs-query` | Pass |
| getSlice unit level: pipeline, dotted paths, invalid paths refused before sending, NOT_FOUND (no doc / no array), invalid id, abort | `getSlice` describe (11 tests) | `npx vitest run src/docs/query` | Pass |
| Handlers: exactly five methods, NOT_CONNECTED, INVALID_PARAMS before a stream exists, needs a streaming server, CANCELLED on request cancel, served through `serve()` with contract validation (fromEnd + skip refused) | `handlers.spec.ts` (18 tests); `backend.spec.ts` "serves the docs.* query handlers, unguarded on a read-only profile" | `npx vitest run src/docs/query src/server/backend.spec.ts` | Pass |

## Focused test execution

Command:

`cd packages/backend && npx vitest run src/docs/query src/server/rpc.spec.ts src/server/backend.spec.ts`

Result:

Fail: 157 passed, 1 failed (TW-1, `rpc.spec.ts:588`). Every other new test passes.

## Full test execution

Command:

`npm run check` (lint + typecheck + `vitest run` + renderer tests)

Result:

Fail: lint and typecheck pass; `vitest run` gives 2797 passed, 1 failed (TW-1), 46 files. The renderer tests (`npm run test -w packages/renderer`) did not run because the `&&` chain stops at the failure.

Also run: `npm run test:int -- docs-query`, Pass (1 file, 26 tests, about 11.5 s, Podman containers).

## .taskcheck

Result:

Fail (it runs `npm run check`; see above). The only cause is TW-1.

## Bugs found

### serve(): a stream whose producer settles after stop() still sends a CANCELLED error event

Finding ID:

`TW-1`

Test:

`packages/backend/src/server/rpc.spec.ts` > `serve: streams` > `stop() stops sending stream events, also when the producer settles later`

Production source:

`packages/backend/src/server/rpc.ts:307` (stop() aborts and clears `streams` but leaves each stream's `finish` closure live) and `rpc.ts:136-140` (`finish` sends on the port without checking whether serving stopped)

Requirement:

`serve()` doc: "Returns a function that stops serving and aborts every running request and stream". The existing request behavior (`stop() aborts running requests and stops answering`: nothing is sent after stop) gives the same rule.

Expected behavior:

After `stop()`, no further messages for a running stream are sent on the port, also when the aborted producer settles later.

Actual behavior:

When the producer settles after `stop()`, `settle()` sees the aborted signal and calls `finish()`, which sends `{ stream, kind: 'error', payload: { code: 'CANCELLED', ... } }` on the stopped port. Requests in the same situation send nothing.

Severity:

Low. In the backend, `stop()` runs when the renderer port closes, and posting to a closed `MessagePortMain` is most likely dropped. The behavior is still inconsistent with requests, and a stopped server keeps writing to its port.

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.`

## Coverage

Status: verified, with one disclosed deselection. Vitest writes no coverage report when a test fails (`reportOnFailure` is off), so the final coverage run deselected only the TW-1 test with a name filter. That test still runs and fails in the focused and full runs above.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured. The configured tooling has no changed-line mode.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `docs-query-backend`; base fb6e57008bb6247d6b10de8ee893c0e382df077c; HEAD d5ac993a4161f434fe7bd077bc0d6736f71c768c; task commits cd14a90 and d5ac993 from the parent worker, which match `git diff --stat fb6e570..HEAD`.
- Source/test snapshot identifier (including uncommitted inputs), sha256, taken before and after the final run and identical:
  - `packages/backend/src/server/rpc.ts` 38d04335041afe4b4db45963195b2655aad0dc6aac4e5fc661a6d6e4e61b6b39
  - `packages/backend/src/docs/query/query.ts` 1332d3ea88248ad9700774647a277d2b5e16e47cd852c02a4658614abeaa957a
  - `packages/backend/src/docs/query/handlers.ts` 737724813c06c038db7762a20731e7bb8ff9ad9f2b2c8af64602aa7265a84e10
  - `packages/backend/src/docs/query/index.ts` 72ac4d32acd07ec9857250e0a204f3a0462320946f32ea1190ce531539c4b0b1
  - `packages/backend/src/server/backend.ts` 9b6672fc52b2d3d5c798472d853620b67fa999aab04373dcc6ab1ca0be6d0c96
  - `packages/backend/src/index.ts` e7f76183ebeea8436dbffcb513ae659985ff6aace2800f581ac7ba0b3ea1a566
  - `packages/backend/src/browse/browse.ts` 9ed0914a91cea196c63d703413623911163816086bd302f1b80377bc7f0d4f44
  - `packages/contract/src/docs.ts` 5d037cd9187b9563d3d5ee99c8ace318093d7e293cf55b7ad45f55d8ae870350
  - `packages/backend/src/server/rpc.spec.ts` 9681953ac2ed81fa66bcfda65d02ca53e091c3dac7152e886bae20f732636c6f
  - `packages/backend/src/server/backend.spec.ts` 65a3310fda166a39f0cf770ae05bfa6960d830a373b8e7d3896bf2c2f4a62e18
  - `packages/backend/src/docs/query/handlers.spec.ts` 0aacb25ac2d130814910e440bea930956e75c901b5796476d181c8e5921b094e
  - `packages/backend/src/docs/query/query.spec.ts` 83bd3372941c72c811daa3805400fa41c6ff0af712e7ec454c2a8ab685d68336
- Exact included files: `packages/backend/src/server/rpc.ts`, `packages/backend/src/docs/query/query.ts`, `packages/backend/src/docs/query/handlers.ts`, `packages/backend/src/docs/query/index.ts`, `packages/backend/src/server/backend.ts`, `packages/backend/src/index.ts`, `packages/backend/src/browse/browse.ts` (only `export` keywords were added; measured anyway), `packages/contract/src/docs.ts`. Excluded: `docs/ARCHITECTURE.md` (documentation), `packages/contract/src/index.spec.ts` and `test/integration/docs-query.int.spec.ts` (tests). No renamed or deleted files.
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8` 5.1.0, Vitest 5.1.0. In `packages/backend`: `npx vitest run --coverage --coverage.include='src/server/rpc.ts' --coverage.include='src/docs/query/query.ts' --coverage.include='src/docs/query/handlers.ts' --coverage.include='src/docs/query/index.ts' --coverage.include='src/server/backend.ts' --coverage.include='src/index.ts' --coverage.include='src/browse/browse.ts' -t '^(?!.*stop\(\) stops sending stream events).*$'` (whole backend unit suite except the TW-1 test). In `packages/contract`: `npx vitest run --coverage --coverage.include='src/docs.ts'` (whole contract suite).
- Run start/completion time and exit status: backend run started 2026-11-16 22:27:33 +0100, report written 22:27:36 +0100, 12 files, 492 passed, 1 deselected, exit 0. Contract run at about 22:25 +0100, all passed, exit 0.
- Generated report paths and report hashes/run identifier: `packages/backend/coverage/coverage-summary.json` (sha256 d9eb06a5fbe42ac0fc2669e47c888b60a37415a532517b2d1ed4c7284fe0b8b5), `packages/backend/coverage/lcov.info` (sha256 2b89614a381fb229fe6d7d93e4eb546967512065543cc023e452381cb827dc52); `packages/contract/coverage/coverage-summary.json` (sha256 62fbb664c1128ce7ceb3ae75231385b1436d2cf45961489b06decc83646b8c4c). Git-ignored.
- Evidence outputs are fresh and inputs stayed unchanged: yes. The reports were regenerated by these runs (the file times match the run times), and the input hashes were identical before and after.
- Final run after latest test additions and production fixes: yes for the latest test additions. No production fixes have been made yet; if TW-1 is fixed, rpc.ts coverage must be measured again.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/docs/query/query.ts` | 224/224 (100%) | 173/174 (99.42%) | 43/43 (100%) | 190/190 (100%) |
| `packages/backend/src/docs/query/handlers.ts` | 13/13 (100%) | 2/2 (100%) | 8/8 (100%) | 11/11 (100%) |
| `packages/backend/src/docs/query/index.ts` | N/A (0/0) | N/A (0/0) | N/A (0/0) | N/A (0/0) |
| `packages/backend/src/server/rpc.ts` | 165/166 (99.39%) | 79/82 (96.34%) | 31/32 (96.87%) | 144/144 (100%) |
| `packages/backend/src/server/backend.ts` | 29/31 (93.54%) | 9/10 (90%) | 9/11 (81.81%) | 27/27 (100%) |
| `packages/backend/src/index.ts` | 1/1 (100%) | N/A (0/0) | N/A (0/0) | 1/1 (100%) |
| `packages/backend/src/browse/browse.ts` | 170/170 (100%) | 128/131 (97.7%) | 34/34 (100%) | 140/140 (100%) |
| `packages/contract/src/docs.ts` | 9/9 (100%) | 9/9 (100%) | 3/3 (100%) | 9/9 (100%) |
| Aggregate (summed counters, all 8 files) | 611/614 (99.51%) | 400/408 (98.04%) | 128/131 (97.71%) | 522/522 (100%) |

All scoped files were measured. None is missing or excluded from the aggregate.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `query.ts:197` (cursor still open after a getMore) | Multi-batch streaming (3+ batches) | Test added: `keeps calling getMore while the cursor stays open` (now covered) |
| `query.ts:351`, `:430`, `:513` (`?? 0` / `?? []` fallbacks) | Malformed server replies | Tests added: `a group without a numeric n counts 0`, `a size reply without arrays slices nothing`, `missing items or total give an empty array and 0` (now covered) |
| `query.ts:50` branch (non-Error thrown by EJSON.parse) | Defensive message formatting | Not covered: the bson parser throws only Error instances |
| `rpc.ts:129` branch + function (default `onError`) | Logging fallback | Not covered by unit tests (all pass `onError`); the integration test serves without `onError`. Trivial |
| `rpc.ts:133` branch (method not in table in `startStream`) | Unreachable: only validated methods reach a handler | Justified gap |
| `rpc.ts:160` branch (method without a `stream` schema) | A non-streaming method opening a stream; data passed unvalidated | Defensive; no contract method does this. Justified gap |
| `rpc.ts` stop()-after-settle path | TW-1 | Exercised by the TW-1 test, which was deselected from the coverage run; reported as TW-1 |
| `backend.ts:31` branch, 2 functions (`log` default, privileged-link callbacks) | Code older than this task (the task added 2 wiring lines) | Out of task scope; task wiring covered by the new backend.spec test |
| `browse.ts:219`, `:293`, `:306` branches | Code older than this task (the task only added `export`) | Out of task scope |

## Unable to test

- getSlice paths that go through an array (for example `items.n`, where `items` is an array of documents, or `items.3`): the code accepts them. On the server, `$items.n` evaluates to an array of the elements' `n` values, so the call probably returns those values instead of `NOT_FOUND`. A fake client cannot show this, and I did not add an integration test, because the recorded assumption explicitly leaves array indexes in paths unsupported and the UI only requests paths of arrays it displays. Follow-up is optional: the parent may decide whether such paths should be refused (INVALID_PARAMS) or documented.
- AWS/Atlas-specific behavior: not relevant to this task.

## Summary

Tests added; production defects were discovered and must be passed to the `fixer` before task completion. One Low-severity defect (TW-1: `serve()` still sends a stream's CANCELLED event after `stop()`) makes `npm run check` and `.taskcheck` fail until it is fixed. All other new unit tests and the existing integration test (26/26) pass. Task-scoped coverage is 99.5% statements and 98.0% branches; the remaining gaps are justified above.

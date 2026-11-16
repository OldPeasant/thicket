# Code Review

Date: 2026-11-16

Task: browse-backend - M1: Databases and collections (db.*, coll.*)

Scope: round 2. Task commits 5a9cfcd (implementation), 8dfb6f9 (test-writer tests, round-1 reports) and 101d24f (fixes for round-1 CR-1..CR-6 and TW-1) on top of base d61f0bc (`git diff d61f0bc..101d24f`, restricted to the task's files: packages/backend/src/browse/*, packages/backend/src/connections/manager.ts, packages/backend/src/server/backend.ts, packages/backend/src/index.ts, test/integration/browse.int.spec.ts, test/integration/fixtures/mongo.ts). The range also contains app-layout/safety-ui commits merged from main; those are not part of this review. The local HEAD d7823d1 is a rebased copy of 101d24f with identical content for packages/ and test/ (`git diff 101d24f d7823d1 -- packages test` is empty). Uncommitted spec edits by a concurrent test-writer are not reviewed. Known/accepted and not reported: the shared `serve()` in rpc.ts answers CANCELLED immediately for a cancelled write (recorded assumption); coll.validator.* belongs to the validator task.

Requirements:
- tasks/browse-backend.md acceptance criteria and recorded assumptions
- SPEC.md section 4 (canonical EJSON v2, lossless; stable error codes)
- docs/ARCHITECTURE.md, AGENTS.md, docs/QUALITY.md
- packages/contract/src/db.ts, coll.ts (raw fields are `ejsonDocument`)
- Round-1 review (CR-1..CR-6) and reviews/browse-backend/fixes.md

Git range:
- Branch: main
- HEAD: 101d24facc5426b495450d4f811d22bceebb0a08
- Base/start: d61f0bc2c23cb4e70d20ea8ce55abb5784358fcb
- Commits reviewed: 3 (5a9cfcd, 8dfb6f9, 101d24f)

Summary: 0 P0, 0 P1, 1 P2, 1 P3

Verification performed by the reviewer: static review of the committed code and tests; the driver/BSON behaviour was checked in node_modules (bson/lib/bson.cjs EJSON number serialisation at lines 4492-4501; mongodb/lib/cmap/connection.js builds `MongoServerError` from `document.toObject(bsonOptions)`). Tests were not re-run by the reviewer in this round; the fixer reports `npx vitest run --project backend` 338 passed, `npm run test:int -- browse` 26 passed, `npm run check` passed.

Round-1 findings:
- CR-1 (server errors classified by message text as TLS_ERROR/TIMEOUT): resolved. `toBrowseError` (browse.ts:60-81) answers any error carrying a server code, code name or `MongoServerError` name as NOT_FOUND/SERVER_ERROR without looking at the text; only errors without a server answer reach `toConnectError`. Unit tests with "certificates", "TLS", "timed out", "SSL handshake" messages exist (browse.spec.ts:100 ff.).
- CR-2 (`MongoServerError.code` became Int32, no `serverCode`): resolved. `RAW` (browse.ts:21-25) no longer sets `promoteValues: false`; codes are additionally read via `toNumber`. The int tests now assert `detail` equals `{ serverCode: 48, codeName: 'NamespaceExists' }` and `{ serverCode: 13, codeName: 'Unauthorized' }`. The fix introduces a new regression, see CR-1 below.
- CR-3 (cancelled writes answered CANCELLED by the handler): resolved at the handler level. db.create/drop and coll.create/drop/rename no longer use `abortable` (handlers.ts:31-44); handler tests show a cancelled write waits for and returns the server's answer. The remaining transport-level behaviour of `serve()` is a recorded, accepted assumption.
- CR-4 (listDatabases fallback paths untested): resolved. browse.spec.ts covers the privilege merge, `db: ""` exclusion, the Unauthorized fallback (by code and code name), connectionStatus failure, and both failing (browse.spec.ts:346); the auth int test covers an authorized database without data.
- CR-5 (empty list instead of the error): resolved. browse.ts:189-196 rethrows the original refusal when listDatabases was Unauthorized and connectionStatus fails.
- CR-6 (connect-time message prefixes): resolved. Server errors use "The server refused the command", unclassified errors "Unexpected error while browsing"; non-RpcErrors thrown outside `run()` reach `serve()`'s generic "Unexpected error: ..." which no longer mentions connecting.
- TW-1 (EJSON value wrappers accepted as create options): resolved. `parseCreateOptions` (browse.ts:288-297) accepts only plain objects without `_bsontype`.

Acceptance criteria: AC1 (int tests for each method on the 8.x replica set), AC2 (drop/rename refused on a read-only profile) and AC3 (listing for a user with only `read` on one database, on the dedicated auth fixture per the recorded assumption) remain covered by test/integration/browse.int.spec.ts; the fix commit did not weaken those tests.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | `raw` outputs are no longer lossless: every Double is promoted to a JS number and re-serialised as `$numberInt`/`$numberLong` when integral**
    - File: `packages/backend/src/browse/browse.ts:21-25` (used by `canonical()` at `:104-106` for db.stats, coll.list and coll.stats `raw`)
    - Category: Integration
    - Problem: the CR-2 fix dropped `promoteValues: false`, so Double (and Int32) values come back as plain JS numbers. `BSON.EJSON.stringify(..., { relaxed: false })` then writes an integral number as `{"$numberInt": ...}` if it fits in 32 bits and as `{"$numberLong": ...}` otherwise (node_modules/bson/lib/bson.cjs:4492-4501); only non-integral values stay `$numberDouble`. Concretely, dbStats on 8.x reports `dataSize`, `storageSize`, `indexSize`, `totalSize`, `fsUsedSize`, `fsTotalSize` as Doubles, which now appear in `raw` as Int32/Int64; in `coll.list`, user data inside `options` (a view `pipeline` such as `{ $match: { x: 1.0 } }`, a `validator` with `minimum: 5.0`) changes type the same way. The module doc comment (browse.ts:11-12) and recorded assumption #5 still describe the raw documents as lossless. No test asserts a Double in `raw`, so this is not detected.
    - Why it matters: SPEC section 4 requires documents to travel as canonical EJSON v2 text, lossless, and the contract types these `raw` fields as EJSON documents. A renderer that shows or copies the listCollections entry (e.g. a view pipeline or validator) presents wrong BSON types, and anything that reuses that text would write Int32/Int64 where the server held Double.
    - Suggested fix: keep the error path on promoted values (as now) but obtain the `raw` documents without value promotion, e.g. run the commands whose output is returned as `raw` with options that preserve Int32/Double (`promoteValues: false`) while still reading the error code with `toNumber` and confirming the driver's SDAM error handling is unaffected for those commands, or request the response unpromoted only for the raw part (for instance a `raw: true` buffer decoded with `BSON.deserialize(..., { promoteValues: false, promoteLongs: false })`, after checking the driver's error construction for that option). Add a unit test with a Double such as `1.0` in a dbStats answer and a listCollections `options.pipeline`, and an int test that a view created with `{ $match: { x: 1.0 } }` lists its pipeline with `$numberDouble`. If the lossy behaviour is accepted instead, record it as an assumption and correct the doc comment.

## P3 Low

- [ ] **CR-2 | Recorded assumption #5 and the module comment no longer match the code**
    - File: `tasks/browse-backend.md` (assumption dated 2026-11-16 21:32, "passed RAW: no BSON promotion"); `packages/backend/src/browse/browse.ts:11-12`
    - Category: Quality
    - Problem: the assumption says commands are run with no BSON promotion so raw outputs are lossless canonical EJSON; since 101d24f, Int32/Double are promoted (browse.ts:16-20 says so). The module comment still claims lossless raw documents for Int64 only, which is accurate but silent on the Double change.
    - Why it matters: humans review assumptions to confirm decisions; the recorded one describes behaviour that no longer exists and hides the trade-off made in CR-2's fix.
    - Suggested fix: once CR-1 is decided, record an updated assumption (the parent worker owns `tasks.py assume`) and align the comment.

## Review conclusion

Material issues found; fix before completing the task.

All round-1 findings (CR-1..CR-6) and TW-1 are resolved in 101d24f, and the acceptance criteria remain covered. The CR-2 fix trades the error-code problem for a loss of BSON type fidelity in the `raw` outputs, which conflicts with SPEC section 4's lossless EJSON rule; fix it or explicitly accept and record it. No security issues found: writes still pass through `guardWrites` in `startBackend`, error messages are masked with `redact`, and test credentials are generated at run time.

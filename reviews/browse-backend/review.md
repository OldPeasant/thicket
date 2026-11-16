# Code Review

Date: 2026-11-16

Task: browse-backend - M1: Databases and collections (db.*, coll.*)

Scope: round 3. Task commits 871f350..fc9f289 on `main`: a2f4db9 (implementation), 1280719 (round-1 tests and reports), 1fae938 (round-1 fixes), bbd72ba (round-2 tests and reports), cce0dff (fix for round-2 CR-1: cursor batches kept as BSON bytes with `fieldsAsRaw` and decoded with `promoteValues: false`), fc9f289 (round-3 tests and test report). The focus of this round is cce0dff and fc9f289; the full task diff was re-read for the final state of packages/backend/src/browse/*, packages/backend/src/connections/manager.ts, packages/backend/src/server/backend.ts, packages/backend/src/index.ts, test/integration/browse.int.spec.ts and test/integration/fixtures/mongo.ts. The working tree was clean at the start of the review. Known and accepted, so not reported: the shared `serve()` answers CANCELLED at once for a cancelled write (recorded assumption), and coll.validator.* belongs to the validator task.

Requirements:
- tasks/browse-backend.md acceptance criteria and recorded assumptions (including the 21:54 correction note)
- SPEC.md section 4 (canonical EJSON v2, lossless; stable error codes)
- docs/ARCHITECTURE.md, AGENTS.md
- Round-2 review (CR-1 lossy raw Doubles, CR-2 stale assumption/comment) and reviews/browse-backend/tests.md (round 3)

Git range:
- Branch: main
- HEAD: fc9f289d4375d5e75210bed0b309c4b05220f82b
- Base/start: 871f3501b68cc5de83bf72feaa534c4b448ebb80
- Commits reviewed: 6

Summary: 0 P0, 0 P1, 0 P2, 0 P3

Verification performed by the reviewer: a static review of the committed code and tests. The reviewer checked how bson handles `fieldsAsRaw` in node_modules/bson/lib/bson.cjs (line 3565: an array named in `fieldsAsRaw` is decoded with `raw: true`, so each batch element is returned as a byte slice). The reviewer did not re-run the tests. The test-writer reports `npx vitest run src/browse` 126 passed, `npm run test:int -- browse` 30/30 passed, and `npm run check` passed (reviews/browse-backend/tests.md).

Round-2 findings:
- CR-1 (raw outputs lost Double types): resolved for the cursor outputs. `RAW` (browse.ts:24-29) keeps the driver's default value promotion, so `MongoServerError.code` stays numeric. It adds `fieldsAsRaw: { firstBatch, nextBatch }`, and `decodeBatch` (browse.ts:40-45) decodes each batch document with `DECODE` (`promoteValues: false`, `promoteLongs: false`, `bsonRegExp: true`). Both the first batch and getMore batches go through `decodeBatch` (browse.ts:147, 156). The cursor id is not inside a raw field, so it stays a `Long` and is passed to getMore and killCursors unchanged. Size reads in coll.stats use `toNumber`, which accepts Int32, Double, Long and Decimal128 (browse.ts:109-116), so the unpromoted values do not break the numeric results. The tests cover this. Unit tests feed BSON bytes and check byte-exact round trips for validators, getMore batches, sharded stats, and a Uint8Array view with an offset. Integration tests check a view pipeline with a Double, an Int64 and an Int32, a validator with an Int64 beyond 2^53, a Decimal128 and a regex, 130 collections, a real getMore past a 16 MB first batch (a direct probe first checks that the server really pages), and coll.stats raw types compared with an unpromoted direct `$collStats` read. db.stats raw remains lossy for whole-number Doubles. That trade-off is now an explicit, recorded assumption (21:54 note) for a non-cursor reply, where `promoteValues: false` would break the driver's error codes. The humans review this assumption; it is not reported again.
- CR-2 (stale assumption and module comment): resolved. The 21:54 assumption corrects the earlier "no BSON promotion" note. The module comment (browse.ts:9-16) and the `RAW` comment (browse.ts:18-23) describe the current behaviour accurately: cursor documents are lossless, and dbStats Int32/Double values are promoted.

Acceptance criteria:
- AC1 (integration tests for each method against the 8.x replica set fixture): covered by the `db.*` and `coll.*` suites in test/integration/browse.int.spec.ts. Round 3 strengthened them and did not weaken them. The test-writer renamed the test that was misnamed "pages through more than one batch" and added a test that pages for real.
- AC2 (drop/rename refused on a read-only profile): covered by the READ_ONLY int tests through `guardWrites`, which `startBackend` wraps around the browse handlers (backend.ts).
- AC3 (listing for a user with only `read` on one database): covered by the auth-fixture suite on its own mongo:8.2 `--auth` standalone, as the recorded assumption describes.

The checkboxes in the task file are still unticked. The parent worker records the evidence with `tasks.py verify`.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

None.

## Review conclusion

No material issues found.

The round-2 findings are resolved: cursor-based `raw` outputs (coll.list, coll.stats) are lossless, and server error codes stay numeric. The one remaining lossy case (whole-number Doubles in db.stats raw) is a recorded assumption for humans to confirm. The fix is small and local to browse.ts, its tests exercise byte-level decoding on both fake and real servers, and it introduces no security, integration or architecture issues. Writes still go through `guardWrites`, error messages are masked with `redact`, and test credentials are generated at run time.

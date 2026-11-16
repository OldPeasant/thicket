# Code Review

Date: 2026-11-16

Task: docs-write-backend - M1: Document writes with conflict detection (round 2, final revision)

Scope: `git diff 37861d5..984c6cc -- . ':!tasks' ':!reviews'` (packages/backend/src/docs/write/*, wiring in packages/backend/src/server/backend.ts and packages/backend/src/index.ts, packages/backend/src/server/backend.spec.ts, packages/contract/src/docs.ts and errors.ts comments, test/integration/docs-write.int.spec.ts, docs/ARCHITECTURE.md). The round-1 findings CR-1..CR-4 and TW-1 were checked against the fix commit 984c6cc.

Requirements:
- tasks/docs-write-backend.md acceptance criteria and recorded assumptions
- SPEC.md M1 "Editing and saving" and "Safety"
- docs/ARCHITECTURE.md (document writes and write guard sections)
- AGENTS.md, docs/QUALITY.md (report contract)
- Round-1 reports: reviews/docs-write-backend/review.md (previous version), tests.md, fixes.md

Git range:
- Branch: main
- HEAD: 984c6cc463b58ac9f22c6a220e9944689ec6a169
- Base/start: 37861d5742a384e7ee1663a4e76509cbb87c0a91
- Commits reviewed: 6 (54d6f9a, 3fbf6a5, e7231b7, 12eaea9, f52cbe4, 984c6cc); no uncommitted changes at review start

Summary: 0 P0, 0 P1, 0 P2, 1 P3

## Status of round-1 findings

- CR-1 (expectedCount check not atomic): resolved. The `checkExpectedCount` doc comment (write.ts:335-342), docs/ARCHITECTURE.md and the contract `expectedCount` comments now say the check is best effort and not atomic.
- CR-2 (write concern error message): resolved. The message now says the write was applied but not acknowledged by the requested write concern (write.ts:133). Code and detail are unchanged, and the unit assertions were updated without being weakened. The optional `done` text was not added, which is acceptable. A remaining edge case is listed as CR-1 below.
- CR-3 (CONFLICT without detail undocumented): resolved. packages/contract/src/errors.ts now documents the `CONFLICT` code for both cases, and docs.ts documents the `expectedCount` fields. These are comment-only changes, and the schemas are unchanged.
- CR-4 (wiring and production coverage): resolved by the test-writer's backend.spec.ts table (backend.spec.ts:382-431). Through `startBackend`, it checks all six write methods for READ_ONLY (even when confirmed), CONFIRMATION_REQUIRED on production without confirmation, and NOT_CONNECTED once allowed. It also checks that `docs.previewMany` is not guarded. Dropping `docsWriteHandlers` from `startBackend` would now fail these tests.
- TW-1 (BSON values accepted as pipeline stages): resolved. `manyUpdate` now refuses stages that are not plain objects or that carry `_bsontype` (write.ts:61-69), the same rule `parseDocument` uses. Regression cases cover Int32 and ObjectId stages.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | A write concern error on a single-document write that matched nothing says "applied" and hides the CONFLICT / deleted:false outcome**
    - File: `packages/backend/src/docs/write/write.ts:236`, `packages/backend/src/docs/write/write.ts:253`, `packages/backend/src/docs/write/write.ts:289`
    - Category: Correctness
    - Problem: `updateOne` and `deleteDocument` call `checkReply` before they look at `n`. If the conflict filter matched nothing (`n: 0`) but the reply still carries a `writeConcernError` (a server can wait for the requested write concern even after a no-op write), the request fails with SERVER_ERROR "update: the write was applied but not acknowledged...". Nothing was applied, and the real outcome is CONFLICT with the server document, or `deleted: false` for a delete.
    - Why it matters: This is rare, and only reachable when write concern waits fail (lagging secondaries, or the per-profile write concern in M2). The user then sees a misleading message instead of the conflict dialog. Retrying gives the correct CONFLICT, so no data is at risk.
    - Suggested fix: Optional. For single-document writes, report the write concern error only when `n > 0`. Otherwise take the conflict path. Alternatively, say "may have been applied" in the message.

## Notes (not findings)

- Verified by the reviewer on 984c6cc:
    - `cd packages/backend && npx vitest run src/docs/write src/server/backend.spec.ts` -> 3 files, 118 tests passed.
    - `npx vitest run --config test/integration/vitest.config.ts docs-write` (replica-set container fixture) -> 1 file, 20 tests passed.
    - `npx prettier --check` on the changed files -> clean.
- Acceptance criteria in the int test:
    - #1 (update succeeds, concurrent change gives CONFLICT with the server document, delete, insert returns `_id`): covered.
    - #2 (preview count equals the updateMany matched/modified count and the deleteMany deleted count): covered.
    - #3 (read-only refused for all writes; unconfirmed production refused for insert/delete): covered. The other write methods are covered at the startBackend level in backend.spec.ts.
- `python tasks.py verify docs-write-backend` still shows no evidence recorded for criteria #1-#3. The parent must record the int test run (command and result) for each criterion before `done`.
- The docs/ARCHITECTURE.md line 220 is longer than 100 characters. Prettier keeps prose as written, so the check passes. This is a cosmetic issue only.

## Review conclusion

No material issues found.

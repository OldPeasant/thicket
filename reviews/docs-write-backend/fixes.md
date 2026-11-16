# Fix Report

Date: 2026-11-16

Task: docs-write-backend (document writes backend: insert/update/replace/delete, previewMany, updateMany/deleteMany)

Scope: current task; findings TW-1 (tests.md), CR-1, CR-2, CR-3 (review.md), reviewed at HEAD ee76442 (base d29db11).

## Fixed findings

### TW-1 — updateMany accepts pipeline stages that are BSON values

Files changed:
- `packages/backend/src/docs/write/write.ts`
- `packages/backend/src/docs/write/write.spec.ts`

Problem:
`manyUpdate` only refused non-objects, null and arrays as pipeline stages. Canonical EJSON parses `1` to a BSON Int32 object and `{"$oid":...}` to an ObjectId, so these passed as "documents" and were sent to the server.

Fix:
A stage must also have the plain `Object.prototype` and no `_bsontype` property, the same rule `parseDocument` in `../query/query.ts` applies. Otherwise the request is refused with INVALID_PARAMS ("every stage of an update pipeline must be a document"). The test writer's existing number-stage case now passes. A regression case for an ObjectId stage was added to the same `it.each` table.

Validation:
- `npx vitest run packages/backend/src/docs/write` — Pass (84 tests)

### CR-1 — checkExpectedCount is not atomic

Files changed:
- `packages/backend/src/docs/write/write.ts`
- `docs/ARCHITECTURE.md`

Problem:
The count and the write are separate commands, but the documentation read as if the check guaranteed that no unconfirmed documents would be touched.

Fix:
The doc comment of `checkExpectedCount` now says the check is best effort: documents that start to match between the count and the write are still written. The "Document writes" bullet in `docs/ARCHITECTURE.md` now says "best effort: count, then write; not atomic". Behavior is unchanged.

Validation:
- `npm run check` — Pass

### CR-2 — write concern error message implies the write failed

Files changed:
- `packages/backend/src/docs/write/write.ts`
- `packages/backend/src/docs/write/write.spec.ts`

Problem:
A `writeConcernError` in the reply means the write may have been applied. The SERVER_ERROR message "<op>: write concern error: ..." did not say so.

Fix:
The message is now "<op>: the write was applied but not acknowledged by the requested write concern: <errmsg or unknown>". The error code (SERVER_ERROR) and detail (`serverCode`, `codeName`) are unchanged. The five unit-test assertions on the message text were updated to the new wording. No assertion was weakened.

Validation:
- `npx vitest run packages/backend/src/docs/write` — Pass

### CR-3 — CONFLICT without detail for bulk writes is undocumented

Files changed:
- `packages/contract/src/docs.ts`
- `packages/contract/src/errors.ts`

Problem:
The contract described `CONFLICT` only as a single-document conflict with `ConflictDetail`. `docs.updateMany` and `docs.deleteMany` also answer `CONFLICT`, without detail, when more documents match than `expectedCount`.

Fix:
The `expectedCount` comments on `docs.updateMany` and `docs.deleteMany` now describe the `CONFLICT`-without-detail answer and the best-effort check. The `CONFLICT` comment in `errors.ts` mentions `ConflictDetail` for single-document writes and the detail-less answer for bulk writes. These are comment-only changes, and the schemas are unchanged.

Validation:
- `npm run check` — Pass (lint, typecheck)

## Not fixed

None.

## Validation summary

Focused tests:
- `npx vitest run packages/backend/src/docs/write` — Pass, 84 tests
- `npx prettier --check packages/backend/src/docs/write/write.spec.ts` — Pass

Full test suite:
- `npm run check` (lint, typecheck, unit tests) — Pass. Backend/contract: 48 files, 2920 tests passed. Renderer: 52 files, 1224 tests passed.
- `npx vitest run --config test/integration/vitest.config.ts docs-write` — Pass, 1 file, 20 tests

Lint/type-check/build:
- Part of `npm run check` (`npm run lint && npm run typecheck && npm run test`) — Pass

`.taskcheck`:
- Pass (`.taskcheck` runs `npm run check`, which passed as shown above)

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.

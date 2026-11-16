# Code Review

Date: 2026-11-16

Task: docs-write-backend - M1: Document writes with conflict detection

Scope: `git diff d29db11..766333a`, excluding `tasks/` and `reviews/` (packages/backend/src/docs/write/*, wiring in packages/backend/src/server/backend.ts and packages/backend/src/index.ts, test/integration/docs-write.int.spec.ts, docs/ARCHITECTURE.md)

Requirements:
- tasks/docs-write-backend.md acceptance criteria and recorded assumptions (delete of a gone document answers deleted:false; expectedCount refuses only when more documents match; update refuses non-operator keys, replace refuses $-keys; insert generates ObjectId _ids; write errors map to SERVER_ERROR)
- SPEC.md M1 "Editing and saving" and "Safety"
- docs/ARCHITECTURE.md (backend docs query / write guard sections)
- AGENTS.md, docs/QUALITY.md (report contract)
- Contract: packages/contract/src/docs.ts, packages/contract/src/errors.ts (conflictDetail, serverErrorDetail); guard: packages/backend/src/guard/guard.ts

Git range:
- Branch: main
- HEAD: 766333ad5acf3243eed74cedd4d5c407e5fc3fa3
- Base/start: d29db11c6147eeaeaeda9106d38fc1b64bba115d
- Commits reviewed: 4 (7d399d8, bbc6896, 66e6a34, 766333a); no uncommitted changes at review start

Summary: 0 P0, 0 P1, 0 P2, 4 P3

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | The expectedCount check is not atomic with the bulk write, but is documented as if it were**
    - File: `packages/backend/src/docs/write/write.ts:334`
    - Category: Correctness
    - Problem: `checkExpectedCount` runs a separate count aggregation, then `updateMany`/`deleteMany` send the write command. Documents inserted or changed to match between the two commands are written even though the user did not confirm them. The doc comment ("nothing unconfirmed is touched") and docs/ARCHITECTURE.md:219 ("refuse with `CONFLICT` when more documents match than the confirmed `expectedCount`") present this as a guarantee.
    - Why it matters: It is a best-effort check. Callers and later tasks (bulk UI, the confirmation flow for deletes over 1 000 documents) may rely on a guarantee that does not exist.
    - Suggested fix: Say in the comment and the ARCHITECTURE note that the check is best-effort (there is a race window between the count and the write). Optionally, mention in the result or a log when the reply's `n` exceeds `expectedCount`.

- [ ] **CR-2 | A write concern error reports a write that may have been applied as a plain failure**
    - File: `packages/backend/src/docs/write/write.ts:123`
    - Category: Quality
    - Problem: `checkReply` turns `writeConcernError` into `SERVER_ERROR` "<what>: write concern error: ...". The message does not say the write itself was applied on the primary, unlike the write-error path, which prefixes the `done` text. For `docs.update`, the user sees a failed save. If they retry, the expected values no longer match, so the retry gets `CONFLICT`, which looks like someone else changed the document.
    - Why it matters: It gives a misleading outcome for single-document saves once the per-profile write concern (M2) makes this reachable.
    - Suggested fix: Word the message to say the write was performed but not acknowledged at the requested write concern, and include the `done` text when it is known.

- [ ] **CR-3 | The bulk count mismatch reuses CONFLICT without ConflictDetail, and the contract does not document this**
    - File: `packages/backend/src/docs/write/write.ts:352`
    - Category: Integration
    - Problem: The contract documents `CONFLICT` as "The update's conflict filter matched nothing" (packages/contract/src/errors.ts:22) with `ConflictDetail` as its detail. `updateMany`/`deleteMany` now also throw `CONFLICT` with no detail when the count grew. The `expectedCount` comments (packages/contract/src/docs.ts:222, 234) only say "may refuse" and do not name the code. The choice is recorded as an assumption, but the shared contract does not mention it.
    - Why it matters: A renderer that handles `CONFLICT` generically by parsing `detail` with `conflictDetail` (as the doc-edit flow will) gets a parse failure or a wrong dialog for the bulk case.
    - Suggested fix: Document in the contract comments (the `expectedCount` field and/or the CONFLICT error code) that bulk writes answer `CONFLICT` without detail when more documents match than were confirmed. This can be done as a follow-up if the contract is outside this task's touches.

- [ ] **CR-4 | The integration tests use their own wiring instead of startBackend, and test production refusal for only two methods**
    - File: `test/integration/docs-write.int.spec.ts:57`, `test/integration/docs-write.int.spec.ts:390`
    - Category: Tests
    - Problem: The int test builds `guardWrites(docsWriteHandlers(manager), profileOf)` itself, so dropping `...docsWriteHandlers(connections)` from `startBackend` (packages/backend/src/server/backend.ts) would fail no test. packages/backend/src/server/backend.spec.ts has a startBackend-level "is guarded" table for the browse writes but none for the docs writes. The production test refuses only `docs.insert` and `docs.delete` without confirmation, not `docs.update`/`docs.replace`. The risk is low: the guard wraps handlers by `WRITE_METHODS` name, and guard.spec.ts covers every write method.
    - Why it matters: A regression in the real wiring would only show up in e2e.
    - Suggested fix: Add the docs write methods to the `browseWrites`-style table in backend.spec.ts (READ_ONLY / CONFIRMATION_REQUIRED / NOT_CONNECTED through startBackend), and include `docs.update` in the production refusal int test.

## Notes (not findings)

- Acceptance criteria coverage in the int test: #1 update succeeds, concurrent change gives CONFLICT with the server document, delete, insert returns _id: all present. #2 preview count equals the updateMany matched/modified count and the deleteMany deleted count: present. #3 read-only refused for all six writes, unconfirmed production refused for insert/delete, bulk writes need confirmation: present.
- `python tasks.py verify docs-write-backend` shows no evidence recorded yet for the three criteria. The reviewer did not run the integration suite: container use was not available in this review session. The parent must run `npm run test:int` against the replica-set fixture and record the result before `done`.
- ESLint on the changed files reports no problems.
- Conflict filter semantics (`$and` of an `$eq` `_id` match and the diff's `expected` fragment), the operator-only update check, the `$`-key check on replacements, the generated ObjectId `_id`s, the lossless canonical EJSON for `current`, and the cancellation through `Operation` all match the contract, SPEC "Editing and saving" and the recorded assumptions.

## Review conclusion

No material issues found.

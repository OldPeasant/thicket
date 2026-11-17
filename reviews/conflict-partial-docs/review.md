# Code Review

Date: 2026-11-17

Task: conflict-partial-docs - Conflict view for partly loaded (cut-array) documents

Scope: round 2, the final production code of the task: `git diff 98cd4aa..2e11291c -- packages/renderer/src/app/document/conflict/conflict-view.ts packages/renderer/src/app/document/document-actions.service.ts`. The task commits are d6159160 (implementation), f382b219 (tests and round-1 reports) and 2e11291c (fixer). The other changes in `98cd4aa..HEAD` come from other tasks merged from main, and are not reviewed here. The fix delta `git diff d6159160..2e11291c` was also read on its own. The committed specs `conflict-view.spec.ts`, `collection-view.spec.ts` and `document-actions.service.spec.ts` were read at HEAD. The uncommitted change to `conflict-view.spec.ts` belongs to a test-writer working at the same time and is not part of this review.

Requirements:
- tasks/conflict-partial-docs.md acceptance criteria 1-3 and its recorded assumption: resolveBlocker returns 'partial' only for documents with cut arrays, and a document edited under a since-cleared projection keeps the projection wording
- reviews/conflict-partial-docs/review.md round 1 (CR-1..CR-3), fixes.md, tests.md (TW-1, O-1)
- reviews/doc-paging/tests.md TW-1, TW-2; reviews/doc-paging/review.md CR-8
- packages/contract/src/docs.ts `slicedArray` (`loaded` = number of leading items included)
- SPEC.md M1 "Conflict detection"; docs/ARCHITECTURE.md "Paging inside documents"; AGENTS.md

Git range:
- Branch: main
- HEAD: 2e11291c
- Base/start: 98cd4aaf93fcad419bd6149f972aeaf74bbb3283
- Commits reviewed: 3 (d6159160, f382b219, 2e11291c)

Summary: 0 P0, 0 P1, 0 P2, 1 P3

Verification: in this session the reviewer was not allowed to run the test runner, so the tests were not re-run. The test assertions cited below were read from the committed specs at HEAD. The fixer reports `npm run check` and the focused specs passing (fixes.md); the parent worker must confirm this independently.

## State of previous findings

- **CR-1 (P1) A cut document deleted on the server gets a projection note: resolved.** `ConflictView.item()` (`conflict-view.ts:524-527`) now sets `blocked: 'partial'` when `conflict.current === null && conflict.cut !== undefined`. The new `@else if (item.blocked === 'partial' && item.state === 'deleted')` branch (lines 103-108) names the partial load. Because `blocked` is no longer null, "Insert again" is hidden (line 225), and only "Keep it deleted" remains. `resolveWith` still refuses a direct call (`document-actions.service.ts:268-277`). Covered by `conflict-view.spec.ts` "a deleted server version: the partial-load note, no insert-again, and re-inserting is refused", which checks for exactly one `conflict-note`, no projection wording, no `conflict-overwrite`, and no `docs.insert`.
- **CR-2 (P3) Double note under a projection block: resolved.** The projection-compare note is again the last `@else if` of the blocked chain (lines 116-121). The cut note has its own test id, `conflict-cut-note` (lines 123-129), so `conflict-note` is no longer duplicated. Covered by "a document blocked by a projection shows only the projection note (review CR-2)" and "a partial document under a top-level projection (not blocked) keeps the compare note".
- **CR-3 (P3) Re-insert refusal suggests something that cannot work: resolved.** `PARTIAL_REINSERT_REFUSED` now ends "Keep it deleted." (`document-actions.service.ts:593-596`).
- **TW-1 / O-1 (test report): resolved.** The server array is cut to `array.loaded` from `conflict.cut` (`conflict-view.ts:502-509`), not to the local array's current length. Items appended locally therefore no longer reveal never-loaded server items, and loaded items removed locally still show on the server side. This matches the contract meaning of `loaded`.

## Re-checked acceptance criteria

- Criterion 1: met. `conflict.cut` is captured from `slicedOf(key)` before the `serverVersion` await (`document-actions.service.ts:469`). The server's array is shown only up to `loaded` items. The 300/100 component test in `collection-view.spec.ts` is unchanged, and the dotted-path, shorter and longer cases are covered in `conflict-view.spec.ts`.
- Criterion 2: met. Changed state: the `'partial'` blocker gives the partial-load note and `PARTIAL_RESOLVE_REFUSED`. Deleted state: the partial-load note, and `PARTIAL_REINSERT_REFUSED` when the document is cut or no projection is active. Both follow the recorded assumption.
- Criterion 3: met. On `keepServer`, `readBack(..., true)` passes `undefined` as the cut flags when it falls back (`document-actions.service.ts:533-537`). The adjusted collection-view test is unchanged since round 1.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-4 | The view and the service each own part of the "can it be inserted again" rule**
    - File: `packages/renderer/src/app/document/conflict/conflict-view.ts:524-527`
    - Category: Architecture
    - Problem: `resolveWith` refuses a re-insert when `partial || conflict.cut !== undefined` (`document-actions.service.ts:268`). The view mirrors only the `cut` half of that rule, in its own expression, because `resolveBlocker` returns null for every deleted document. For a deleted document that is partial only because of a projection (active, or since cleared), the view still offers "Insert your version again", and the service always refuses it. Before this task that button already behaved this way for the projection-active case, so this is not a regression. The new fallback does make it a split, two-place rule.
    - Why it matters: Which buttons the view offers is otherwise decided by `DocumentActions.resolveBlocker`. A second, partial copy of the rule in the view can drift from the service, and it leaves a button in place that can only fail.
    - Suggested fix: Optional and non-blocking. Have the service own the deleted case, for example a `resolveBlocker` result or a `canReinsert(key)` that matches the `resolveWith` condition, and have the view use only that. The projection-only deleted case could then use the same mechanism, possibly as a follow-up task.

## Review conclusion

No material issues found. All round-1 findings (CR-1..CR-3) and TW-1/O-1 are resolved. The only remaining finding, CR-4, is a non-blocking P3.

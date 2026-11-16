# Code Review

Date: 2026-11-16

Task: diff-ops - Core: edit diff → update operations and conflict filter

Scope: `git diff 47ace47..HEAD` (committed changes only). The parent named commits d8fc1f2 and a697f60; in the current history the same changes are 92d15dc ("Add edit diff to update operations and conflict filter") and 3599312 ("Add diff-ops unit and integration tests"), plus four `assume:` commits that touch only `tasks/diff-ops.md`.

Requirements:
- tasks/diff-ops.md acceptance criteria and recorded assumptions (#1-#4)
- SPEC.md "Documents" (minimal `$set`/`$unset`, `$push` for pure appends, filter = `_id` + original values of changed top-level fields)
- packages/contract/src/docs.ts `docs.update` (`update` + `expected`) and `docs.replace` (`expected` optional)
- docs/ARCHITECTURE.md conventions (core is pure TS, no Node APIs, no `any`), AGENTS.md

Git range:
- Branch: main
- HEAD: 3599312440001055ef1c4e8bee56b58b8dbbfe65
- Base/start: 47ace471e394cdd872f6045a03d410b73abf14e8
- Commits reviewed: 6 (2 code commits, 4 task-file-only assumption commits); no uncommitted changes

Summary: 0 P0, 0 P1, 2 P2, 0 P3

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | Conflict filter misses a concurrent removal of a field whose original value was null**
    - File: `packages/core/src/diff/diff.ts:187`
    - Category: Correctness
    - Problem: For an addressable changed top-level field the filter is `{field: {$eq: <original>}}`. When the original value is BSON `null`, MongoDB query semantics make `{field: {$eq: null}}` match documents where the field is null **or missing**. If another user `$unset`s that field after the editor loaded the document, the filter still matches, so the save is applied without a CONFLICT. (The `$expr`/`$getField` branch does not have this problem: in aggregation `$eq` missing is distinct from null.) Assumption #3 records the array-containment and cross-numeric-type limits of `$eq`, but not the null/missing case. Neither `DIFF_CASES` nor the integration test exercises it: `concurrentChange` in `test/integration/diff-ops.int.spec.ts:27` only ever sets a string value, never removes the field.
    - Why it matters: AC 3 ("not [matching] one where a changed field was modified") and SPEC "Conflict detection" — a concurrent removal is a modification that goes undetected, so the user's save silently overwrites another user's change (lost update). Null is a common value in real documents.
    - Suggested fix: For a null original, add `$exists: true` (or `$type: "null"`) to the condition, e.g. `{field: {$eq: null, $exists: true}}`, or use the `$expr`/`$getField` exact check for such values. Add a fixture with a changed top-level field whose original is `null`, and extend the conflict-filter integration test with a "field removed on the server" variant.

- [ ] **CR-2 | Conflict filter with an original BSON `undefined` value is rejected by the server**
    - File: `packages/core/src/diff/diff.ts:187`
    - Category: Correctness
    - Problem: The model supports the deprecated `undefined` type (`packages/core/src/bson/model.ts:41`), and `diffDocuments` emits `{field: {$eq: {"$undefined": true}}}` when such a top-level field is changed. MongoDB's query parser rejects comparisons to undefined ("cannot compare to undefined", BadValue), so `updateOne`/`replaceOne` with this filter fails instead of saving. Legacy documents with `undefined` values are exactly the case where a user would open the editor to fix the value, and the save would then always fail with a server error. No fixture covers it.
    - Why it matters: Saving such a document is impossible through the produced update; the backend would surface it as SERVER_ERROR rather than a working save or a CONFLICT.
    - Suggested fix: For an `undefined` original, use `{field: {$type: "undefined"}}` (or the `$expr`/`$getField` check with `$literal`, which aggregation accepts), and add a fixture plus an integration case for it.

## P3 Low

None.

## Review conclusion

Material issues found; fix before completing the task.

The core diff logic itself checks out: nested set/unset, rename as unset+set, type changes, `$push` with `$each` for pure appends, whole-array `$set` otherwise, parent replacement for reorders and unaddressable keys, top-level `replace`, `_id` protection, and the update/filter shapes match `docs.update` (`update` + `expected`). All acceptance-criteria cases are in the table-driven `DIFF_CASES`, which both the unit tests and the integration test (against mongo 8 and 7) use. The two findings are narrow value cases in the conflict filter (null and undefined originals). Both fall under AC 3 and SPEC conflict detection, and neither is covered by the recorded assumptions.

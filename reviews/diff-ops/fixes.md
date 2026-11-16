# Fix Report

Date: 2026-11-16

Task: diff-ops - Core: edit diff → update operations and conflict filter

Scope: current task. Base 47ace471e394cdd872f6045a03d410b73abf14e8, HEAD c6c2eaf (branch `main`);
findings CR-1, CR-2 (`reviews/diff-ops/review.md`) and TW-1, TW-2 (`reviews/diff-ops/tests.md`),
approved by the parent worker together with the TW-2 decision (throw `BsonModelError`). Changes are
uncommitted working-tree edits for the parent to commit.

## Fixed findings

### CR-1 / TW-1 — Conflict filter misses a concurrent removal of a field whose original value was null

Files changed:
- `packages/core/src/diff/diff.ts`
- `packages/core/src/diff/fixtures.ts`
- `packages/core/src/diff/diff.spec.ts`

Problem:
For a changed top-level field with original value `null`, the filter used `{field: {$eq: null}}`,
which also matches a document where the field was removed, so a concurrent removal was not
detected as a conflict.

Fix:
New helper `queryFieldCheck` in `conflict()`: a null original is checked with
`{field: {$type: "null"}}` (absent → `$exists: false`, other values → `$eq`, unchanged). The
`$expr` branch (`exprFieldCheck`) now compares `{$type: <$getField>}` to `"null"` for a null
original instead of `$eq` with `$literal: null`, so a missing field cannot match there either.
Fixture `null → value (top-level)` now expects `{"a":{"$type":"null"}}`; new fixture
`null → value for a top-level key with a dot → replace, $expr $type check` covers the `$expr`
branch, and both run through the shared integration tests (apply, conflict filter, concurrent
removal). New unit tests cover both branches and that a null nested inside a changed document
still uses exact `$eq` document equality.

Validation:
- `cd packages/core && npx vitest run src/diff` — Pass (103 tests)
- `npm run test:int -- diff-ops` (repo root, Podman, mongo 8 and 7) — Pass (284 tests), including
  `conflict filter detects a concurrent removal: null → value (top-level)` that failed before

### CR-2 — Conflict filter with an original BSON undefined value is rejected by the server

Files changed:
- `packages/core/src/diff/diff.ts`
- `packages/core/src/diff/diff.spec.ts`

Problem:
An original BSON `undefined` produced `{field: {$eq: undefined}}`, which the server rejects
("cannot compare to undefined"), so the save always failed.

Fix:
`queryFieldCheck` emits `{field: {$type: "undefined"}}`; `exprFieldCheck` compares the field's
`$type` to `"undefined"`. Unit test `checks a BSON undefined original by $type` covers both
branches. Not covered by an integration test: the Node driver turns BSON undefined from EJSON into
null on insert (as noted in `tests.md` and by the parent).

Validation:
- `cd packages/core && npx vitest run src/diff` — Pass

### TW-2 — A replace result with a top-level `$` key cannot be written

Files changed:
- `packages/core/src/diff/diff.ts`
- `packages/core/src/diff/fixtures.ts`
- `packages/core/src/diff/diff.spec.ts`

Problem:
When the diff falls back to `replace` and the edited document has a top-level key starting with
`$`, `replaceOne` is rejected by the server, so the returned `replace` was unusable.

Fix:
Per the parent's decision, `diffDocuments` throws
`BsonModelError("Top-level field names starting with $ cannot be saved: <keys>")` (keys joined by
`, `) on the replace path when the edited document has such keys. Edits that produce an `update`
(the `$` key itself unchanged) are not affected. Doc comments (module rules, `replacement`) updated.
The shared fixture `top-level reorder in a document that keeps a $-prefixed key → replace` was
removed from `DIFF_CASES` (it has no server result) and replaced by unit tests: reorder keeping
`$k`/`$m` throws, new top-level `$x` throws (this replaces the former unit test that expected a
`replace`), and an unchanged top-level `$k` still yields an update. The fixture
`removed top-level $-prefixed key → replace document` stays: its edited document has no `$` key
and `replaceOne` accepts it (passes on both servers).

Validation:
- `cd packages/core && npx vitest run src/diff` — Pass
- `npm run test:int -- diff-ops` — Pass (no failing replace case left)

## Not fixed

None.

## Validation summary

Focused tests:
- `cd packages/core && npx vitest run src/diff` — Pass (103 tests; 98 before)
- `cd packages/core && npx vitest run --coverage --coverage.include=src/diff/diff.ts src/diff` —
  diff.ts 100% statements (125/125), branches (82/82), functions (28/28), lines (92/92)

Full test suite:
- `npm run test:int -- diff-ops` (repo root, Testcontainers on Podman, MongoDB 8 and 7) — Pass,
  284/284. The rest of the integration suite was not re-run (no other file changed).

Lint/type-check/build:
- `npm run check` (eslint, Prettier, tsc for all workspaces, unit tests: root 1472, renderer 181) — Pass
- `npx prettier --check packages/core/src/diff test/integration/diff-ops.int.spec.ts` — Pass

`.taskcheck`:
- Pass (`.taskcheck` runs `npm run check`, see above)

Remaining unresolved findings:
0

Note for the parent: `$type: "null"` (like the previous `$eq: null`) also matches a server array
that contains null; this is the same array-containment limit already recorded in assumption #3,
not a new behavior. The parent may want to update assumption #3 to mention the `$type` checks
for null/undefined originals and the new throw for top-level `$` keys in a replace (assumption #2).

## Final status

All validated findings fixed and validation passed.

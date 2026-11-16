# Fix Report

Date: 2026-11-16

Task: codegen - M3: Code export (shell, Node, Python, Java)

Scope: the findings the parent worker accepted from `reviews/codegen/review.md` (CR-1, CR-2) and `reviews/codegen/tests.md` (TW-1). The parent did not pass CR-3, CR-4, TW-2 or TW-3 to the fixer. Uncommitted working-tree changes on top of 25d62a8.

## Fixed findings

### CR-1 — Java: `Arrays.asList(null)` throws NullPointerException

Files changed:
- `packages/core/src/codegen/java.ts`
- `packages/core/src/codegen/codegen.edge.spec.ts`
- `test/integration/codegen.int.spec.ts`

Problem:
For a one-element array that holds `null`, the generator wrote `Arrays.asList(null)`. Java passes that `null` as the varargs array itself, so the call throws a NullPointerException.

Fix:
When an array has exactly one item and that item is `null`, the generator now writes `Arrays.asList((Object) null)`. Other arrays print as before: `Arrays.asList(null, null)` and `Arrays.asList(1)` are unchanged, so the snapshots stay readable. New unit tests ("Java arrays") check the cast, including inside a nested array, and check that other arrays are unchanged. The integration test has a new query, `{ ratio: { $in: [null] }, status: { $in: ["open", "closed"] } }`, with a projection and a sort. It matches seed documents 3 and 4, which have no `ratio`. Node, Python and Java all run it against mongo8. The check that the comparison is not vacuous now expects `[2, 1, 2, 2]`. The seed data did not change.

Validation:
- `npx vitest run --project core packages/core/src/codegen` — Pass (128 tests)
- `npm run test:int -- codegen` — Pass (13 tests: the vacuity check plus 4 queries x 3 languages, Java included)

### CR-2 — Python SON branch for duplicate keys is useless

Files changed:
- `packages/core/src/codegen/python.ts`
- `packages/core/src/codegen/codegen.edge.spec.ts`

Problem:
Documents with repeated keys printed as `SON([...])`. `SON` is a dict subclass, so it keeps one value per key, just like a dict literal. The code comment claimed otherwise.

Fix:
Removed the SON branch. Documents now always print as dict literals. A doc comment explains that a dict, like SON, keeps the last value of a repeated key. The duplicate-key edge test now expects `{"a": 1, "a": 2}` (top level, nested, and in a pipeline) and no `SON` import. Recorded assumption #2 still says that Python uses SON. The parent should correct it with `tasks.py assume`, because the fixer must not change TFP state.

Validation:
- `npx vitest run --project core packages/core/src/codegen` — Pass

### TW-1 — layout can produce 81-column lines when a group is followed by `;`/`)`

Files changed:
- `packages/core/src/codegen/layout.ts`
- `packages/core/src/codegen/codegen.edge.spec.ts`
- `packages/core/src/codegen/__snapshots__/codegen.spec.ts.snap`

Problem:
In a `concat`, only the last part received `trailing`. Earlier parts were measured as if nothing followed them on the same line.

Fix:
Each concat part now receives the length of the text that must stay on its line. That text is the later parts up to the first point where they can break (a non-empty list breaks after `open`, a chain after its head), plus the outer `trailing` when nothing after the part can break. This is done by the new `firstLine`, `prefix` and `restOfLine` helpers in `layout.ts`. I added the test that `tests.md` proposed ("does not let text after a group push the line past WIDTH") and a second test for the later-parts and outer-trailing rules. Two outputs changed, both from lines that used to be too long:
- Java snapshot "find with awkward keys and strings": the 81-column `.append("$expr", ...))` line now breaks. This is the only snapshot diff, and I checked it before running `-u`.
- The edge test "writes positive values in every language" expected the 82-column shell line `...find({}).skip(3).limit(2147483647);`. It now expects `.find(\n  {}\n).skip(3).limit(2147483647);`, with a comment saying why. The test still checks the skip and limit values.

Validation:
- `npx vitest run --project core packages/core/src/codegen -u` — Pass, 1 snapshot updated (diff checked first)
- `npx vitest run --project core packages/core/src/codegen` — Pass (128 tests)

## Not fixed

None of the supplied findings remain open. The parent did not supply CR-3, CR-4, TW-2 or TW-3, so the fixer did not handle them.

## Validation summary

Focused tests:
- `npx vitest run --project core packages/core/src/codegen` — Pass, 2 files, 128 tests
- `npm run test:int -- codegen` — Pass, 13 tests (Node on the host, Python and Java in containers via podman, against mongo8)

Full test suite:
- `npm run check` — Pass (root vitest 35 files / 2227 tests; renderer 27 files / 437 tests)

Lint/type-check/build:
- `npx eslint packages/core/src/codegen test/integration/codegen.int.spec.ts` — Pass
- `npx prettier --check packages/core/src/codegen test/integration` — Pass
- `npx tsc -p tsconfig.json --noEmit` — Pass
- `npx tsc -p packages/core --noEmit` — Pass

`.taskcheck`:
- Pass (`.taskcheck` runs `npm run check`; see above)

I did not run a mutation check that reverts the CR-1 fix and confirms the Java integration run fails: the command needed approval. The unit test pins the emitted `(Object) null`, and the integration test runs the fixed code.

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.

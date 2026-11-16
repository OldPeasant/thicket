# Code Review

Date: 2026-11-16

Task: codegen - M3: Code export (shell, Node, Python, Java)

Scope: final revision 66e458db66423bb54ca2403132f9f096498b8bc8. This pass reviews commit 66e458d, which changes only test code (`git diff 4f928fd..66e458d`, 26 lines added to `packages/core/src/codegen/codegen.edge.spec.ts`). The earlier pass reviewed commits 51753b5, db456ab, 42fd635 and 4f928fd on top of base 8d4a693 (`git diff 8d4a693..4f928fd -- packages/core/src/codegen packages/core/src/index.ts test/integration/codegen.int.spec.ts`) and found no issues. Its results are kept below. No production code changed between 4f928fd and 66e458d. I reviewed committed changes only.

Requirements:
- tasks/codegen.md acceptance criteria: (1) snapshot tests for each language over 10 queries/pipelines, including every BSON type; (2) generated Node and Python code for 3 samples runs against a fixture (integration test; Java runs in a container)
- Recorded assumptions codegen #1-#4 (`python tasks.py assumptions`). #4 corrects #2 on duplicate keys, Node undefined and DBRef.
- SPEC.md M3 (pipeline code export), docs/ARCHITECTURE.md conventions (core has no Node APIs, no `any`)
- docs/QUALITY.md report contract
- Earlier review (CR-1..CR-4) and reviews/codegen/fixes.md

Git range:
- Branch: main
- HEAD: 66e458db66423bb54ca2403132f9f096498b8bc8
- Base/start: 8d4a6936df82e08a9a8e68fdd496ce290bf6b40c (this pass: 4f928fd3e0bfef4aa5e528844786b619ccd679f6)
- Commits reviewed: 5 code commits in total. This pass covers 1 (66e458d, tests only). TFP state commits in the range are not code.

Summary: 0 P0, 0 P1, 0 P2, 0 P3

Commands run during this pass (read-only, at 66e458d):
- `npx vitest run --project core packages/core/src/codegen` -> 2 files, 130 tests passed (128 before, plus the 2 new tests)
- `npx tsc --noEmit -p packages/core` -> no errors
- `npx eslint packages/core/src/codegen/codegen.edge.spec.ts` -> no problems

Commands from the earlier pass (at 4f928fd):
- vitest codegen: 128 passed. tsc and eslint: clean.
- A `tsx` probe of `layout` with `foo({...long...}).bar([1, 2]);` -> every line at or below 80 columns
- The integration test (`npm run test:int -- codegen`) was not run by the reviewer because it needs containers and network access. fixes.md reports 13 tests passing against mongo8 with Node, Python and Java.

## Review of commit 66e458d (new tests)

Test "counts an empty list after a group as unbreakable text":
- I traced it against the current `layout.ts`. `group` prints flat as 78 columns, `(` + 76 `a` + `)`. With `[]` the total is exactly 80, so the first expectation (one line, `${flat(group)}[]`) checks the boundary where everything still fits. With `[];` the total is 81. `restOfLine([empty, ';'], 0)` returns 3 because `firstLine` reports an empty list as non-breaking with length 2. 78 + 3 > 80, so the group breaks and the first line is `(`. That matches the second expectation.
- The test does what its name says. It pins the `items.length === 0` branch of `firstLine`. If an empty list counted as breakable, `rest` would be 2, the group would stay flat, and the expectation would fail. Before the fix in 4f928fd, the concat passed `rest` 0 to every part except the last, so the second expectation would fail there too. This is a real regression test for TW-1.

Test "generated find statements stay within WIDTH when `;` or `)` follows the group (TW-1)":
- For all 4 languages and string lengths 1..45, it generates a find and checks that every line containing `"v` is at most 80 columns. The `lines.length > 0` guard keeps the check from passing vacuously if a language quoted strings differently. All 180 cases pass, and the assertion messages name the language and `n`, so a failure would be easy to diagnose.
- Scope: it checks only the lines that hold the filter value. That is the line the TW-1 bug affected, so this scope matches the test name. Other generated lines are covered by the snapshots.
- The comment says the old code produced 81-column lines at node 41, shell 18 and java 37. I could not run the pre-fix `layout.ts` because I may not write a scratch copy outside the review file. From the 42fd635 code, the old concat ignored text after a non-final part, so overflows like these are expected, and the sweep 1..45 contains the cited lengths. No finding.

Flakiness: both tests are pure and deterministic. They use no timers, randomness, I/O or shared mutable state. The sweep runs 180 small generations in milliseconds; the whole codegen suite takes about 0.3 s.

Quality: the tests reuse the file's existing helpers (`find`, `fields`, `flat`, `list`, `concat`, `WIDTH`) and follow the style of the neighbouring layout tests. No production code, snapshot or existing test changed, and no test was weakened or skipped.

## Disposition of earlier findings (from the 4f928fd pass, unchanged)

- CR-1 (Java `Arrays.asList(null)` NPE): **Fixed.** `java.ts:82-87` emits `Arrays.asList((Object) null)` when an array has exactly one item and that item is `null`. Unit tests and the `$in: [null]` integration query cover the fix.
- CR-2 (useless Python SON branch): **Fixed.** The branch and the import are gone, and the comment and assumption #4 are corrected.
- CR-3 (Node sends BSON undefined as null): **Resolved by documentation** in assumption #4.
- CR-4 (missing CodegenError and date-fallback tests): **Resolved** by the unit cases in 42fd635.

## Regression check of layout.ts (TW-1 fix, from the 4f928fd pass, unchanged)

`restOfLine` and `firstLine` give each concat part the minimal text that must share its line. A later part still checks its own fit at its real column. The only snapshot change (Java "awkward keys", which would be 81 columns unbroken) is correct. The new tests in 66e458d now pin this behavior directly.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

None.

Note for the parent, not a finding: criterion #2 says "skip Java if no JDK, with reason". Java now runs in a container. When you record the evidence with `tasks.py verify`, include that run's command and result. Set `reviewed_revision` in quality.json to 66e458db66423bb54ca2403132f9f096498b8bc8.

## Review conclusion

No material issues found. Commit 66e458d adds two correct, deterministic tests. Each tests what its name claims, and together they pin the TW-1 line-width fix in `layout.ts`. The earlier conclusion for the production code at 4f928fd still holds, because no production code has changed since.

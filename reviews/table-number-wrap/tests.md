# Test Report

Date: 2026-11-17

Task: table-number-wrap - UI: numbers and short values never break mid-value in table cells

Scope: `git diff 697cea798176b184132e0850b7a78631a5c0dacb..HEAD`, task commits c5941bbd and 0954df66
as supplied by the parent. During this run the parent rebased them onto main: they are now beb62265 and
37266d2c (HEAD 37266d2c7c19a64bb67ddd1ae32a7aef2e5ce624). `git diff 0954df66..37266d2c` touches only
`tasks/*.md`, so the production code measured is identical before and after the rebase.

Requirements:
- tasks/table-number-wrap.md acceptance criteria and Goal
- parent's description of the change (the `scalar` getter and the `.val.bson.scalar` CSS rule)
- docs/ARCHITECTURE.md "Coverage"; AGENTS.md "Evidence"

## Test files changed

- `packages/renderer/src/app/explorer/editable-value/editable-value.component.spec.ts`

## Tests added or updated

Count: 31 (test cases, counting each `it.each` row; 7 test definitions)

- New describe block `EditableValueComponent scalar values never wrap mid-value`:
  - `%s is scalar and its value does not wrap` (15 rows): Int32, Int64, Double, Decimal128, ObjectId,
    Date, out-of-range Date, Timestamp, UUID (binary subtype 4, 16 bytes), MinKey, MaxKey, Undefined
    (deprecated), DBPointer (deprecated), and a null and a boolean held in a `BsonLeaf`. Checks the
    getter, the `scalar` class on `.val.bson` and the computed `white-space: nowrap` and `overflow-wrap: normal`.
  - `%s is not scalar and may still wrap` (8 rows): generic binary subtype 0, legacy UUID subtype 3,
    subtype 4 that is not 16 bytes, Regex, Code, Code w/ scope, Symbol, a string held in a `BsonLeaf`.
    Checks there is no `scalar` class, `white-space: pre-wrap` and `overflow-wrap: anywhere`.
  - `binary is scalar exactly when its badge says UUID`
  - `a %s is scalar and does not wrap` (4 rows): plain JS integer, fraction, boolean, null
    (`.val.num` / `.val.bool` / `.val.null`, computed `nowrap`).
  - `a plain string has no scalar class and wraps at word boundaries`
  - `updates the class when the value changes type` (Int32 to Regex)
- In the existing `type dropdown with a schema` block: `a deprecated scalar keeps the one-line value in
  edit mode` (DBPointer in edit mode keeps the read-only `.val.bson` with the `scalar` and `deprecated` classes).

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: Int32, Int64, Double, Decimal128, ObjectId, Date and Boolean values next to a wide nested column render on one line | json-table spec `keeps every %s value and its badge on one line`, `shows the scalar values unchanged`, `renders the orders table ...` (existing); editable-value spec `%s is scalar and its value does not wrap`, `a %s is scalar and does not wrap` (new) | `cd packages/renderer && npx ng test --coverage --coverage-include='src/app/explorer/editable-value/editable-value.component.ts' --include='src/app/explorer/editable-value/**/*.spec.ts' --include='src/app/explorer/json-table/**/*.spec.ts'` | Pass (53/53) |
| AC1 (measured line boxes in a real browser) | `table view keeps scalar values on one line` (business light, tron dark) | `npm run test:e2e -- test/e2e/table-number-wrap.e2e.ts` (Electron, Playwright) | Pass (2/2) |
| Every other scalar BSON type (Timestamp, UUID, MinKey/MaxKey, Undefined, DBPointer) stays on one line | `%s is scalar and its value does not wrap` | same ng test command | Pass |
| Types with long text (non-UUID binary, regex, code, code with scope, symbol) may still wrap | `%s is not scalar and may still wrap`, `binary is scalar exactly when its badge says UUID`, json-table `still lets long binary data wrap anywhere` | same ng test command | Pass |
| AC2: long strings wrap at word boundaries, not character by character | json-table `lets long strings wrap at word boundaries ...` (existing); `a plain string has no scalar class and wraps at word boundaries` (new) | same ng test command | Pass |
| AC3: screenshots in Business light and Tron dark | e2e test above writes them to the git-ignored `test-results/screenshots`; the committed PNGs under reviews/table-number-wrap/ were not regenerated or compared by this run | `npm run test:e2e -- test/e2e/table-number-wrap.e2e.ts` | Pass (the test and its screenshot steps ran). The committed images were not checked visually by the test-writer. |
| Class follows value changes | `updates the class when the value changes type` | same ng test command | Pass |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/app/explorer/editable-value/**/*.spec.ts'`

Result:

Pass: 1 file, 42 tests (11 existing + 31 new).

## Full test execution

Command:

`sh .taskcheck` (`npm run check`: lint, typecheck, root Vitest, renderer `ng test`)

Result:

Pass. Root: 87 files, 4457 tests. Renderer: 104 files, 3468 tests. Lint and typecheck passed (`check` chains them with `&&` before the tests).

E2E: `npm run test:e2e -- test/e2e/table-number-wrap.e2e.ts`: Pass, 2 passed (5.1 s run after the build).

## .taskcheck

Result:

Pass

## Bugs found

None. Every type is classified as the parent described, and every new test passed against the unchanged production code.

Observation (not a defect, no failing test): `.val.bson` keeps `max-width: 60ch`. A scalar whose text is
longer than 60 characters (a DBPointer with a long namespace, or in theory a Date followed by a long IANA
zone name) is now `nowrap` and will overflow its 60ch box instead of wrapping. This is rare (DBPointer is
deprecated), and the task criteria do not cover it. The parent can decide whether it matters.

## Coverage

Status: verified (whole-file and changed-line). The CSS and HTML changes are not instrumented by V8. They are covered by the computed-style and class assertions above and by the e2e test.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: measured by hand from the provider lcov. Executable lines in the added `scalar`
getter (editable-value.component.ts lines 74-89) are DA 75, 76, 77, 79, 85, 87, and all 6/6 are hit
(100%). Its branches (BRDA 76 x2, 77 x7) are all 9/9 hit (100%). `FNDA:322,scalar`.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: table-number-wrap; base 697cea798176b184132e0850b7a78631a5c0dacb; commits c5941bbd and 0954df66 from the parent (rebased during the run to beb62265 and 37266d2c, which change only tasks/ files); HEAD at report time 37266d2c7c19a64bb67ddd1ae32a7aef2e5ce624.
- Source/test snapshot identifier (including uncommitted inputs): sha256 editable-value.component.ts 3689bc5d84df5e09745ba010392245fcd185bc197a4a622fd2702abe7af8a04f; .css d5e54ea493f6cf030fc109f868015d66041fa4574cfcd2d285034b487bb8bd02; .html 9aa0b046e8f36cb3e8e5659850b6f9ef6d5fe5330edefd8508462d2a5f40a55c; uncommitted editable-value.component.spec.ts 785391d7885bfa610d00e3baf83be213facb576797ab18ddb8324dc2ff2032b4; json-table.component.spec.ts f37de2b7814cc8795636682b5529c5b89d6f4a058f15a775de3a63211093c139. The hashes were the same before and after the run.
- Exact included files; renamed/deleted/excluded files and reasons: included `packages/renderer/src/app/explorer/editable-value/editable-value.component.ts`. Excluded: `.css` and `.html` (V8 does not instrument them; verified by the computed-style tests and e2e), the json-table spec and the e2e file (tests), and the reviews/ PNGs (artifacts). No renames or deletions.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with @vitest/coverage-v8 5.1.0 through `ng test`. Run in `packages/renderer`: `npx ng test --coverage --coverage-include='src/app/explorer/editable-value/editable-value.component.ts' --include='src/app/explorer/editable-value/**/*.spec.ts' --include='src/app/explorer/json-table/**/*.spec.ts'`
- Run start/completion time and exit status: 2026-11-17 07:08:25 to 07:08:27 +01:00. 2 files and 53 tests passed, and the summary was printed.
- Generated report paths and report hashes/run identifier: `packages/renderer/coverage/renderer/lcov.info` (sha256 3836a8a88f48d87274b18a3a4917164a78e40dd1ac0891800489cde8690456e4), `coverage-summary.json` (sha256 08cfe93e1bcef9ded379c6c75de84bb36c9b9c5c167130c6863f6a03a2dfa68e). Both have mtime 07:08:27, during the run.
- Evidence outputs are fresh and inputs stayed unchanged: yes. The directory was regenerated at the run time, and the snapshot hashes were unchanged afterwards.
- Final run after latest test additions and production fixes: yes. The run came after all test additions, and there were no production fixes.

Values below use covered/total (percentage).

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/explorer/editable-value/editable-value.component.ts` | 64/80 (80%) | 54/69 (78.26%) | 19/27 (70.37%) | 54/66 (81.81%) |

Aggregate is the same single file. There are no unmeasured TS files.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `editable-value.component.ts:108-113` (`choiceIndex`, `choiceLabel`), `155-162` (`onChoice`), `182-186` (`onTypeChange` catch path), `199` (`commitBson`), `commitString`, `commitBoolean`, branches 192/193 | Pre-existing schema-choice and edit-commit code. It is not changed by this task and not part of its criteria. | Left uncovered: outside task scope. It may be covered by other specs that this scoped run did not include. |
| `scalar` getter (74-89) | AC1/AC2 classification | Fully covered (6/6 lines, 9/9 branches). |

## Unable to test

- Real layout line counts in the unit tests: jsdom has no layout, so the component tests assert classes and computed `white-space`/`overflow-wrap`. The measured line boxes are covered by the e2e test, which was run and passed.
- Visual content of the committed screenshots (AC3): the e2e run produced new screenshots in the git-ignored `test-results/`. Whether the committed PNGs in reviews/table-number-wrap/ match is a human or reviewer check.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found.

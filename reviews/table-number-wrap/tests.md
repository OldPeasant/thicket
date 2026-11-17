# Test Report

Date: 2026-11-17

Task: table-number-wrap - UI: numbers and short values never break mid-value in table cells

Round: 2, on the final code after fix CR-1 (`max-width: none` on `.val.bson.scalar`).

Scope: `git diff 887ef551..57cc49ba7a70084710e5483fcc97c73522c27ce3`. The base is `git merge-base HEAD origin/main` = 887ef551, as supplied by the parent. Task commits: 6bb0ca1b, 64ae0638, 1af13712 and 57cc49ba (CR-1 fix). Task code: `packages/renderer/src/app/explorer/editable-value/*`, `packages/renderer/src/app/explorer/json-table/json-table.component.spec.ts`, `test/e2e/table-number-wrap.e2e.ts`. The only uncommitted input is this round's change to `test/e2e/table-number-wrap.e2e.ts`. The working tree also shows a modified `reviews/table-number-wrap/review.md`. The test-writer did not touch it (it is probably the parallel code-reviewer's), and it is not a test input.

Requirements:
- tasks/table-number-wrap.md acceptance criteria, Goal and the two recorded assumptions
- reviews/table-number-wrap/review.md (CR-1) and reviews/table-number-wrap/fixes.md
- docs/ARCHITECTURE.md "Coverage"; AGENTS.md "Evidence"

## Test files changed

- `test/e2e/table-number-wrap.e2e.ts` (this round)

The round-1 file `packages/renderer/src/app/explorer/editable-value/editable-value.component.spec.ts` is now committed. It holds the fixer's CR-1 regression assertions. I re-checked it against the final code and did not change it this round.

## Tests added or updated

Count: 2 new e2e checks this round, inside the existing parameterized e2e test, so each runs for Business light and Tron dark.

- `overflowingScalars()`: in a real Electron layout, no `.val.bson.scalar` box ends past the right edge of its own `<td>`. This is the layout-level guard for CR-1: a one-line scalar widens its column instead of spilling into the next cell. With this data it checks all 108+ scalar values of the orders table. No value there is longer than 60ch, so it cannot reproduce the original CR-1 trigger (see "Unable to test").
- `stringWrap()` (AC2 in a real browser): all 12 long `note` strings are found and take more than one line, so the check is not vacuous. The observed maximum in this run was 9 lines. No word is split across lines: every `\S+` run of every descendant text node has exactly one line-box top.

I tried a third e2e test: seed a DBPointer with a namespace longer than 60 characters through `docs.insert`, then assert that it stays on one line inside its cell. I removed it. The DBPointer comes back as a DBRef sub-document (`$ref`/`$id`/`$db`, each a String/ObjectId leaf), so no DBPointer leaf ever reaches the table. A screenshot of the failed attempt confirmed this. The fixer's unit test covers CR-1 at the computed-style level instead.

The fixer's regression tests, re-checked against the final code:
- `%s is scalar and its value does not wrap` (15 rows) now also asserts the computed `max-width: none`.
- `a DBPointer with a long namespace has no max-width, so it cannot overflow its box` (text longer than 60 characters).
- `%s is not scalar and may still wrap` (8 rows) now asserts a finite positive `max-width`, so the 60ch cap is kept for values that may wrap.

These are meaningful. fixes.md reports 16 failures with the CSS fix removed. I did not repeat that mutation run: it would require editing production CSS.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: Int32, Int64, Double, Decimal128, ObjectId, Date and Boolean next to a wide nested column render on one line | json-table spec `keeps every %s value and its badge on one line` and related; editable-value spec `%s is scalar and its value does not wrap`, `a %s is scalar and does not wrap` | `cd packages/renderer && npx ng test --coverage --coverage-include='src/app/explorer/editable-value/editable-value.component.ts' --include='src/app/explorer/editable-value/**/*.spec.ts' --include='src/app/explorer/json-table/**/*.spec.ts'` | Pass (2 files, 54/54) |
| AC1 measured line boxes (real browser) | e2e `table view keeps scalar values on one line` (business light, tron dark): `wrappedScalars` finds no value on more than one line and no badge on another line | `npm run test:e2e -- test/e2e/table-number-wrap.e2e.ts` (Electron, Playwright, MongoDB container from the harness) | Pass (2/2) |
| CR-1: a scalar must not overflow its box or cell | unit: `%s is scalar ...` (`max-width: none`), `a DBPointer with a long namespace has no max-width ...`; e2e: `overflowingScalars` = [] | both commands above | Pass |
| Non-scalar BSON (non-UUID binary, regex, code, code w/ scope, symbol) still wraps and keeps the 60ch cap | `%s is not scalar and may still wrap`, `binary is scalar exactly when its badge says UUID`, json-table `still lets long binary data wrap anywhere` | ng test command above | Pass |
| AC2: long strings wrap at word boundaries, not character by character | json-table `lets long strings wrap at word boundaries ...`; editable-value `a plain string has no scalar class and wraps at word boundaries`; e2e `stringWrap('leave the parcel')`: 12 found, more than 1 line, no split words | ng test command and e2e command above | Pass |
| AC3: screenshots in Business light and Tron dark | the e2e test writes `table-number-wrap-{business-light,tron-dark}[-scrolled].png` to the git-ignored `test-results/screenshots` | e2e command above | Pass: the screenshot steps ran. The committed PNGs under reviews/table-number-wrap/ were not regenerated or compared by this run. This round adds only read-only measurements, so the seed data and the screenshot steps are unchanged. |
| The class follows value changes | `updates the class when the value changes type` | ng test command above | Pass |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --coverage --coverage-include='src/app/explorer/editable-value/editable-value.component.ts' --include='src/app/explorer/editable-value/**/*.spec.ts' --include='src/app/explorer/json-table/**/*.spec.ts'`

Result:

Pass: 2 files, 54 tests.

E2E:

`npm run test:e2e -- test/e2e/table-number-wrap.e2e.ts`

Result:

Pass: 2 passed (6.9 s after the build), on the final version of the e2e file (sha256 45647e76…).

`npx prettier --check` and `npx eslint` on the e2e file: Pass.

## Full test execution

Command:

`npm run check` (this is what `.taskcheck` runs: lint, prettier, typecheck of all workspaces, root Vitest, renderer `ng test`)

Result:

Pass. Root: 87 files, 4457 tests. Renderer: 104 files, 3469 tests.

## .taskcheck

Result:

Pass. `.taskcheck` is `npm run check`, and its output is recorded above. The sandbox did not allow `sh .taskcheck` itself, so I ran the identical command directly.

## Bugs found

None. Every test passes against HEAD 57cc49ba.

## Coverage

Status: verified (whole-file and changed-line). The CSS and HTML changes are not instrumented by V8. They are covered by the computed-style and class assertions and by the e2e layout checks.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: measured from the provider lcov. The only changed executable TS is the `scalar` getter (editable-value.component.ts lines 74-89). Its executable lines are DA 75, 76, 77, 79, 85 and 87, and all 6/6 are hit (100%). Its branches, BRDA 76 x2 and 77 x7, are all 9/9 hit (100%). `FNDA:323,scalar`. The CR-1 fix is CSS only and did not change the TS counters.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: table-number-wrap; base 887ef551 (merge-base with origin/main, from the parent); HEAD 57cc49ba7a70084710e5483fcc97c73522c27ce3; commits 6bb0ca1b, 64ae0638, 1af13712 and 57cc49ba from `git log 887ef551..HEAD`, cross-checked against the task's touches and the parent's file list.
- Source/test snapshot identifier (including uncommitted inputs), sha256: editable-value.component.ts 3689bc5d84df5e09745ba010392245fcd185bc197a4a622fd2702abe7af8a04f; .css 6f4c20f8f7a2937efdd21ac3ed8ae65508a233978713f45ea1571d4f66993822; .html 9aa0b046e8f36cb3e8e5659850b6f9ef6d5fe5330edefd8508462d2a5f40a55c; editable-value.component.spec.ts e1d7eabcea4c10ce7b87867cf5e82b9e1d3f9bb891afc07bea80277f7cc661ce; json-table.component.spec.ts f37de2b7814cc8795636682b5529c5b89d6f4a058f15a775de3a63211093c139; uncommitted test/e2e/table-number-wrap.e2e.ts 45647e76cb171f2f45065807005b702836b57dafa60257327a0988c5b5efb7a7. The hashes were the same before and after the runs.
- Exact included files; renamed/deleted/excluded files and reasons: included `packages/renderer/src/app/explorer/editable-value/editable-value.component.ts`. Excluded: `.css` and `.html`, which V8 does not instrument (verified by the computed-style tests and the e2e); the spec and e2e files, which are tests; and the reviews/ PNGs, which are artifacts. No renames or deletions.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with v8 coverage through `ng test`, run in `packages/renderer`: `npx ng test --coverage --coverage-include='src/app/explorer/editable-value/editable-value.component.ts' --include='src/app/explorer/editable-value/**/*.spec.ts' --include='src/app/explorer/json-table/**/*.spec.ts'`
- Run start/completion time and exit status: started 07:18:12 +01:00, report written 07:18:14 +01:00. 2 files and 54 tests passed, with no error output.
- Generated report paths and report hashes/run identifier: `packages/renderer/coverage/renderer/lcov.info` (sha256 7c780fdbf71935121a43e2cf54353e491fc7434309efa9acafb587b84d698a5a) and `coverage-summary.json` (sha256 08cfe93e1bcef9ded379c6c75de84bb36c9b9c5c167130c6863f6a03a2dfa68e). Both have mtime 2026-11-17 07:18:14, during this run.
- Evidence outputs are fresh and inputs stayed unchanged: yes.
- Final run after latest test additions and production fixes: yes. It ran on HEAD 57cc49ba, which includes the CR-1 fix. This round's test additions are e2e-only and do not feed V8 unit coverage.

Values below use covered/total (percentage).

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/explorer/editable-value/editable-value.component.ts` | 64/80 (80%) | 54/69 (78.26%) | 19/27 (70.37%) | 54/66 (81.81%) |

The aggregate covers this single file. No TS file is unmeasured. The CSS and HTML files are excluded for the reason given above.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `editable-value.component.ts`: `choiceIndex`/`choiceLabel`, `onChoice`, the `onTypeChange` catch path, `commitBson`, `commitString`, `commitBoolean`, the branches in the commit helpers | Pre-existing schema-choice and edit-commit code. This task does not change it, and it is not part of the criteria. | Left uncovered in this scoped run: outside the task scope (other renderer specs may cover it). |
| `scalar` getter (74-89) | AC1/AC2 classification | Fully covered (6/6 lines, 9/9 branches). |

## Unable to test

- CR-1 with a real long scalar in the running app: no scalar BSON value over 60ch can be put in front of the table from a real server. A DBPointer inserted as `$dbPointer` EJSON shows up as a DBRef sub-document, and the other scalar types (dates, UUIDs, numbers) are shorter than 60ch. The fixer's computed-style unit test covers CR-1, and the e2e `overflowingScalars` guard covers the general no-overflow layout rule. No follow-up is needed unless the backend starts producing DBPointer leaves.
- Real layout line counts in the unit tests: the unit tests assert classes and computed `white-space`/`overflow-wrap`/`max-width`. The measured line boxes are covered by the e2e, which ran and passed.
- Visual content of the committed screenshots (AC3): a human or the reviewer has to compare them. This round did not change the seed data or the screenshot steps.

## Summary

Tests added and all validation passed. Tests and task-scoped coverage are sufficient; no production defects found.

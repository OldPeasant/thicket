# Test Report

Date: 2026-11-17

Task: raw-editor - M1: Raw editor in shell syntax and EJSON

Scope: base `60c8625c067dfcc3a145ef6e54293ea0b6662c9d` .. HEAD `1cb45a93e9d767dfb59d35289e282f3cc5f6c557` (branch `main`). Task-owned code commits: `8c61ad5` (implementation), `278d8ae` (first test-writer pass specs, reports), `1cb45a9` (fixer: CR-1 fix in `raw-editor.ts` plus regression spec, `fixes.md`). This is the second test-writer pass, on the final revision after the fix. Uncommitted at measurement time: the two spec files changed in this pass (listed below), and `reviews/raw-editor/review.md`, which another helper changed and this pass did not touch.

Requirements:
- `tasks/raw-editor.md` acceptance criteria and recorded assumptions (raw editor per document in the collection list view; Apply records via `DocumentEdits.edit`; changed or missing `_id` refused; errors shown on Apply or format switch and cleared on typing; no `eval`/`new Function`)
- Finding CR-1 (`reviews/raw-editor/review.md`) and its fix (`reviews/raw-editor/fixes.md`): a reused editor that gets another document (different `_id`, or another object when there is no `_id`) shows that document and drops the previous text, its unapplied state and its error. A re-query with the same `_id` keeps unapplied text. The format choice is kept.
- `docs/QUALITY.md`, `docs/ARCHITECTURE.md` ("Coverage"), `AGENTS.md`
- Existing conventions in `packages/renderer/src/app/raw-editor/*.spec.ts` (Vitest via `ng test`, zoneless TestBed, `FakeThicketBridge`, `installJsdomLayoutStubs()`)

## Test files changed

This pass:
- `packages/renderer/src/app/raw-editor/raw-editor.spec.ts` (3 tests added)
- `packages/renderer/src/app/raw-editor/raw-editor-collection.spec.ts` (1 test added)

First pass (already committed in `278d8ae`): `raw-text.spec.ts` (new), `raw-editor.spec.ts`, `raw-editor-collection.spec.ts`.

## Tests added or updated

Count this pass: 4 (all four are new; no existing test was changed, weakened, skipped or deleted). Total across both passes: 27 added by the test-writer, plus 1 regression spec added by the fixer.

What the fixer's regression spec ("shows another document instead of keeping unapplied text of the previous one") already covers: a different `_id` replaces dirty text and an unplaced error (no diagnostics, Apply disabled), and a new object with the same `_id` keeps the unapplied text. Gaps it left, now covered:
- `raw-editor.spec.ts` "keeps the chosen format when another document comes in": in EJSON with dirty text, a new document is printed in EJSON, the EJSON button stays pressed and the text is not dirty. Applying edited text after that is recorded for the new document, and the previous document stays unchanged.
- `raw-editor.spec.ts` "shows the unsaved edits of a document that comes in": the new document is shown with its session edits (`edits.current`), not as it was loaded.
- `raw-editor.spec.ts` "shows another document without _id instead of the unapplied text of the previous one": the no-`_id` identity path (`documentKey(doc) ?? doc`). Dirty text on a document without `_id` is replaced by another document without `_id`. Dirty text on that document is then replaced when a document with an `_id` comes in, and the no-`_id` message goes away. Nothing is recorded.
- `raw-editor-collection.spec.ts` "shows each row's own document, not another's unapplied text, when the rows change order": opens Raw on both rows, makes row 0 dirty, re-runs the query with the rows answered in reverse order, then checks that each row shows its own document, is not dirty, shows no error and has no recorded edits. Note: while writing this test I checked whether row 0 keeps its editor instance across the re-query, and it does not: the `EditorView` is destroyed and created again. So this test protects the user-visible behavior, but in this scenario it would also pass without the fix. The component-level specs above (host `doc` signal changed on the same instance) are the ones that exercise the fix.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1a: toggle preserves content | `format toggle` suite in `raw-editor.spec.ts`; `raw-text.spec.ts` "reads its own shell/ejson text back losslessly" | `cd packages/renderer && npx ng test --include='src/app/raw-editor/**/*.spec.ts'` | Pass |
| AC1b: syntax error highlighted at line/column | `syntax errors` suite in `raw-editor.spec.ts`; `raw-text.spec.ts` "error places" | same | Pass |
| AC1c: apply updates the model | `apply` suite in `raw-editor.spec.ts`; `raw-editor-collection.spec.ts` (apply -> change count -> Save `$set` diff, projection -> partial, per-document toggle, no `_id`, read-only) | same | Pass |
| CR-1: a reused editor shows the new document (fix in `1cb45a9`) | fixer's "shows another document instead of keeping unapplied text of the previous one"; added: "keeps the chosen format when another document comes in", "shows the unsaved edits of a document that comes in", "shows another document without _id instead of the unapplied text of the previous one", collection "shows each row's own document, not another's unapplied text, when the rows change order" | same | Pass |
| AC2: no `eval`/`new Function` in the editor's bundle path | `no-eval.spec.ts`; ESLint `no-eval`/`no-implied-eval`/`no-new-func` | same; `npm run check` (lint step) | Pass |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/app/raw-editor/**/*.spec.ts'`

Result:

Pass: 4 files, 331 tests. That is the fixer's 327 plus the 4 added in this pass. One intermediate run failed on an assertion I wrote that the collection reuses row 0's `EditorView` across a re-query. It does not, and that is not a requirement, so I removed the assertion and documented the finding above. No production code was changed.

## Full test execution

Command:

`npm run check` at the repository root (eslint `--max-warnings 0`, `prettier --check`, typecheck of all workspaces, root `vitest run`, renderer `ng test`)

Result:

Pass: lint and Prettier clean, typecheck passed, root vitest 53 files / 3160 tests, renderer 68 files / 1932 tests. The renderer tests run last in the `&&` chain.

## .taskcheck

Result:

Pass: `.taskcheck` runs `npm run check` when `package.json` exists, and that run passed on the final snapshot (above). `sh .taskcheck` was not run separately.

## Bugs found

None. All added tests pass against HEAD `1cb45a9`.

Observation, not a defect against any requirement: the fix replaces the text with an `External`-annotated CodeMirror transaction, which stays in the editor's own undo history. After the input changes to another document, Ctrl+Z inside the editor can bring back the previous document's text. Apply then refuses it because the `_id` differs, so nothing wrong is recorded. Following the document's edits already worked this way before the fix. No test was added because no requirement defines editor-local undo across documents. The parent can decide whether this is worth a follow-up.

## Coverage

Status: verified (fresh run on the final revision `1cb45a9` plus this pass's specs; production code unchanged during the run).

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured as a separate counted metric. The lcov report has no `DA` line with a zero hit count in any scoped file, so no added or modified executable line, including the CR-1 lines `raw-editor.ts:188-202`, is uncovered. All 61 branches of `raw-editor.ts` were hit, including both sides of `documentKey(doc) ?? doc`, `owner !== undefined && identity !== owner` and `if (otherDocument)`.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `raw-editor`; base `60c8625c067dfcc3a145ef6e54293ea0b6662c9d` (from the parent); HEAD `1cb45a93e9d767dfb59d35289e282f3cc5f6c557`; task commits `8c61ad5`, `278d8ae`, `1cb45a9` (from `git log 60c8625..HEAD`; the other commits in that range belong to other tasks: heartbeats, claims, io-basic-backend). Production scope as in the first pass. The fix changed only `raw-editor.ts`.
- Source/test snapshot identifier (including uncommitted inputs): production = HEAD `1cb45a9` with no uncommitted production changes. sha256 (first 16 hex digits), identical before the focused run and after `npm run check`: `raw-editor.ts` 8860ae0a93cc76df, `raw-text.ts` 3f60a1e4a0dfcca5, `raw-editor.spec.ts` 0afdbf4a2ddfa53b, `raw-editor-collection.spec.ts` dfae980b2c70ae5b, `raw-text.spec.ts` c8583073bef7ff93, `no-eval.spec.ts` 4055b97217dab229.
- Exact included files; renamed/deleted/excluded files and reasons: included `packages/renderer/src/app/raw-editor/raw-editor.ts`, `raw-text.ts`, `index.ts` (re-exports only, 0 counters), and `packages/renderer/src/app/collection/collection-view.ts`. Excluded: `raw-editor/testing.ts` (test helper), `*.spec.ts`, `*.css` (styles), `collection-view.html` (template, exercised through the component), `eslint.config.mjs`, `package.json`, `package-lock.json` (configuration), docs. No renames or deletions.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with `@vitest/coverage-v8` via Angular `ng test`; cwd `packages/renderer`; `npx ng test --coverage --coverage-include='src/app/raw-editor/raw-editor.ts' --coverage-include='src/app/raw-editor/raw-text.ts' --coverage-include='src/app/raw-editor/index.ts' --coverage-include='src/app/collection/collection-view.ts' --include='src/app/raw-editor/**/*.spec.ts' --include='src/app/collection/collection-view.spec.ts' --include='src/app/document/document-editing.spec.ts' --include='src/app/document/table-editing.spec.ts'`. Same command as the first pass. 7 test files matched: the four raw-editor specs plus the existing specs that render `CollectionView`.
- Run start/completion time and exit status: started 2026-11-17 01:55:56 +0100, reports written 01:56:05 +0100. 7 files / 389 tests passed, and the coverage summary was printed (success).
- Generated report paths and report hashes/run identifier: `packages/renderer/coverage/renderer/lcov.info` sha256 e3fbd3e68120bd02c669a685280d905e673872154b4dd0a0a018f63c2458122e; `packages/renderer/coverage/renderer/coverage-summary.json` sha256 569bae1bdbcfd8f543fbaab30369ec29bbae019a6209c468d54191b8fd809f18 (Git-ignored).
- Evidence outputs are fresh and inputs stayed unchanged: the report mtimes (01:56:05) fall inside the run, which began after the last spec edit. Input hashes were the same before and after.
- Final run after latest test additions and production fixes: yes (after the fixer's `1cb45a9` and after this pass's last spec edit).

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/raw-editor/raw-editor.ts` | 167/168 (99.40%) | 61/61 (100%) | 28/29 (96.55%) | 141/141 (100%) |
| `packages/renderer/src/app/raw-editor/raw-text.ts` | 18/18 (100%) | 12/14 (85.71%) | 6/6 (100%) | 18/18 (100%) |
| `packages/renderer/src/app/raw-editor/index.ts` | N/A (0/0) | N/A (0/0) | N/A (0/0) | N/A (0/0) |
| `packages/renderer/src/app/collection/collection-view.ts` | 192/199 (96.48%) | 103/122 (84.43%) | 55/56 (98.21%) | 161/161 (100%) |
| Aggregate (summed counters over the 4 files above; exclusions listed in Evidence) | 377/385 (97.92%) | 176/197 (89.34%) | 89/91 (97.80%) | 320/320 (100%) |

Previous pass (revision `7ee020c`, before CR-1): `raw-editor.ts` 158/159 statements, 55/55 branches, 28/29 functions, 132/132 lines. The fix added 9 statements, 6 branches and 9 lines, and all of them are covered.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `raw-editor.ts:131` function `(anonymous_25)` (the 1 uncovered statement and function) | Compiler-generated function of the `viewChild.required('host')` signal query. Every rendering test uses the host element. | Justified gap: not reachable as separate behavior |
| `raw-text.ts:63` branch 1 (`String(error)` for a throw that is not an `Error`) | Defensive: core's parsers throw `Error` subclasses | Justified gap: no core path throws a non-Error, so a test would need to mock core |
| `raw-text.ts:67` branch 1 (`json[2] ?? ''`) | Defensive: the regex always captures group 2 | Justified gap: unreachable |
| `collection-view.ts:253` branch 0 (`toggleRaw` with `key === null`) | Guard for a document without `_id` | The UI blocks it with `[disabled]`, and "offers no raw editor for a document without _id" checks that. Justified gap |
| `collection-view.ts` other branches (query, paging, form editing, keyboard) and function `(anonymous_55)` | Existing collection-view behavior that this task did not change | Out of task scope; the whole-file metric includes old code |

## Unable to test

- Whether the collection list actually reuses a `RawEditor` instance for another document (the CR-1 trigger). On a re-query with reordered rows it does not: the editor is recreated. I did not find a list path in the fake-bridge setup that keeps the instance, so the fix is exercised at component level instead (same instance, `doc` input changed). This is not a gap in the fix's tests. The fix protects any consumer that reuses the instance.
- Visual appearance of the theme and the error underline in a real browser: jsdom has no layout. Not required by the criteria.
- The lazy `@defer` chunk split of CodeMirror in the production bundle was not checked with a build. It is not an acceptance criterion.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. The fixer's CR-1 regression spec was correct. This pass added 4 tests for the cases it did not cover: format kept, session edits of the incoming document, documents without `_id`, and the collection-level reorder. The focused run (331 tests), task-scoped coverage (all `raw-editor.ts` lines and branches, including the fix) and `npm run check` (`.taskcheck`) pass on revision `1cb45a9`.

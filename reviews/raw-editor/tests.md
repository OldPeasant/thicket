# Test Report

Date: 2026-11-17

Task: raw-editor - M1: Raw editor in shell syntax and EJSON

Scope: base `60c8625c067dfcc3a145ef6e54293ea0b6662c9d` .. HEAD `7ee020c7d4fb79817f8d6e576f36c0637ea1fdb6` (branch `main`, one task commit). The parent named the task commit `6893d63`; HEAD `7ee020c` is the same change rebased (`git patch-id` of both is `cf0db97c26f0cd4ed719e5becd04b1b393f2ea27`). Uncommitted at measurement time: only the test-file changes listed below (and `reviews/raw-editor/review.md` from the code-reviewer, untouched).

Requirements:
- `tasks/raw-editor.md` acceptance criteria and recorded assumptions (raw editor per document in the collection list view; Apply records via `DocumentEdits.edit`; changed/missing `_id` refused; errors shown on Apply/format switch and cleared on typing; EJSON value errors have no position; no-eval spec walks the import graph plus ESLint rules)
- `docs/QUALITY.md`, `docs/ARCHITECTURE.md` ("Coverage", "Shell syntax"), `AGENTS.md`
- Existing conventions in `packages/renderer/src/app/raw-editor/*.spec.ts` and `collection/collection-view.spec.ts` (Vitest via `ng test`, zoneless TestBed, `FakeThicketBridge`, `installJsdomLayoutStubs()`)

## Test files changed

- `packages/renderer/src/app/raw-editor/raw-text.spec.ts` (new)
- `packages/renderer/src/app/raw-editor/raw-editor.spec.ts` (tests added)
- `packages/renderer/src/app/raw-editor/raw-editor-collection.spec.ts` (tests added; `docs.find` rows made configurable per test)

## Tests added or updated

Count: 23 (13 in `raw-text.spec.ts` incl. `it.each` expansions, 7 in `raw-editor.spec.ts`, 3 in `raw-editor-collection.spec.ts`). No existing test was changed in meaning, weakened, skipped or deleted.

Added:
- `raw-text.spec.ts`: prints shell/EJSON with 2-space indent; reads its own shell/EJSON text back losslessly (all BSON types); refuses empty/whitespace text (both formats); refuses an EJSON non-document top level; shell error place from the parser with the reason free of the place; JSON reader position turned into line/column with a capitalized reason; EJSON columns counted in UTF-16 code units (surrogate pair before the error, matches CodeMirror offsets); CRLF counted as one line break; EJSON value errors unplaced; `describeRawError` with and without a place / `unplacedError`.
- `raw-editor.spec.ts`: keeps unapplied EJSON changes when switching back to shell syntax; does not switch unreadable EJSON text and marks its place (line 3, column 10); clicking the format already shown changes nothing (text, error, dirty state kept); a successful switch clears an earlier unplaced (`_id`) error; marks an error in empty text without a crash (line 1, column 1, diagnostic within bounds); applies text already in printed form and keeps it (covers `setText` no-op path); applying the same text twice keeps one recorded state.
- `raw-editor-collection.spec.ts`: a projected page passes `partial = true` to the editor; Raw opens per document and toggles back to the form (`partial = false` without projection); the Raw toggle is disabled for a document without `_id` and opens no editor.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1a: toggle preserves content | `format toggle` suite in `raw-editor.spec.ts` (existing: switches to EJSON and back; keeps unapplied changes; round-trips every BSON type; does not switch unreadable text; added: keeps unapplied EJSON changes back to shell; does not switch unreadable EJSON; same-format click no-op; successful switch clears unplaced error); `raw-text.spec.ts` "reads its own shell/ejson text back losslessly" | `cd packages/renderer && npx ng test --include='src/app/raw-editor/**/*.spec.ts'` | Pass |
| AC1b: syntax error highlighted at line/column | `syntax errors` suite in `raw-editor.spec.ts` (existing: shell error at line/column with diagnostic, aria and cursor; EJSON error at line/column; value errors unplaced; error at end of text; non-document top level; clears on typing; added: error in empty text); `raw-text.spec.ts` "error places" (UTF-16 columns, CRLF lines, capitalized reason) | same | Pass |
| AC1c: apply updates the model | `apply` suite in `raw-editor.spec.ts` (existing: records the edit, EJSON apply, Ctrl+Enter, partial, changed/missing `_id`, undo/redo, unapplied text vs. outside edits, reset, read-only, no `_id`; added: already-printed text, apply twice); `raw-editor-collection.spec.ts` (existing: apply -> change count -> Save sends `$set` diff; read-only profile; added: projection -> partial, per-document toggle, no `_id` -> toggle disabled) | same | Pass |
| AC2: no `eval`/`new Function` in the editor's bundle path | `no-eval.spec.ts` (existing: resolves every import, one test per file of the graph, Ajv control, pattern self-test); ESLint `no-eval`/`no-implied-eval`/`no-new-func` via `npm run lint` | `cd packages/renderer && npx ng test --include='src/app/raw-editor/**/*.spec.ts'`; `npm run check` (lint step) | Pass |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/app/raw-editor/**/*.spec.ts'`

Result:

Pass: 4 files, 323 tests (one earlier run failed on two of my own new assertions that assumed core's EJSON printer expands `{"$oid": ...}` over several lines; it keeps type wrappers inline. The tests were corrected, not the code.) `raw-editor-collection.spec.ts` alone: 5 passed.

## Full test execution

Command:

`cd packages/renderer && npx ng test` and `npm run check` (repo root: eslint + prettier, typecheck of all workspaces, root `vitest run`, renderer `ng test`)

Result:

Pass: renderer 68 files / 1927 tests; root vitest 48 files / 2989 tests; lint, Prettier and typecheck passed (renderer tests run last in the `&&` chain and passed). The first `npm run check` failed on Prettier formatting of my two new/edited spec files; I ran `npx prettier --write` on those spec files only and re-ran: pass.

## .taskcheck

Result:

Pass: `.taskcheck` is `npm run check` when `package.json` exists; `npm run check` passed on the final test snapshot (see above).

## Bugs found

None. No production defect was found; all added tests pass against HEAD `7ee020c`.

## Coverage

Status: verified (final run after the last test edit and Prettier formatting; production code unchanged throughout).

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured as a separate counted metric. Every executable line in all scoped files was hit (the lcov report has no line entry with a zero hit count), so no added/modified executable line is uncovered; branches on changed lines are listed below.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `raw-editor`; base `60c8625c067dfcc3a145ef6e54293ea0b6662c9d` (from the parent); HEAD `7ee020c7d4fb79817f8d6e576f36c0637ea1fdb6` = parent's task commit `6893d63` rebased (equal `git patch-id`); file scope from `git diff --stat 60c8625..HEAD` checked against the parent's changed-file list.
- Source/test snapshot identifier (including uncommitted inputs): production = HEAD `7ee020c` (no uncommitted production changes, `git status` before and after). Spec sha256 before and after the final run: `no-eval.spec.ts` 4055b972…94fce, `raw-editor-collection.spec.ts` 581db8b1…b8876, `raw-editor.spec.ts` 0c22d3c4…6477ea, `raw-text.spec.ts` c8583073…15130.
- Exact included files; renamed/deleted/excluded files and reasons: included `packages/renderer/src/app/raw-editor/raw-editor.ts`, `raw-text.ts`, `index.ts` (re-exports only, 0 executable counters), `packages/renderer/src/app/collection/collection-view.ts`. Excluded: `raw-editor/testing.ts` (test helper), `*.spec.ts`, `raw-editor.css`, `collection-view.css` (styles), `collection-view.html` (template; its bindings are exercised by `raw-editor-collection.spec.ts`, v8 reports it under the component's compiled template functions), `eslint.config.mjs`, `package.json`, `package-lock.json` (configuration), `docs/ARCHITECTURE.md` (docs). No renames or deletions.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with `@vitest/coverage-v8` ^5.1.0 via Angular `ng test`; cwd `packages/renderer`; `npx ng test --coverage --coverage-include='src/app/raw-editor/raw-editor.ts' --coverage-include='src/app/raw-editor/raw-text.ts' --coverage-include='src/app/raw-editor/index.ts' --coverage-include='src/app/collection/collection-view.ts' --include='src/app/raw-editor/**/*.spec.ts' --include='src/app/collection/collection-view.spec.ts' --include='src/app/document/document-editing.spec.ts' --include='src/app/document/table-editing.spec.ts'` (the two `document/*` specs are the existing specs that render `CollectionView`; `collection-view.ts` is whole-file, so pre-existing tests count toward it).
- Run start/completion time and exit status: started 2026-11-17 01:49:08 +0100, report written 01:49:18 +0100; 8 files / 384 tests passed, coverage summary printed (success).
- Generated report paths and report hashes/run identifier: `packages/renderer/coverage/renderer/lcov.info` sha256 2cdc5b3399b8a5cd48e6baf7ae46543adcae8cc9acf5c34dded0d37c6c9192e6; `packages/renderer/coverage/renderer/coverage-summary.json` sha256 3744f7f989629f17904834ab9ae8614f10b9ab0bb74a4dffe1dd5b6f400e249f (Git-ignored).
- Evidence outputs are fresh and inputs stayed unchanged: report mtimes 01:49:18 fall inside the run; spec hashes identical before and after; production files untouched.
- Final run after latest test additions and production fixes: yes (no production fixes were made).

Baseline before new tests (parent's command, `raw-editor.ts` + `raw-text.ts`, raw-editor specs only): statements 173/177, branches 65/69, functions 34/35, lines 148/150. Uncovered then: `raw-editor.ts:222` (same-format switch), `raw-editor.ts:290-292` (`setText` no-op), both now covered by added tests.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/raw-editor/raw-editor.ts` | 158/159 (99.37%) | 55/55 (100%) | 28/29 (96.55%) | 132/132 (100%) |
| `packages/renderer/src/app/raw-editor/raw-text.ts` | 18/18 (100%) | 12/14 (85.71%) | 6/6 (100%) | 18/18 (100%) |
| `packages/renderer/src/app/raw-editor/index.ts` | N/A (0/0) | N/A (0/0) | N/A (0/0) | N/A (0/0) |
| `packages/renderer/src/app/collection/collection-view.ts` | 192/199 (96.48%) | 103/122 (84.42%) | 55/56 (98.21%) | 161/161 (100%) |
| Aggregate (summed counters over the 4 files above; exclusions listed in Evidence) | 368/376 (97.87%) | 170/191 (89.00%) | 89/91 (97.80%) | 311/311 (100%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `raw-editor.ts:131` function `(anonymous_25)` | Compiler-generated function of the `viewChild.required('host')` signal query; the host element is used by every rendering test | Justified gap: not reachable as separate behavior |
| `raw-text.ts:63` branch 1 (`String(error)` for a non-`Error` throw) | Defensive: core's parsers throw `Error` subclasses | Justified gap: no core path throws a non-Error; a test would need to mock core |
| `raw-text.ts:67` branch 1 (`json[2] ?? ''`) | Defensive: the regex always captures group 2 | Justified gap: unreachable |
| `collection-view.ts:253` branch 0 (`toggleRaw` with `key === null`) | Task code: guard for a document without `_id` | Defended in the UI by `[disabled]`; test "offers no raw editor for a document without _id" checks the toggle is disabled and no editor opens. The method guard itself is unreachable through the UI. Justified gap |
| `collection-view.ts:145,146,147,157,179,182,209,277,278,301,335,368,374,375,386,395,397,412` (one branch each) and function `(anonymous_55)` | Pre-existing collection-view behavior (query, paging, form editing, keyboard), not changed by this task | Out of task scope; whole-file metric includes old code |

## Unable to test

- Visual appearance of the CodeMirror theme/highlight colors and the error underline in a real browser: jsdom has no layout (the specs check the `.cm-lintRange-error` element, diagnostics and aria attributes instead). Not required by the criteria; no follow-up needed for this task.
- The lazy `@defer` chunk split of CodeMirror in the production bundle was not checked by a build in this run (not an acceptance criterion; the no-eval spec follows the source import graph).

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. 23 tests added (raw-text unit tests, toggle/error/apply edge cases, collection-view integration of the Raw toggle and projection-partial); focused, full renderer and `npm run check` (`.taskcheck`) runs pass.

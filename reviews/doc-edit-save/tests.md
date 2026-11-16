# Test Report

Date: 2026-11-17

Task: doc-edit-save - M1: Edit session and explicit save (round 2)

Scope: `git diff b045ba5f0bde20b67fe9d0a1e97179a3ed1e5e3f..84289ac59d7acfa2ca6943735438540c5021a083` on `main`
(task commits 80c81da, 2607ecc, 4678ee5, e58a8ce, 673e56e, 83dc860, 84289ac; base and range supplied by the
parent and checked with `git log b045ba5..HEAD`). Round-2 focus: the CR-1..CR-6/TW-1 fixes (673e56e) and the
`partial` flag (83dc860). Uncommitted at measurement time: only the three test files listed below (no
production changes).

Requirements:
- `tasks/doc-edit-save.md` acceptance criteria and its ASSUMPTION notes
- `reviews/doc-edit-save/review.md` (CR-1..CR-6) and `fixes.md` (fix descriptions, residual risk on the projection guard)
- `SPEC.md` / `docs/ARCHITECTURE.md` ("Coverage"), `AGENTS.md`
- Parent instructions (focus on fixes and `partial`, do not duplicate 84289ac tests, keep it small)

## Test files changed

- `packages/renderer/src/app/document/document-actions.service.spec.ts`
- `packages/renderer/src/app/document/edit-bar.spec.ts`
- `packages/renderer/src/app/document/edit-session.spec.ts`

## Tests added or updated

Count: 3 (all new; no existing test changed)

- `DocumentActions > save with a projection active > checks nested paths: refuses a nested container the loaded document has, sends a new one` (CR-1 `hasPath` through nested keys; the 84289ac/673e56e tests only used top-level paths)
- `handleEditKeys > Ctrl+S in a text field: read-only leaves the field alone; no save when nothing was applied or a write started` (CR-3: the deferred save still re-checks `modified()`/`busy()`; read-only does not blur the field)
- `DocumentEdits > rebasing drops pending redo steps of that document only` (TW-1 fix `rebase`: the redo filter was never exercised with a non-empty redo stack; other documents' redo steps stay)

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 Component tests: change count, undo/redo, revert | `document-editing.spec.ts`, `edit-session.spec.ts` (incl. round-1 tests, 84289ac rebase/partial tests, new redo-on-rebase test), `edit-bar.spec.ts` | `cd packages/renderer && npx ng test --include='src/app/document/**/*.spec.ts' --include='src/app/collection/**/*.spec.ts'` | Pass (8 files, 218 tests) |
| AC2 e2e: edit two fields and save; driver query | `test/e2e/document-edit.e2e.ts` (unit side: save path tests in `document-actions.service.spec.ts`) | unit: same as above | Unit: Pass. e2e: Not run: left to the parent per instructions (needs Electron + MongoDB container) |
| AC3 e2e: production confirm with `$set` | `test/e2e/document-edit.e2e.ts`; unit "says nothing when the production confirm dialog is cancelled" | as AC2 | Unit: Pass. e2e: Not run (parent runs it) |
| AC4 Read-only profile: edit controls disabled | `document-editing.spec.ts` "disables every edit control on a read-only profile" (CR-6: asserts the view's own `EditModeService`); `DocumentActions` read-only refusal; `handleEditKeys` read-only Ctrl+S (now also in a text field) | focused command above | Pass |
| CR-1 projection guard (replace / container `$set` refused, scalar/unset/push/new paths sent) | `save with a projection active` block (6 tests incl. new nested-path test); `table-editing.spec.ts` "with a query projection" (4) | focused command above | Pass |
| `partial` flag sticks per document (after projection cleared, undo/redo, rebase) | `edit-session.spec.ts` "partial (edited under a projection)" (5); `DocumentActions` "still refuses ... cleared now", "keeps refusing a later replace after a partial document was saved ..."; `table-editing` "refuses to save a replace edited under a projection, also after it was cleared" | focused command above | Pass |
| CR-2/TW-1 edits during an in-flight save kept; saved version shown during read-back | "keeps an edit made while the save was on its way", "keeps showing the saved version ...", `rebase` tests (3 from 84289ac + new redo test) | focused command above | Pass |
| CR-3 Ctrl+S in a field applies the typed value first | `edit-bar.spec.ts` "applies the value typed ...", new text-field guard test; `document-editing.spec.ts` "saves the value still being typed in a field with Ctrl+S" | focused command above | Pass |
| CR-5 failure prefixes "Not deleted"/"Not inserted" | "says "Not deleted" when the delete fails", "keeps the draft when the insert fails" | focused command above | Pass |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/app/document/**/*.spec.ts' --include='src/app/collection/**/*.spec.ts'`

Result:

Pass: 8 files, 218 tests (also run with coverage, see below).

## Full test execution

Command:

`npm run check` (repo root: eslint + prettier, tsc for all workspaces, root vitest + renderer `ng test`)

Result:

Pass (final run after all three new tests): lint and Prettier pass, typecheck passes, root vitest 48 files / 2920 tests, renderer 60 files / 1455 tests.

## .taskcheck

Result:

Pass. `.taskcheck` runs `npm run check` when `package.json` exists; same run as above.

## Bugs found

None. No production defect found in round 2.

Observation for the parent (not a TW finding, requirement undefined): the CR-1 guard refuses a `$set` of an
object/array at an existing path, but allows a `$set` of a scalar there and a `$unset` of a whole
sub-document (e.g. projection `{ "addr.city": 1 }`, the user turns `addr` into a string or deletes it: hidden
`addr.*` fields go). This matches the documented intent in `overwritesHiddenData` ("`$unset` ... only touch
what the user saw": the user deliberately removed or replaced the whole field) and no test encodes either
choice. Record an assumption if this should stay.

## Coverage

Status: verified

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured (the configured tooling has no changed-line mode; not reconstructed by hand).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: doc-edit-save; base b045ba5f0bde20b67fe9d0a1e97179a3ed1e5e3f; HEAD 84289ac59d7acfa2ca6943735438540c5021a083; commits from the parent, confirmed with `git log b045ba5..HEAD` and `git diff --name-only b045ba5..HEAD -- '*.ts'`.
- Source/test snapshot identifier (including uncommitted inputs): production = HEAD 84289ac (no uncommitted production changes, `git status --short`). Spec sha256: document-actions.service.spec.ts fed3a376a478..., edit-bar.spec.ts 1469dfac33eb..., edit-session.spec.ts c4634f495593..., document-editing.spec.ts 68b521c34635..., table-editing.spec.ts 2f4394618c84..., collection-results.service.spec.ts d978acd39feb..., collection-view.spec.ts 535de8be45be..., query.util.spec.ts e80178dabffe...; identical before and after the run.
- Exact included files; renamed/deleted/excluded files and reasons: included `src/app/document/{edit-session,document-actions.service,edit-bar,document-header,draft-documents,index}.ts`, `src/app/collection/{collection-view,collection-results.service}.ts`. Excluded: `packages/core/package.json` (config only, the `./diff` export, exercised by every renderer import of `@thicket/core/diff`), `collection-view.html`, `document-controls.css` (template/styles; template logic maps into the component `.ts`), spec and e2e files, `reviews/`. No renames or deletions.
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8` with vitest 5.1.0, Node 24.22.1, via `@angular/build:unit-test`; working directory `packages/renderer`; `npx ng test --include='src/app/document/**/*.spec.ts' --include='src/app/collection/**/*.spec.ts' --coverage --coverage-reporters=text --coverage-reporters=json-summary --coverage-reporters=lcov --coverage-include=<each of the 8 files above>`. No test filtered out.
- Run start/completion time and exit status: 2026-11-17T00:37:50+01:00 to 00:38:01+01:00; 8 files / 218 tests passed, exit 0.
- Generated report paths and report hashes/run identifier: `packages/renderer/coverage/renderer/coverage-summary.json` sha256 e9c575d7e2954da6ade5d8ad07c1d097cf47d1b9557be470470d13dcd481685b; `packages/renderer/coverage/renderer/lcov.info` sha256 0f3429ca02d45704c62d8c781817bf20114e439ea320b6038d8bed814ddc84b5 (git-ignored).
- Evidence outputs are fresh and inputs stayed unchanged: yes; report hashes differ from the preceding run (00:37:10, before the edit-session test was added), files written by this run, snapshot hashes unchanged.
- Final run after latest test additions and production fixes: yes (includes all three new tests; production at 84289ac with all fixes and the `partial` change).

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/document/edit-session.ts` | 101/101 (100%) | 39/40 (97.5%) | 33/33 (100%) | 74/74 (100%) |
| `packages/renderer/src/app/document/document-actions.service.ts` | 162/167 (97%) | 71/75 (94.66%) | 42/43 (97.67%) | 137/139 (98.56%) |
| `packages/renderer/src/app/document/edit-bar.ts` | 97/98 (98.97%) | 67/69 (97.1%) | 15/15 (100%) | 79/79 (100%) |
| `packages/renderer/src/app/document/document-header.ts` | 84/88 (95.45%) | 36/44 (81.81%) | 17/17 (100%) | 63/64 (98.43%) |
| `packages/renderer/src/app/document/draft-documents.ts` | 45/45 (100%) | 13/14 (92.85%) | 8/8 (100%) | 29/29 (100%) |
| `packages/renderer/src/app/document/index.ts` | N/A (0/0) | N/A (0/0) | N/A (0/0) | N/A (0/0) |
| `packages/renderer/src/app/collection/collection-view.ts` | 179/183 (97.81%) | 98/116 (84.48%) | 49/50 (98%) | 149/149 (100%) |
| `packages/renderer/src/app/collection/collection-results.service.ts` | 252/256 (98.43%) | 159/166 (95.78%) | 35/35 (100%) | 217/217 (100%) |
| Aggregate (summed counters, 8 files above; excluded: package.json, html, css) | 920/938 (98.08%) | 483/524 (92.17%) | 199/201 (99%) | 748/751 (99.6%) |

Before the round-2 tests the same scope measured 919/938 statements, 483/524 branches, 198/201 functions,
748/751 lines (run 00:37:10; the uncovered function was the redo filter in `rebase`).

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `edit-session.ts:163` (`rebase` redo-stack filter) | TW-1 fix: a saved document's redo steps must not re-apply pre-save edits | Covered now: "rebasing drops pending redo steps of that document only" |
| `edit-session.ts:196` (non-`Error` thrown by `diffDocuments`) | defensive | Justified gap (diff throws `BsonModelError`) |
| `document-actions.service.ts:91` (`clearMessage`) | none: no caller | Justified gap (unused API) |
| `document-actions.service.ts:108` (`idOf(entry.original) === null`) | defensive: entries exist only for documents with `_id` | Justified gap (unreachable) |
| `document-actions.service.ts:334` (`overwritesHiddenData` with `diff.kind === 'none'`) | defensive: `pendingSave` rejects a `none` diff before the guard | Justified gap (unreachable) |
| `document-actions.service.ts:348` (`hasPath` with a non-object intermediate value) | defensive: the diff only builds dotted paths through sub-documents present on both sides | Justified gap; nested-path behavior covered by the new nested-path test |
| `document-actions.service.ts:362` (`parseServerDoc` catch) | defensive: `conflictDetail` already validates `current` | Justified gap; malformed conflict detail covered by an existing test |
| `edit-bar.ts:102,150` (template branches, e.g. "Saving..." label) | cosmetic busy label | Justified gap; busy state covered in DocumentActions tests |
| `document-header.ts:29` (`(no _id)` label) and template branches | display of documents without `_id` | Justified gap (display only) |
| `draft-documents.ts:103` (form emits a non-object) | defensive | Justified gap |
| `collection-view.ts` defensive branches in `tableChanged`/`docChanged`/`toDocument`/`documentChanged` and pre-existing branches (137-302) | unreadable rows, page changed before save completed; pre-existing code | Justified gap / out of task scope (whole-file metric includes them); `docChanged` partial flag covered by `table-editing` projection tests |
| `collection-results.service.ts` (pre-existing branches 204-432) | pre-existing code | Out of task scope; task's `patchDocument` fully covered |

## Unable to test

- AC2/AC3 e2e (`test/e2e/document-edit.e2e.ts`) not run by the test-writer: the parent runs it (Electron + MongoDB container). No e2e or production change in round 2 by me.
- Changed-line coverage: not measured (no tool support configured).

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. Three small tests added for
remaining gaps in the CR-1 nested-path guard, the CR-3 deferred Ctrl+S guards and the TW-1 `rebase` redo
handling; focused suite (218), `npm run check` and `.taskcheck` pass.

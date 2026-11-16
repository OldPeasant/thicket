# Test Report

Date: 2026-11-17

Task: doc-edit-save - M1: Edit session and explicit save

Scope: `git diff 012dcc23789dcf24427a1648cb38503ba4c65431..5a439feb8de6e41f26b31626609e3fb34aa86725 -- packages test`
(task commits 4e3a1a3, 2c5e2f1, 5a439fe on branch `main`; base and commits supplied by the parent worker
and checked against `git log 012dcc2..HEAD`, which lists exactly these three commits). Uncommitted at the time
of measurement: only the test files listed below (no production changes).

Requirements:
- `tasks/doc-edit-save.md` acceptance criteria and its five ASSUMPTION notes (history per tab, change count
  definition, save-all stops at first failure, read-back after save, drafts/clone/table rows, delete always
  confirms, CONFLICT handling)
- `SPEC.md` M1 "Editing and saving" / "Safety" as referenced from the production doc comments
- `docs/ARCHITECTURE.md` "Coverage", `docs/QUALITY.md`, `AGENTS.md`
- Parent instructions (focus list for edit-session, DocumentActions edge cases, tableChanged, patchDocument)

## Test files changed

- `packages/renderer/src/app/document/edit-session.spec.ts` (new)
- `packages/renderer/src/app/document/document-actions.service.spec.ts` (new)
- `packages/renderer/src/app/document/table-editing.spec.ts` (new)
- `packages/renderer/src/app/document/edit-bar.spec.ts` (new)
- `packages/renderer/src/app/collection/collection-results.service.spec.ts` (new `patchDocument` describe block appended)
- `test/e2e/document-edit.e2e.ts` (type-only fix, see TW-2; no runtime change)

## Tests added or updated

Count: 82 (edit-session 22, document-actions 31, table-editing 6, edit-bar 8, collection-results patchDocument 4) plus one type-only change in the e2e file.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 Component tests: change count | existing `document-editing.spec.ts` "counts the changes ..."; new `DocumentEdits` "records an edit ...", "keeps the loaded version as original ...", "clears the modified state when a document is edited back ...", "lists edited documents ... and sums their changes", `pendingSave` (update ops, removed+added field, replace counts changed top-level fields, pure reorder counts at least one, unchanged = 0, `$` field / `_id` change not savable) | `cd packages/renderer && npx ng test --include='src/app/document/**/*.spec.ts'` | Pass |
| AC1 Component tests: undo/redo | existing "undoes and redoes ..."; new `DocumentEdits` "undoes and redoes across documents ...", "keeps at most UNDO_LIMIT (500) edits ...", "starts empty" (no-op undo/redo); `handleEditKeys` (Ctrl/Cmd+Z, Ctrl+Shift+Z, Ctrl+Y, not in text fields, not while busy, Alt ignored) | same | Pass |
| AC1 Component tests: revert | existing "reverts one document ..."; new `DocumentEdits` "discards one document: its edits and its undo and redo steps go ...", "discarding a key without edits ...", "discards everything with discardAll"; `DocumentActions` "drops the conflict once the document is saved, and on revertAll" | same | Pass |
| AC2 e2e: edit two fields and save; driver query | existing `test/e2e/document-edit.e2e.ts` (run by the parent: 3 passed). New unit coverage of the save path: `docs.replace` for top-level reorder, `_id` edit refused, read-back with projection, read-back failure falls back to saved doc, saveAll one update per doc and stopping at first failure, busy guard | unit: same as above. e2e: not re-run by me | Unit: Pass. e2e: Not run by test-writer (needs Electron + MongoDB container; parent's run reported 3 passed). I only changed types in that file, `npm run typecheck` passes |
| AC3 e2e: production confirm with `$set` | existing e2e; new `DocumentActions` "says nothing when the production confirm dialog is cancelled" | as AC2 | Unit: Pass. e2e: Not run by test-writer (see AC2) |
| AC4 Read-only profile: edit controls disabled | existing "disables every edit control on a read-only profile"; new `DocumentActions` "refuses on a read-only profile, sends nothing and keeps the edits"; `handleEditKeys` "swallows Ctrl+S without saving when read-only ..." | `npx ng test --include='src/app/document/**/*.spec.ts'` | Pass |
| ASSUMPTION: CONFLICT keeps edits, marker, server version kept | `DocumentActions` conflicts: changed (current parsed), deleted (current null), malformed detail, drop on save/revertAll | same | Pass |
| ASSUMPTION: delete always asks; removed from page | `DocumentActions` delete: confirm + host notified, already deleted message, cancel keeps edits, no `_id`; `table-editing` "asks before deleting the document of a removed row", "deletes the last document when the last row is removed" | same | Pass |
| ASSUMPTION: drafts (insert empty/copy/clone, table added row, edited in form) | `DocumentActions` drafts (8 tests incl. edited draft inserted, malformed insertedId, insert failure keeps draft, double insert ignored); `table-editing` "turns an added row into a draft", "inserts a draft as edited in its form" | same | Pass |
| Table view edit = edit of that document only | `table-editing` "records an edited row as an edit of that document only" (then Save sends one docs.update) | same | Pass |
| `CollectionResults.patchDocument` | 4 tests: no page, replace at index keeping paging, remove for null, index out of range ignored | `npx ng test --include='src/app/collection/**/*.spec.ts'` | Pass |
| Unsaved edits survive until saved (ordering: edit while save in flight) | `DocumentActions` save "keeps an edit made while the save was on its way" | `npx ng test --include='src/app/document/**/*.spec.ts'` | **Fail** (TW-1) |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/app/document/**/*.spec.ts' --include='src/app/collection/**/*.spec.ts'`

Result:

Fail: 192 passed, 1 failed (`DocumentActions > save > keeps an edit made while the save was on its way`, TW-1). All other new and existing tests pass.

## Full test execution

Command:

`npm run check` (repo root: eslint + prettier, tsc for all workspaces, root vitest + renderer `ng test`)

Result:

Fail. Lint: pass. Typecheck: pass (after the TW-2 type fix; before it, `tsc -p tsconfig.json` failed with TS7053 in `test/e2e/document-edit.e2e.ts`). Root vitest: 48 files, 2920 tests passed. Renderer: 1429 passed, 1 failed (TW-1 only).

## .taskcheck

Result:

Fail. `.taskcheck` runs `npm run check` (see above). The only failure is the TW-1 test, which needs a production fix.

## Bugs found

### Edits made while a save is in flight are silently discarded

Finding ID:

`TW-1`

Test:

`DocumentActions > save > keeps an edit made while the save was on its way` (`packages/renderer/src/app/document/document-actions.service.spec.ts`)

Production source:

`packages/renderer/src/app/document/document-actions.service.ts:130` (`this.edits.discard(key)` after the write resolves) and the following `readBack`, which replaces the shown document with the server version.

Requirement:

Task ASSUMPTION: "Unsaved edits are keyed by _id and survive paging and new queries until saved or reverted." SPEC M1: edits stay local until Save.

Expected behavior:

An edit made after Save was sent (and therefore not part of the sent `$set`) stays as an unsaved edit after the save completes (e.g. the entry's original becomes the saved version, the newer edit remains modified).

Actual behavior:

`save()` captures the pending diff, awaits `docs.update`, then calls `edits.discard(key)` which drops all edits of the document, including the one made during the request, and the read-back overwrites the shown document. In the test the `$set` sent only `total`; the later `qty` edit is lost (`isModified` is false). The JSON form stays editable while a save runs (only Undo/Redo/Save/Revert are disabled), so on a slow connection a user can blur a second field during a save and lose it without any message.

Severity:

Medium

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.`

### Task e2e file fails `npm run typecheck` (test code; fixed in test file)

Finding ID:

`TW-2`

Test:

`test/e2e/document-edit.e2e.ts` (typecheck, not a runtime failure)

Production source:

Not production code. `test/e2e/document-edit.e2e.ts:72` typed the collection with a document type holding only `_id: number`, so `after?.['total']` etc. failed with TS7053 under `tsc -p tsconfig.json`, making `npm run check`/`.taskcheck` fail at HEAD 5a439fe.

Requirement:

`.taskcheck` must pass (AGENTS.md).

Expected behavior:

The e2e file typechecks.

Actual behavior:

12 TS7053 errors. Fixed by the test-writer with a type-only `StoredOrder` interface (`_id`, `status`, `total: Decimal128`, `qty: Int32`) used by `stored()`; no runtime change. The e2e was not re-run after this change (types only); `npm run typecheck` now passes.

Severity:

Low

Fix required:

No further production fix; parent should include the test-file change in the task.

## Coverage

Status: partial-failed for the full test set (Vitest writes no report when a test fails: the coverage directory was left empty); verified for the run that excludes only the TW-1 test by name (diagnostic, disclosed below).

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured (the tooling has no changed-line mode; not reconstructed by hand).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: doc-edit-save; base 012dcc23789dcf24427a1648cb38503ba4c65431; HEAD 5a439feb8de6e41f26b31626609e3fb34aa86725; commits 4e3a1a3, 2c5e2f1, 5a439fe and scope `packages test` supplied by the parent and confirmed with `git log`/`git diff --stat`.
- Source/test snapshot identifier (including uncommitted inputs): production = HEAD 5a439fe (no uncommitted production changes, `git status`). Test files sha256: document-actions.service.spec.ts 8e6dec36ead1..., edit-bar.spec.ts dadf12ecbe2e..., edit-session.spec.ts f446a14d90c5..., table-editing.spec.ts 5f8e77b44e7c..., document-editing.spec.ts 2ae5b5367818... (committed), collection-results.service.spec.ts d978acd39feb..., document-edit.e2e.ts dd3d52fcb9e2... (not part of the coverage run). Hashes identical before and after the run.
- Exact included files; renamed/deleted/excluded files and reasons: included `src/app/document/{edit-session,document-actions.service,edit-bar,document-header,draft-documents,index}.ts`, `src/app/collection/{collection-view,collection-results.service}.ts`. Excluded: `packages/core/package.json` (config only, the `./diff` export; exercised by every renderer import of `@thicket/core/diff`), `collection-view.html` and `document-controls.css` (templates/styles; V8 coverage maps template logic into the component `.ts`), spec and e2e files. No renames or deletions.
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8` 5.1.0, vitest 5.1.0, Node 24.22.1, via `@angular/build:unit-test`. Working directory `packages/renderer`. Command: `npx ng test --include='src/app/document/**/*.spec.ts' --include='src/app/collection/**/*.spec.ts' --filter='^(?!.*keeps an edit made while the save was on its way)' --coverage --coverage-reporters=text --coverage-reporters=json-summary --coverage-reporters=lcov --coverage-include='src/app/document/edit-session.ts' --coverage-include='src/app/document/document-actions.service.ts' --coverage-include='src/app/document/edit-bar.ts' --coverage-include='src/app/document/document-header.ts' --coverage-include='src/app/document/draft-documents.ts' --coverage-include='src/app/document/index.ts' --coverage-include='src/app/collection/collection-view.ts' --coverage-include='src/app/collection/collection-results.service.ts'`. The `--filter` excludes only the TW-1 test from this measurement run; the test itself stays in the suite and fails there.
- Run start/completion time and exit status: 2026-11-17T00:20:41+01:00 to 00:20:54+01:00; 8 files passed, 192 tests passed, 1 skipped by the filter; no failures. The same command without `--filter` (00:16:27) failed on TW-1 and produced no report.
- Generated report paths and report hashes/run identifier: `packages/renderer/coverage/renderer/coverage-summary.json` sha256 98e396bc93c23c5d0325a1b3859c0b473acb693989faefa312272034cad1608b; `packages/renderer/coverage/renderer/lcov.info` sha256 c9e7434b34e105b4b2d9739c8dab15afd995f6d6116d2d7660c292a572a3302d (both written 00:20:54, git-ignored).
- Evidence outputs are fresh and inputs stayed unchanged: yes; the coverage directory is cleaned by the provider at the start of each run (observed empty after the failed run), report mtimes match this run, snapshot hashes unchanged.
- Final run after latest test additions and production fixes: yes for the latest tests; no production fixes have been made yet (TW-1 open). After the fixer changes `document-actions.service.ts`, coverage and tests must be re-run.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/document/edit-session.ts` | 90/90 (100%) | 33/34 (97.05%) | 28/28 (100%) | 68/68 (100%) |
| `packages/renderer/src/app/document/document-actions.service.ts` | 142/145 (97.93%) | 55/57 (96.49%) | 38/39 (97.43%) | 120/122 (98.36%) |
| `packages/renderer/src/app/document/edit-bar.ts` | 90/91 (98.9%) | 62/64 (96.87%) | 14/14 (100%) | 73/73 (100%) |
| `packages/renderer/src/app/document/document-header.ts` | 84/88 (95.45%) | 36/44 (81.81%) | 17/17 (100%) | 63/64 (98.43%) |
| `packages/renderer/src/app/document/draft-documents.ts` | 45/45 (100%) | 13/14 (92.85%) | 8/8 (100%) | 29/29 (100%) |
| `packages/renderer/src/app/document/index.ts` | N/A (0/0) | N/A (0/0) | N/A (0/0) | N/A (0/0) |
| `packages/renderer/src/app/collection/collection-view.ts` | 178/182 (97.8%) | 98/116 (84.48%) | 49/50 (98%) | 148/148 (100%) |
| `packages/renderer/src/app/collection/collection-results.service.ts` | 252/256 (98.43%) | 159/166 (95.78%) | 35/35 (100%) | 217/217 (100%) |
| Aggregate (summed counters, 8 files above; excluded: package.json, html, css) | 881/897 (98.21%) | 456/495 (92.12%) | 189/191 (98.95%) | 718/721 (99.58%) |

Before the second round of tests (handleEditKeys, draft edited in form, malformed insertedId) the same scope measured 870/897 statements, 447/495 branches, 187/191 functions, 713/721 lines.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `document-actions.service.ts:90` (`clearMessage`) | none: the method has no caller in the codebase | Justified gap (unused API); not tested |
| `document-actions.service.ts:107` (`idOf(entry.original) === null`) | defensive: an entry exists only for documents with an `_id` | Justified gap (unreachable) |
| `document-actions.service.ts:318-320` (`parseServerDoc` catch) | defensive: `conflictDetail` already validates `current` as EJSON | Justified gap; malformed detail path covered by "still reports a conflict whose detail is malformed" |
| `document-actions.service.ts:333` (`labelText` catch) | malformed external response | Covered now: "shows an inserted id that is not EJSON as sent by the server" |
| `edit-session.ts:170` (non-`Error` thrown by diff) | defensive: `diffDocuments` throws `BsonModelError` | Justified gap |
| `edit-bar.ts:102,150` (template branches, e.g. "Saving..." label) | busy label while a write runs | Justified gap (cosmetic); busy state itself covered in DocumentActions tests |
| `edit-bar.ts:163-195` (`handleEditKeys` text-field, busy, Alt, Ctrl+S guards) | undo/redo AC, read-only AC | Covered now: `edit-bar.spec.ts` (8 tests) |
| `document-header.ts:28-29` (`(no _id)` label), other template branches | documents without `_id` in the list | Justified gap (display only; DocumentEdits/DocumentActions ignore such documents, tested) |
| `draft-documents.ts:102-103` (`edited`) | draft edited in the form is inserted as edited | Covered now: "inserts a draft as edited in its form"; remaining branch 103 (form emits a non-object) is defensive |
| `collection-view.ts:335,341,342,350,359,361,376` (`tableChanged`/`docChanged`/`toDocument`/`documentChanged` defensive branches: non-object row, unreadable document, key no longer on page) | table edits of unreadable rows; save completing after the page changed | Justified gap (defensive guards); the main add/remove/edit/delete-last paths are covered by `table-editing.spec.ts` |
| `collection-view.ts` other uncovered branches (137-302) and `collection-results.service.ts` (204-432) | pre-existing code outside this task's changes | Out of task scope (whole-file metric includes them) |

## Unable to test

- AC2/AC3 e2e flows were not re-run by the test-writer (Electron + MongoDB container); the parent reported `test/e2e/document-edit.e2e.ts` 3 passed before TW-2's type-only change. Follow-up: parent may re-run the e2e to confirm, though the change cannot affect runtime.
- Changed-line coverage: not measured (no tool support configured).

## Summary

Tests added; production defects were discovered and must be passed to the `fixer` before task completion (TW-1, Medium: edits made during an in-flight save are discarded). `npm run check`/`.taskcheck` fails only on the TW-1 test. TW-2 (e2e typecheck) was fixed in the test file.

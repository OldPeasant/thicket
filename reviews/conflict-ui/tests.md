# Test Report

Date: 2026-11-17

Task: conflict-ui - M1: Conflict resolution view

Scope: base `2a62fc45bc886a9153dc8258561d921c397d2606` .. HEAD `cded8c146d2008bc904fffd938fab0a354f6977c` on `main`
(task commits `98ddde500dbbddaff55bcb61048d36886cfc213d`, `cded8c146d2008bc904fffd938fab0a354f6977c`, supplied by the
parent worker), plus the uncommitted test changes listed below. Production files at HEAD were verified unchanged
(`git diff --quiet HEAD -- <production files>` -> exit 0).

Requirements:
- `tasks/conflict-ui.md` acceptance criteria and its two recorded assumptions (Overwrite semantics, Merge manually
  semantics, projection handling)
- `SPEC.md` M1 "Conflict detection" (side-by-side diff with overwrite / keep server version / merge manually),
  "Safety" (production confirm for every write, read-only disables write UI), demo step 7
- `docs/ARCHITECTURE.md` "Coverage", `docs/QUALITY.md`, `AGENTS.md`

## Test files changed

- `packages/renderer/src/app/document/edit-session.spec.ts`
- `packages/renderer/src/app/document/document-actions.service.spec.ts`
- `packages/renderer/src/app/document/document-editing.spec.ts`
- `packages/renderer/src/app/document/conflict/line-diff.spec.ts`

## Tests added or updated

Count: 40 added (0 existing tests changed or removed)

- `edit-session.spec.ts`, new block "resolve (conflict resolution)" (5): server version becomes the baseline;
  only that document's undo/redo steps are dropped; partial flag kept; unflagged entry for a document without edits;
  equal versions leave it unmodified.
- `document-actions.service.spec.ts`, "conflict resolution" (19) and new "visibleFields" (2): production confirm
  for Overwrite (shows `updateOne`, sends `confirmed: true`); Overwrite cancelled in the confirm dialog (nothing sent,
  no message, conflict and local version kept, not busy); read-only profile refused; Overwrite failing with another
  error keeps conflict and local version; double click / merge while Overwrite runs ignored (deferred promise);
  Overwrite when the server already has the local version; Overwrite after all edits were undone (returns false,
  Keep server still resolves); partial flag sticks after the projection was cleared; re-insert on production asks
  (`insertOne`); re-insert failure (duplicate key) keeps conflict; re-insert read-back failure shows the local
  version; keepServer reads back with the projection; keepServer when `docs.get` fails shows the conflict's server
  version; saveMerged after undo; saveMerged refused for a deleted document and for a document without `_id`;
  saveMerged under a projection unsets a removed loaded field but never a hidden one; saveMerged under a projection
  after undo; `isPartial`; `visibleFields` order/filtering and empty input.
- `document-editing.spec.ts`, "conflict view" (12, through the real `CollectionView`): Insert your version again;
  Keep it deleted removes the document from the page; production confirm, cancel keeps the view, confirm writes;
  read-only disables Overwrite and Merge (READ_ONLY_HINT) but not Keep server; "No differences"; live update of the
  local side on further edits; only Keep server offered after every edit was undone; merge with a changed `_id`
  keeps the editor open with the error; merged save conflicting again shows the newer server version; one view per
  conflicting document; with a query projection only loaded fields are shown/compared and the note is shown;
  TW-1 regression test (fails, see "Bugs found").
- `line-diff.spec.ts` (2): uneven runs pair as changed then gap rows; moved/repeated lines keep order and the LCS.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: e2e reproduces demo step 7, external change between load and save -> conflict view appears | `conflict.e2e.ts` "external change between load and save shows the conflict view; Overwrite writes the local version" (existing, not changed) | `npm run test:e2e -- test/e2e/conflict.e2e.ts` (repo root, Electron + MongoDB container) | Pass (2 passed) |
| AC2: Overwrite writes the local version (incl. new conflict check, re-insert of a deleted doc, production confirm, cancel, read-only, failures, busy) | existing "overwrite ..." tests plus new service tests listed above, UI "Overwrite ...", "asks before Overwrite on a production profile ...", "Insert your version again ...", "disables Overwrite and Merge on a read-only profile ...", e2e test 1 | `cd packages/renderer && npx ng test --include='src/app/document/**/*.spec.ts' --include='src/app/collection/**/*.spec.ts'`; e2e command above | Pass |
| AC2: Keep server discards local edits (incl. read-back failure, projection, deleted doc, after undo) | existing "keepServer ..." tests, new "keepServer reads ... projection", "keepServer shows the server version from the conflict when it cannot be read back", UI "Keep it deleted ...", "offers only Keep server version once every edit was undone", e2e test 2 | same as above | Pass |
| AC2: Merge manually saves the merged doc (incl. _id rule, projection, conflict again, after undo) | existing "saveMerged ..." / UI merge tests, new saveMerged service tests, UI "keeps the merge editor open when the merged document changes the _id", "shows the newer server version when the merged save conflicts again", e2e test 2 | same as above | Pass |
| Assumption: with a projection only loaded top-level fields are compared, hidden fields neither shown nor unset | "overwrite with a projection ...", "overwrite of a document edited under a since-cleared projection ...", "saveMerged with a projection ...", UI "with a projection compares only the loaded fields and says so" | renderer unit command above | Pass |
| `DocumentEdits.resolve` contract | "resolve (conflict resolution)" block | renderer unit command above | Pass |
| Side-by-side line diff (LCS) | `diffLines` tests | renderer unit command above | Pass |
| SPEC "reloads the server version" / view consistent with the save message: an unreadable conflict detail must not be shown and resolved as a deletion | "does not claim the document was deleted when the conflict detail is malformed" | renderer unit command above | Fail (TW-1) |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/app/document/**/*.spec.ts' --include='src/app/collection/**/*.spec.ts'`

Result:

Fail: 9 files, 280 tests, 279 passed, 1 failed (TW-1, a legitimate requirement test, kept failing on purpose).

`npm run test:e2e -- test/e2e/conflict.e2e.ts` (repo root): Pass, 2 passed (3.3s).

## Full test execution

Command:

`npm run check` (repo root: eslint `--max-warnings 0`, prettier `--check`, typecheck of all workspaces incl. renderer
specs, root vitest, renderer `ng test`)

Result:

Fail, only because of TW-1: lint, prettier and typecheck passed; root vitest 53 files / 3160 tests passed; renderer
69 files, 1997 tests, 1996 passed, 1 failed (TW-1).

## .taskcheck

Result:

Fail (`.taskcheck` runs `npm run check`; same run as above; the only failure is TW-1).

## Bugs found

### A CONFLICT with an unreadable server version is shown and resolved as "deleted on the server"

Finding ID:

`TW-1`

Test:

`document-editing.spec.ts` > "Editing documents in a collection tab" > "conflict view" > "does not claim the document
was deleted when the conflict detail is malformed"

Production source:

`packages/renderer/src/app/document/document-actions.service.ts:347-351` and `:455-461` (a malformed `detail`, or a
`detail.current` that is not parseable EJSON, is stored as `current: null`), consumed as "deleted" by
`packages/renderer/src/app/document/conflict/conflict-view.ts:383` (`serverExists`), `document-actions.service.ts:226-238`
(`resolveWith` sends `docs.insert`) and `:211` (`keepServer` calls `documentChanged(key, null)`).

Requirement:

SPEC.md M1 "Conflict detection": when the conflict filter matches nothing, Thicket reloads the server version and
shows the side-by-side diff. The edit bar already says "changed on the server" for this case (existing test "still
reports a conflict whose detail is malformed"); the conflict view must not contradict it.

Expected behavior:

When the server version in the CONFLICT detail is missing/unreadable, the view does not claim the document was deleted
and does not offer to insert it again (e.g. it reloads the server version with `docs.get`, or treats it as unknown).

Actual behavior:

The view title is "Deleted on the server since you loaded it" while the edit bar says "changed on the server"; the
buttons are "Insert your version again" (sends `docs.insert` for a document that still exists, which fails with a
duplicate key error) and "Keep it deleted" (removes the still-existing document from the shown page).

Severity:

Low (needs a backend response outside the contract or a non-EJSON `current`; no data is lost, the insert fails
server-side).

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.`

### Observations (no failing test; not defects against a stated requirement)

- O-1 (Low): `resolveWith` calls `edits.resolve(...)` before `save`, so an Overwrite/Merge that is cancelled in the
  production confirm dialog, refused (read-only) or fails already rebased the edit baseline onto the server version
  and dropped that document's undo/redo history. A later plain Save then writes the local version over the server
  version without a new conflict. Tested state after cancel: nothing sent, conflict and local version kept.
- O-2 (Low, cosmetic): with a projection active and every edit undone, `conflict-view.ts:376` computes
  `visibleFields(server, [])`, so the server side shows `{}` (no fields, not even `_id`). Not covered by a test.

## Coverage

Status: verified for the snapshot below, with one disclosed deviation: the coverage run excludes the single known
failing test TW-1 via `--filter` (Vitest writes no coverage report when a test fails; the run including TW-1 exited 1
without a report). TW-1 remains in the suite and fails in the focused and full runs above.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured (the tooling has no changed-line mode; not reconstructed by hand).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `conflict-ui`, base
  `2a62fc45bc886a9153dc8258561d921c397d2606`, HEAD `cded8c146d2008bc904fffd938fab0a354f6977c`, task commits
  `98ddde5`, `cded8c1` supplied by the parent; file list from `git diff --stat <base>..HEAD`.
- Source/test snapshot identifier (including uncommitted inputs): production files equal HEAD; uncommitted test files
  sha256: `edit-session.spec.ts` 3f3d0a6a4d40..., `document-actions.service.spec.ts` e7343dcb3ff7...,
  `document-editing.spec.ts` 70879570777a..., `conflict/line-diff.spec.ts` b2a20788441b... (hashed before and after
  the run, unchanged).
- Exact included files: `src/app/document/conflict/conflict-view.ts`, `src/app/document/conflict/line-diff.ts`,
  `src/app/document/conflict/index.ts`, `src/app/document/document-actions.service.ts`,
  `src/app/document/edit-session.ts`, `src/app/document/index.ts`, `src/app/collection/collection-view.ts`
  (paths relative to `packages/renderer`). Excluded: `collection-view.html` (template, not instrumented separately;
  its one added line is exercised by every `document-editing.spec.ts` conflict test), spec files, `test/e2e/conflict.e2e.ts`
  (test code). No renamed or deleted files.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with v8 coverage via Angular
  `ng test`; working directory `packages/renderer`; command
  `npx ng test --coverage --coverage-reporters=text --coverage-reporters=json-summary --coverage-reporters=json --filter='^(?!.*does not claim the document was deleted).*$' --include='src/app/document/**/*.spec.ts' --include='src/app/collection/**/*.spec.ts' --coverage-include=<each file above>`;
  selection: 9 spec files, 279 tests run, 1 skipped by the filter (TW-1).
- Run start/completion time and exit status: started 2026-11-17 02:11:27 +0100, duration 5.02s, exit 0.
- Generated report paths and report hashes/run identifier: `packages/renderer/coverage/renderer/coverage-summary.json`
  (sha256 8a0da340a331...), `packages/renderer/coverage/renderer/coverage-final.json` (sha256 b57b6d9c64e2...),
  both written 02:11 by this run (git-ignored).
- Evidence outputs are fresh and inputs stayed unchanged: yes (report files regenerated by this run; hashes of
  inputs identical before and after).
- Final run after latest test additions and production fixes: yes for the latest test additions; no production fixes
  were made yet (TW-1 is open), so coverage must be re-measured after the fix.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `src/app/document/conflict/conflict-view.ts` | 147/150 (98.0%) | 64/68 (94.1%) | 22/22 (100%) | 112/113 (99.1%) |
| `src/app/document/conflict/line-diff.ts` | 62/62 (100%) | 28/28 (100%) | 5/5 (100%) | 51/51 (100%) |
| `src/app/document/conflict/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `src/app/document/document-actions.service.ts` | 214/219 (97.7%) | 103/107 (96.3%) | 52/53 (98.1%) | 181/183 (98.9%) |
| `src/app/document/edit-session.ts` | 109/109 (100%) | 41/42 (97.6%) | 38/38 (100%) | 78/78 (100%) |
| `src/app/document/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `src/app/collection/collection-view.ts` | 184/199 (92.5%) | 100/122 (82.0%) | 52/56 (92.9%) | 155/161 (96.3%) |
| Aggregate (summed counters, all 7 files; `collection-view.html` excluded) | 716/739 (96.9%) | 336/367 (91.6%) | 169/174 (97.1%) | 577/586 (98.5%) |

Before the added tests (same command, task specs as committed plus the first batch): conflict-view.ts lines 108/113,
branches 60/68; the projection and "No differences" UI tests closed lines 59-62 and 376 and the branch at 326.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `conflict-view.ts:338` (if) | keepServer while the merge editor is open | Not reachable from the UI: the Keep server button is not rendered while merging. Left uncovered. |
| `conflict-view.ts:343` (if) | openMerge without local edits | Defensive guard; the Merge button is hidden when `local === null`. Left uncovered. |
| `conflict-view.ts:364` (cond-expr, non-Error throw) | parser throwing a non-Error | Defensive; the shell-syntax parser throws `ShellSyntaxError`. Left uncovered. |
| `conflict-view.ts:376` (cond-expr, no entry) / `:395` (catch) | projection + all edits undone (server shows `{}`, O-2); key not EJSON | O-2 recorded; `:395` defensive (keys are always canonical EJSON). Left uncovered. |
| `document-actions.service.ts:91`, `:108`, `:429`, `:443`, `:457`, `:459` | `clearMessage`, save without `_id`, `overwritesHiddenData`/`hasPath`/`parseServerDoc` branches | Not changed by this task (pre-existing code in the file). `:457/:459` (`parseServerDoc` catch) is the TW-1 path; covered once TW-1's test can pass. |
| `edit-session.ts:209` (cond-expr) | `pendingSave` error that is not an `Error` | Not changed by this task; defensive. |
| `collection-view.ts:254-259` and other branches | collection view paging/query code | Not changed by this task (task added only the `ConflictView` import/registration). |

## Unable to test

- Nothing required by the acceptance criteria was left unrun: the e2e criterion ran against the real Electron app
  and a MongoDB container (`npm run test:e2e -- test/e2e/conflict.e2e.ts`, 2 passed).
- Changed-line coverage was not measured (no tool support); whole-file numbers above include pre-existing code.
- No follow-up needed beyond TW-1 (and optionally O-1/O-2 at the parent's discretion).

## Summary

Tests added; production defects were discovered and must be passed to the `fixer` before task completion.
(TW-1, Low: an unreadable CONFLICT detail is shown and resolved as a deletion. All other conflict-ui behavior,
including both acceptance criteria and the e2e test, passes.)

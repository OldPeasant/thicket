# Test Report

Date: 2026-11-17

Task: conflict-partial-docs - Conflict view for partly loaded (cut-array) documents

Scope: base 98cd4aaf93fcad419bd6149f972aeaf74bbb3283 .. HEAD 6da97d997578d55ee1e6223f501f7e653ce48cfb (one task commit, `6da97d9`, supplied by the parent as `b005e6f` before its rebase; same change set: `git diff 98cd4aa..HEAD -- packages` lists exactly the 4 files the parent named). Branch `main`. Uncommitted at measurement: the new untracked test file below (no production changes).

Requirements:
- `tasks/conflict-partial-docs.md` acceptance criteria 1-3 and the recorded ASSUMPTION (2026-11-17, felix/agent-2)
- `reviews/doc-paging/tests.md` TW-1/TW-2, `reviews/doc-paging/review.md` CR-8 (background)
- `docs/ARCHITECTURE.md` "Paging inside documents", "Coverage"; `SPEC.md` M1 conflict detection

## Test files changed

- `packages/renderer/src/app/document/conflict/conflict-view.spec.ts` (new)

The parent's tests in `collection-view.spec.ts` ("and a save conflict (conflict-ui)") and
`document-actions.service.spec.ts` ("a large document with cut arrays in the conflict paths") were
reviewed and left unchanged.

## Tests added or updated

Count: 11 (all new, in `conflict-view.spec.ts`, `ConflictView with a partly loaded (cut-array) document`).
ConflictView is mounted on its own with the real DocumentActions/DocumentEdits, the fake bridge and a
fake host whose `slicedOf` reports the cut arrays, so cases the collection view cannot produce today
(the backend cuts top-level arrays only) are reachable.

## Requirement coverage

Focused command (F): `cd packages/renderer && npx ng test --include src/app/document/conflict/conflict-view.spec.ts --include src/app/document/document-actions.service.spec.ts --include src/app/collection/collection-view.spec.ts --include src/app/document/document-editing.spec.ts --coverage --coverage-include='src/app/document/document-actions.service.ts' --coverage-include='src/app/document/conflict/conflict-view.ts'`

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: diff of a cut document does not list never-loaded items, does not render the whole server array (300 server items, 100 loaded) | collection-view.spec `compares only the loaded items of the cut array, not the whole server array` (parent) | F | Pass |
| AC1: dotted cut path | `compares only the loaded items of a cut array at a dotted path` | F | Pass |
| AC1: server version without the array / with a non-array value | `notes a cut array the server version no longer has, ...`; `leaves a server value that is no array at the cut path as it is` | F | Pass |
| AC1: several cut arrays, note wording (singular, thousands separator) | `names one note line per cut array, with singular wording and thousands separators` | F | Pass |
| AC1: no edits left (local version gone) | `with no edits left, still shows only the loaded part of the cut array, and only Keep server` | F | Pass |
| AC1: local cut array edited shorter | `shorter: shows no never-loaded server items` | F | Pass (see observation O-1) |
| AC1: local cut array edited longer (items appended) | `longer: never-loaded server items are neither shown nor counted as differences` | F | **Fail** - TW-1 |
| AC2: conflict note names the partial load, not a projection | collection-view.spec `names the partial load, not a projection, in the note and the refusals` (parent); `offers neither Overwrite nor Merge, with the partial-load note, under a top-level projection too` | F | Pass |
| AC2: refused-resolve message (Overwrite/Merge) | document-actions.service.spec `Overwrite and Merge manually are refused for the partial document, nothing is written`, `a cut document is blocked even under a top-level projection` (parent) | F | Pass |
| AC2: re-insert refusal names the partial load | `a deleted server version: no cut note, and re-inserting names the partial load` (through the Overwrite button); `a deleted partial document without an active projection gets the partial-load wording`; parent tests in both specs | F | Pass |
| AC2 / ASSUMPTION: not cut, projection active -> projection wording kept | `a deleted server version under a projection keeps the projection wording when not cut` | F | Pass |
| AC3: Keep server fallback shows the conflict version whole (no cut flags, editable, pager matches real arrays) | collection-view.spec `Keep server version shows the conflict version whole when the read-back fails`; document-actions.service.spec `keepServer shows the conflict version whole (no cut flags) when the read-back fails` (parent) | F | Pass |

## Focused test execution

Command:

`F` (above), run 2026-11-17 05:12:32-05:12:52 +01:00

Result:

Fail - 4 files, 286 tests: 285 passed, 1 failed (`longer: never-loaded server items ...`, TW-1).

## Full test execution

Command:

`npm run check` (repo root; lint + Prettier + typecheck + core vitest + `ng test`), 2026-11-17 05:13:57-05:15:28 +01:00

Result:

Fail - lint, Prettier and typecheck pass (new spec included); root vitest 75 files / 4100 tests pass;
renderer 93 files / 2978 tests: 2977 passed, 1 failed (the same TW-1 test). No other failures.

## .taskcheck

Result:

Fail - `.taskcheck` runs `npm run check` (above); the only failure is TW-1.

## Bugs found

### Appended local items expose never-loaded server items in the conflict diff

Finding ID:

`TW-1`

Test:

`ConflictView with a partly loaded (cut-array) document > when the cut array was edited locally (raw editor) after the conflict > longer: never-loaded server items are neither shown nor counted as differences`

Production source:

`packages/renderer/src/app/document/conflict/conflict-view.ts:497-500` (`const loaded = arrayAt(local, array.path)?.length ?? array.loaded;` then `truncateArray(server, ..., loaded)`)

Requirement:

AC1: "The conflict diff of a document with cut arrays does not list never-loaded items as differences and does not render the whole server array".

Expected behavior:

Only the server items that were loaded (the first `loaded` = 100 per `conflict.cut`) are shown and
compared; items the user appended locally show as "only in your version".

Actual behavior:

The server array is cut to the local array's current length. After appending 2 items to the
100 loaded ones (possible with the raw editor, which edits partial documents; the conflict stays
open while the user edits), the server column shows `SKU-000100` and `SKU-000101` - never loaded -
and they are counted as "Changed" lines against the appended local items. The cut note also says
"only the first 102 items are compared". Display only: Overwrite/Merge stay blocked, nothing is written.

Severity:

Low

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.`

(A likely fix: cut the server array to the number of items that were loaded, `array.loaded` from
`conflict.cut`, not to the local length; that also resolves O-1.)

### Observation O-1 (no failing test, for the parent to decide)

Same line 497: when the local cut array is edited shorter (e.g. 98 of the 100 loaded items left),
the server array is cut to 98, so the two loaded items the user removed are hidden on the server
side and the removal is not shown as a difference; the note says "only the first 98 items are
compared" although 100 were loaded. Not a violation of AC1's wording (no never-loaded items shown),
so the test `shorter: ...` only asserts that never-loaded items stay hidden.

## Coverage

Status: partial - measured on the parent's existing specs only. The run including the new spec fails
(TW-1) and the provider writes no report on failure (`coverage/` stayed empty, exit 1), so the
contribution of the 10 passing new tests is not in the numbers. A run deselecting only the failing
test was not performed (not permitted in this session).

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured (no changed-line tooling; uncovered locations were intersected with the diff hunks by hand below).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `conflict-partial-docs`; base 98cd4aaf93fcad419bd6149f972aeaf74bbb3283; HEAD 6da97d997578d55ee1e6223f501f7e653ce48cfb; task commit 6da97d9 and file list from the parent, matched against `git diff --stat 98cd4aa..HEAD`.
- Source/test snapshot identifier (including uncommitted inputs): HEAD 6da97d9 plus untracked `conflict-view.spec.ts` sha256 af34098835f8b72cbef68937fca966de3248ed141f882799a557d5c6a042d010; production `conflict-view.ts` 790216226159e072dc7a29404fcaa129e58fc1a81057a941e57a1efef6a6c1f5, `document-actions.service.ts` c195b4d02884a2321ef2b0b952f7a3eb423b8c8695b9efa69ca4dd78150110ea (identical before and after all runs).
- Exact included files; renamed/deleted/excluded files and reasons: included `packages/renderer/src/app/document/document-actions.service.ts`, `packages/renderer/src/app/document/conflict/conflict-view.ts`; excluded the two changed `*.spec.ts` files (tests). No renames or deletions.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with v8 coverage via `@angular/build` unit-test; `cd packages/renderer && npx ng test --include src/app/document/document-actions.service.spec.ts --include src/app/collection/collection-view.spec.ts --include src/app/document/document-editing.spec.ts --coverage --coverage-include='src/app/document/document-actions.service.ts' --coverage-include='src/app/document/conflict/conflict-view.ts'` (3 spec files, 275 tests).
- Run start/completion time and exit status: 2026-11-17 05:13:07 - 05:13:31 +01:00; 275/275 passed, exit 0.
- Generated report paths and report hashes/run identifier: `packages/renderer/coverage/renderer/coverage-summary.json` sha256 3b1d6045a7176342fc930fcbc9d56bd69b097cfdf6a7a1400f66f51bbccde921; `packages/renderer/coverage/renderer/lcov.info` sha256 0e894f06d730cf99c30af3b71540f9361218d3150362482b35952292576aa095 (both written 05:13:31).
- Evidence outputs are fresh and inputs stayed unchanged: the preceding failed run (05:12:52) left `coverage/` empty; the report files are timestamped by this run; source hashes unchanged afterwards.
- Final run after latest test additions and production fixes: no - the latest test file is not in the measured run (see Status); no production fixes yet (TW-1 open).

Values below use covered/total (percentage).

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/document/document-actions.service.ts` | 269/272 (98.89%) | 172/177 (97.17%) | 65/65 (100%) | 226/226 (100%) |
| `packages/renderer/src/app/document/conflict/conflict-view.ts` | 217/222 (97.74%) | 132/143 (92.31%) | 36/36 (100%) | 164/165 (99.39%) |
| Aggregate (both files, summed counters; nothing unmeasured) | 486/494 (98.38%) | 304/320 (95.00%) | 101/101 (100%) | 390/391 (99.74%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `document-actions.service.ts`: branches at 181, 306, 333, 611, 635 | Outside the task's diff hunks (207-210, 225-233, 246-251, 268-275, 469-476, 510-537, 582-597); every task-changed line/branch there is covered | Pre-existing, not in task scope |
| `conflict-view.ts:424` (singular `item`), `:426` (`total === null`, no server array) | Cut note wording | `names one note line per cut array, ...`; `notes a cut array the server version no longer has, ...` (pass, not in the measured run) |
| `conflict-view.ts:497` (`?? array.loaded`, no local version), `:498` (`?? null`) | No edits left; server without the array | `with no edits left, ...`; `notes a cut array the server version no longer has, ...`; `leaves a server value that is no array ...` (pass, not in measured run) |
| `conflict-view.ts:529, 531, 534, 545` (`arrayAt` null doc / non-object step / non-array; `truncateArray` non-object) | Dotted paths, missing or non-array values | `compares only the loaded items of a cut array at a dotted path`, `leaves a server value that is no array ...`, `with no edits left, ...` (pass, not in measured run) |
| `conflict-view.ts:450, 455, 477, 562` | Pre-existing merge/idText paths outside the task diff | Not in task scope |

Follow-up: after TW-1 is fixed, rerun `F` (all 4 specs, coverage) for final coverage including the new spec.

## Unable to test

- Running the "longer"/"shorter" scenarios end to end through the raw editor in the collection view (browser): not done; the component test drives `DocumentEdits.edit` directly, as the raw editor's Apply does (`raw-editor.ts:284`). No follow-up needed beyond TW-1.
- Dotted cut paths through the real backend: the backend cuts top-level arrays only (`sliceLargeArrays`), so dotted paths are covered at component level only.

## Summary

Tests added; production defects were discovered and must be passed to the `fixer` before task completion.

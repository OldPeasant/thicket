# Test Report

Date: 2026-11-17

Task: undo-last-save - M1 (Should): Undo last save (round 4, final code after the round-3 fix for TW-1)

Scope: the eight task commits `undo-last-save: ...` on `main`. The parent gave base `679b60f7` and HEAD `30768702` (the round-3 fix). While this run was in progress, the parent rebased the task at 08:38:41 +0100. The merge base with `origin/main` is now `a387e2e9`, and HEAD is `699b9c17`, which is the rebased `30768702`. Task ownership was taken from the commit subjects (all `undo-last-save:`, 8 commits in `git log a387e2e9..HEAD`) and the parent's file list. `git diff --stat a387e2e9..HEAD -- packages test` lists the same 12 files and line counts as before the rebase. The production blobs are listed under Coverage. The rebase did not change them. This run made one uncommitted change, round-4 tests added to `undo-last-save.spec.ts`. The working tree also shows `reviews/undo-last-save/review.md` as modified, which is the parallel code-reviewer's work and not part of this report. Production code was not modified.

Requirements:
- `tasks/undo-last-save.md`: acceptance criteria 1-2 and the recorded assumptions (one level per document per tab; Save/Overwrite/Merge count, re-insert does not, Delete drops; refused while there are unsaved edits; a conflicting undo writes nothing, says "Not undone: ...", opens no conflict view and drops the undo; order-restoring replace with a whole-document check)
- SPEC.md "Undo last save" (keep the pre-save version, write it back with the same conflict check)
- `reviews/undo-last-save/fixes.md` (round 3: TW-1 fixed by refusing the undo, CR-2 comment), the round-3 `tests.md`
- docs/ARCHITECTURE.md "Coverage", docs/QUALITY.md

## Test files changed

- `packages/renderer/src/app/document/history/undo-last-save.spec.ts` (a nested `describe('when the save removed the repeated key')` was added inside `a document with repeated top-level keys`; no existing test was changed)

## Fix check (TW-1)

The fix is correct. `keepingOrder` returns `null` when `wholeDocumentCheck` cannot be built and the diff is a `replace`. `send` then refuses before any write with "Not undone: this document has repeated field names, so the old version can not be written back safely." The three repeated-key tests from the fixer's update all pass:
- a plain undo is refused;
- the undo is refused when the saved field changed on the server since;
- the TW-1 scenario (`status` changed on the server) is refused, and the server keeps `status: "shipped"`.

In every case nothing is written and the undo stays offered. The fixer changed the TW-1 test's message expectation from the conflict text to the refusal text. That is consistent with the fix: the requirement assertion (the server document is unchanged and nothing is written) is unchanged, so the test was not weakened.

The `update` arm of `diff.kind === 'update' ? diff : null` (service line 727) cannot be reached. `wholeDocumentCheck` returns `null` only for repeated top-level keys. In that case core's diff always returns `replace` (`diff.ts:143`, `hasRepeatedKeys(o) || hasRepeatedKeys(e)`).

## Tests added or updated

Count: 2 (both pass)

The round-3 fix covers a saved version that has repeated keys. It did not cover the reverse case, where the version before the save had repeated keys and the save removed one. The saved version then has unique keys, so the undo is not refused. It replaces under a whole-document check and writes the repeated keys back. Neither the success path nor the conflict path of that case had a test.

- `... when the save removed the repeated key` > `save, undo last save: the server document equals the original with both keys again` (AC1: the server document equals `{_id, status, tag: "a", tag: "b", total}` again; the undo is a replace with the whole-document check of the 4-field saved version; the undo is no longer offered)
- `... when the save removed the repeated key` > `reports a conflict and overwrites nothing when another field changed on the server` (AC2 and assumption 3 on this path: another client sets `status`; the undo returns false with "Not undone: the document was changed on the server ..."; the server is unchanged; no conflict view opens; the undo is dropped)

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: save, undo last save -> server doc equals original (minimal update, order-restoring replace, typed values, nested, read-back vs model, original with repeated keys) | unit `save, undo last save: the server document equals the original again`, `restores ...`, `checks Date, ObjectId, Decimal128, ...`, `saved version: read-back or model`, `... the original with both keys again` (new); header `a click undoes the last save; the button then goes away` | `cd packages/renderer && npx ng test --include='src/app/document/**/*.spec.ts'` | Pass |
| AC1 against real MongoDB (e2e) | `test/e2e/undo-last-save.e2e.ts` | parent's e2e run | Not run: the parent runs e2e. As instructed, it was not edited or run here |
| AC2: server change since the save -> conflict, nothing overwritten (minimal-update and replace paths, typed values, array, removed/added field, deleted, newer change before read-back, repeated-key original) | unit `reports a conflict ...` (incl. `it.each` rows), `does not take a read-back with other values ...`, `a conflicting undo of a document deleted on the server ...`, `... when another field changed on the server` (new) | same unit command | Pass |
| AC2 when the saved version has repeated keys (TW-1): refused, nothing written | `save, undo last save: refused, ...`, `refuses and writes nothing when the field the save changed ...`, `does not replace over a server change to a field the save did not touch` | same unit command | Pass |
| AC2 against real MongoDB (e2e) | `test/e2e/undo-last-save.e2e.ts` | parent's e2e run | Not run: the parent runs e2e |
| Assumption 1: one level; Save/Overwrite/Merge count; re-insert does not; Delete drops | `undoes only the last save of the document`, `is offered after a conflict Overwrite ...`, `is offered after Merge manually ...`, `is not offered after inserting a document deleted on the server again`, `is no longer offered once the document is deleted`; `SaveHistory` spec | same unit command | Pass |
| Assumption 2: refused while modified (service and button) | `refuses while the document has unsaved edits, and keeps them`; header `is disabled with a hint while the document has unsaved edits` | same unit command | Pass |
| Assumption 3: conflicting undo writes nothing, "Not undone: ...", no conflict view, undo dropped | `reports a conflict and overwrites nothing ...`, `a conflicting undo of a document deleted ...`, `... when another field changed on the server` (new) | same unit command | Pass |
| Assumption 4: order-restoring replace with a whole-document check; projected/partial stays minimal with Save's rules; refused when the check can't be built | replace-path tests, `keeps the projection rules ...`, `refuses with its own text an undo that would replace a whole field ...`, the repeated-key tests; `applyUpdate` spec | same unit command | Pass |
| Write guard, busy guard, cancel, failed write | `goes through the write guard ...`, `runs one undo at a time ...`, `a cancelled production confirm ...`, `a failed write (not a conflict) ...`; header `is disabled on a read-only profile ...`, `is disabled while the undo is running` | same unit command | Pass |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/app/document/**/*.spec.ts'`

Result:

Pass: 11 files, 367 passed (365 before plus the 2 new tests). The last run started at 08:42:04 +0100, after the parent's rebase.

## Full test execution

Command:

`npm run check` (eslint `--max-warnings 0`, Prettier, type check, root Vitest, renderer `ng test`; this is what `.taskcheck` runs), run from the repository root.

Result:

Pass. eslint, Prettier and the type checks passed. Root Vitest: 97 files, 5156 passed. Renderer: 123 files, 4086 passed. Both counts are higher than in round 3 because the rebase brought in newer main. E2E is not part of `npm run check`. The parent worker runs it.

## .taskcheck

Result:

Pass. `.taskcheck` runs `npm run check`, which this run executed directly (see above).

## Bugs found

None in round 4. TW-1 (round 3) is fixed and verified (see "Fix check").

## Coverage

Status: verified. The run is fresh, came after the round-4 test additions and the TW-1 fix, and passed. Coverage was not measured in round 3 because of the failing TW-1 test.

Metric: whole-file coverage of task-changed production files. The files include old code in `document-actions.service.ts` and `document-header.ts`, and the counts include hits from every renderer spec.
Changed-line coverage: not measured. The configured tooling has no changed-line report.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `undo-last-save`. The parent supplied base `679b60f7` and HEAD `30768702`. The parent rebased at 08:38:41, before the coverage run. Measured state: merge base `a387e2e9` and HEAD `699b9c17` (= the rebased `30768702`, same production post-image). The task-owned commits are the 8 `undo-last-save:` commits. The file scope is the parent's list, confirmed by `git diff --stat a387e2e9..HEAD -- packages test` (12 files, same line counts as before the rebase).
- Source/test snapshot identifier (including uncommitted inputs), as git blob ids. They were taken after the coverage and check runs, and HEAD did not move after 08:38:41.
  - Production: `document-actions.service.ts` cf615bd1, `document-header.ts` 6d1ee357, `history/apply-update.ts` 695afbed, `history/save-history.ts` 8112037d, `history/index.ts` 1725211d, `core/src/diff/diff.ts` 51f52645.
  - Tests: `undo-last-save.spec.ts` 8eb09402, which is uncommitted and includes the round-4 additions after Prettier. The other task specs are as committed.
- Exact included files; renamed/deleted/excluded files and reasons:
  - Included: `packages/renderer/src/app/document/document-actions.service.ts`, `document-header.ts`, `history/apply-update.ts`, `history/save-history.ts`, `history/index.ts`. `index.ts` is a re-export only with 0 executable statements, so N/A.
  - Excluded: `packages/renderer/src/app/document/index.ts`, a one-line re-export.
  - Excluded: `packages/core/src/diff/diff.ts`. The task only adds an `export` and a doc comment to `exprFieldCheck`, with no behavior change, and core's own suite covers the file.
  - Tests and `test/e2e/undo-last-save.e2e.ts` are excluded as tests.
  - No renamed or deleted files.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with `@vitest/coverage-v8` (v8), through `ng test`, run in `packages/renderer` on all renderer specs. Command: `npx ng test --coverage --coverage-include='src/app/document/document-actions.service.ts' --coverage-include='src/app/document/history/apply-update.ts' --coverage-include='src/app/document/history/save-history.ts' --coverage-include='src/app/document/history/index.ts' --coverage-include='src/app/document/document-header.ts' --coverage-reporters=text --coverage-reporters=json-summary --coverage-reporters=json`
- Run start/completion time and exit status: started 08:39:13 +0100, report written 08:39:55 +0100. 123 files and 4086 tests passed, with no failures. The exit status was not captured directly, because the command was piped through `tail`. A passing run is shown by the 0 failures and by the report being written, since Vitest does not write a report on a failed run.
- Generated report paths and report hashes/run identifier: `packages/renderer/coverage/renderer/coverage-summary.json` (2029 bytes, sha256 `31cbdbb189c82b4928e6c514b5eafea658ca7a8ded889ae02f974699d9fda226`) and `coverage-final.json` (131865 bytes, sha256 `ed7392c28010d99cd22dbcf5ee57fbdc53cb692b627efc7855d302e314513b4b`). Both were written at 08:39:55.78.
- Evidence outputs are fresh and inputs stayed unchanged: yes. The coverage directory was created by this run (08:39:13). The rebase finished at 08:38:41, before the run, and the production blobs match the committed post-image of the TW-1 fix.
- Final run after latest test additions and production fixes: yes.

Values below use covered/total (percentage) from `coverage-summary.json`; zero-denominator metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/document/document-actions.service.ts` | 347/350 (99.14%) | 235/242 (97.10%) | 85/85 (100%) | 294/294 (100%) |
| `packages/renderer/src/app/document/document-header.ts` | 97/101 (96.03%) | 47/54 (87.03%) | 20/20 (100%) | 74/75 (98.66%) |
| `packages/renderer/src/app/document/history/apply-update.ts` | 49/51 (96.07%) | 36/41 (87.80%) | 9/9 (100%) | 38/39 (97.43%) |
| `packages/renderer/src/app/document/history/save-history.ts` | 12/12 (100%) | 2/2 (100%) | 6/6 (100%) | 10/10 (100%) |
| `packages/renderer/src/app/document/history/index.ts` | N/A (0/0) | N/A (0/0) | N/A (0/0) | N/A (0/0) |
| Aggregate (summed counters, the 5 files above) | 505/514 (98.24%) | 320/339 (94.39%) | 120/120 (100%) | 416/418 (99.52%) |

The aggregate excludes `packages/renderer/src/app/document/index.ts` and `packages/core/src/diff/diff.ts` (reasons above). No scoped file is missing from the report.

The uncovered locations below are read from `coverage-final.json` (`s`/`b` counters equal to 0).

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `document-actions.service.ts:727` (the `update` arm of `diff.kind === 'update' ? diff : null`) | Fallback when the whole-document check can't be built for an update | Not reachable: `wholeDocumentCheck` returns null only for repeated top-level keys, and core then always returns `replace` (`diff.ts:143`). The `null` arm is covered by the 3 repeated-key refusal tests |
| `document-actions.service.ts:731` (`id ? [id] : []`, false) | Defensive: the diff's filter always holds `_id` | Not reachable through `diffDocuments`; no test |
| `document-actions.service.ts:439` (`idOf(original) === null`) | Defensive: `pendingSave` has already rejected a document without `_id` | Not reachable; pre-existing line (doc-edit-save) |
| `document-actions.service.ts:268`, `:410`, `:863`, `:887` | Merge with an unknown server version; resolve under a projection that hides sub-fields; `kind: 'none'` in `overwritesHiddenData`; `hasPath` through a scalar | Not changed by this task (doc-edit-save and earlier); out of scope |
| `document-header.ts:28-29`, `:142`, `:145`, `:162`, `:167`, `:172`, `:177` | Diff-bar error text, change count, clone toggling edit mode, other header guards | Not changed by this task (doc-edit-save); out of scope. The task's button, `canUndoSave` and `undoSave` are covered |
| `apply-update.ts:28` (`a.length - b.length` when one path is a prefix of another) | Two ops on a path and its parent, which MongoDB rejects and `diffDocuments` never produces | Non-material; no test |
| `apply-update.ts:37`, `:38`, `:40` (`?? 0` fallbacks), `:50` (`key === undefined`) | Fallbacks for undefined array items / an empty path that `split` never yields | Not reachable; no test |

## Unable to test

- E2E (`test/e2e/undo-last-save.e2e.ts`, Electron + MongoDB container) was not edited and not run here, as instructed. The parent worker runs it and records it for AC1/AC2.
- The repeated-key behavior was not tested against real MongoDB. That needs a document with repeated top-level keys inserted as raw BSON, and no container was available in this session. The unit fake server applies the same filter semantics. Follow-up: optional.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found.

The TW-1 fix is verified: an undo whose replace cannot be checked as a whole document is refused, and nothing is written. Two tests were added for the reverse repeated-key case (the save removed the duplicate key). The undo restores the original under the whole-document check and reports a conflict when the document changed on the server. Both pass. The focused suite passes (367 tests) and `npm run check` passes. Fresh task-scoped coverage, aggregated over the 5 included files: statements 505/514 (98.24%), branches 320/339 (94.39%), functions 120/120 (100%), lines 416/418 (99.52%). Every uncovered location is unreachable, defensive, or outside this task's changes. E2E is run by the parent.

# Test Report

Date: 2026-11-17

Task: undo-last-save - M1 (Should): Undo last save

Scope: task base `92135866b7a38de086eb5412b793c93c16d39c7f` .. HEAD `3e07e41b1e9a367efd7ef75917d7f60278693ee5` on `main` (task commits `e49f4b8f`, `3e07e41b`, supplied by the parent worker; `git diff 92135866..HEAD -- packages test`). The uncommitted changes are the test-writer's test files only. Production code was not modified.

Requirements:
- `tasks/undo-last-save.md` acceptance criteria 1-2 and its recorded assumptions (one level of undo per document per tab; refused while there are unsaved edits; a conflicting undo writes nothing and drops the undo; replaceOne when the minimal update would change the field order of a non-partial document)
- SPEC.md "Undo last save" (keep the pre-save version, write it back with the same conflict check), as summarised by the parent worker
- docs/ARCHITECTURE.md "Coverage", docs/QUALITY.md
- Existing conventions: `undo-last-save.spec.ts` (fake one-document server), `document-editing.spec.ts`, `test/e2e/*.e2e.ts`

## Test files changed

- `packages/renderer/src/app/document/history/apply-update.spec.ts` (new)
- `packages/renderer/src/app/document/history/save-history.spec.ts` (new)
- `packages/renderer/src/app/document/document-header.spec.ts` (new)
- `packages/renderer/src/app/document/history/undo-last-save.spec.ts` (8 tests added, existing tests unchanged)
- `test/e2e/undo-last-save.e2e.ts` (2 tests added, existing tests unchanged)

## Tests added or updated

Count: 36 (16 applyUpdate, 4 SaveHistory, 6 DocumentHeader, 8 DocumentActions undo unit tests, 2 e2e)

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: save, undo last save -> server doc equals original (component/e2e) | e2e `save, then Undo last save: the server document equals the original`, `Undo last save of a removed field restores it in its original place` (new, replace path through the UI's "Delete key"); unit `save, undo last save: ...`, `restores a field removed from the end with the minimal $set ...`, `restores a removed nested field in its place by replacing the whole document`, `undoes a save made under a projection that hides sub-fields ...`, `is offered after Merge manually, and undoes it back to the server version` | `npm run test:e2e -- test/e2e/undo-last-save.e2e.ts` (Electron + MongoDB container); `cd packages/renderer && npx ng test --include='src/app/document/**/*.spec.ts'` | Pass |
| AC2: document changed on the server since -> undo reports a conflict instead of overwriting (minimal-update path) | e2e `Undo last save reports a conflict instead of overwriting a newer server change`; unit `reports a conflict and overwrites nothing ...`, `reports a conflict when the document was deleted on the server since` | same two commands | Pass |
| AC2 on the replace path (undo of a save that removed or reordered a field; another field changed on the server since) | unit `reports a conflict instead of replacing over a server change to a field the save did not touch`; e2e `Undo last save of a removed field does not overwrite a newer change to another field` | same two commands | **Fail: TW-1** |
| Header button: shown only after a save, disabled while modified (with hint), a write control on read-only profiles, disabled while running, click undoes and the button goes away | `DocumentHeader: Undo last save` (6 tests) | `npx ng test --include='src/app/document/**/*.spec.ts'` | Pass |
| Undo goes through the write guard: a cancelled production confirm writes nothing and keeps the undo | `a cancelled production confirm writes nothing and keeps the undo` (plus the existing write-guard test) | same | Pass |
| A failed write that isn't a conflict says "Not undone", opens no conflict view and keeps the undo for a retry | `a failed write (not a conflict) says Not undone ...` | same | Pass |
| A double click while an undo is running sends one write | `runs one undo at a time: ...` | same | Pass |
| Merge manually counts as a save (assumption) | `is offered after Merge manually, ...` | same | Pass |
| applyUpdate models MongoDB's $set/$unset/$push order (nested, missing parents, no mutation) | `applyUpdate` (16 tests) | same | Pass |
| SaveHistory: one entry per document, replaced by newer saves, drop, reactive | `SaveHistory` (4 tests) | same | Pass |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/app/document/**/*.spec.ts'`

Result:

Fail: 326 passed, 1 failed (TW-1 unit test). 11 files.

`npm run test:e2e -- test/e2e/undo-last-save.e2e.ts` (final snapshot, after Prettier)

Result:

Fail: 3 passed, 1 failed (TW-1 e2e test: the message was "Undid the last save of 1." and the newer `qty` was overwritten).

Prettier (`npx prettier --check`, after `--write` on the new test files) and `npx eslint packages/renderer/src/app/document/ test/e2e/undo-last-save.e2e.ts`: Pass.

## Full test execution

Command:

`sh .taskcheck` (that is, `npm run check`: lint, type check, unit tests)

Result:

Fail: lint and type check passed; renderer unit tests 3754 passed, 1 failed (TW-1 only), 114 files.

## .taskcheck

Result:

Fail. The only failure is TW-1 (`undo-last-save.spec.ts` > `reports a conflict instead of replacing over a server change to a field the save did not touch`).

## Bugs found

### Undo replaces the whole document over a newer server change to a field the save did not touch

Finding ID:

`TW-1`

Test:

`packages/renderer/src/app/document/history/undo-last-save.spec.ts` > `Undo last save` > `reports a conflict instead of replacing over a server change to a field the save did not touch`; e2e `test/e2e/undo-last-save.e2e.ts` > `Undo last save of a removed field does not overwrite a newer change to another field`

Production source:

`packages/renderer/src/app/document/document-actions.service.ts`: `keepingOrder` (line 682), used from `send` (line 427) when `options.keepOrder` is set by `undoSave`

Requirement:

AC2: "If the document changed on the server since, undo reports a conflict instead of overwriting". The task assumption also says the replaceOne uses "the same expected-values filter".

Expected behavior:

When the undo has to be a replaceOne (the save removed a field that isn't last, removed a nested field, or reordered fields), a server change made since the save is not overwritten: the undo writes nothing and says "Not undone: ...", as on the update path.

Actual behavior:

`keepingOrder` turns the update into `{kind: 'replace', replacement: current, expected, filter}` but keeps the update diff's `expected`. That filter checks only the fields the save changed. replaceOne writes every field, so a field the save did not touch, changed on the server since, is reset to its pre-save value without a conflict. Reproduced on real MongoDB: seed `{_id:1, status, total, qty:1}`, delete `status` in the UI and save, another client sets `qty: 8`, Undo last save -> "Undid the last save of 1." and the stored `qty` is back to 1. Unit test: stored `{_id, total: 20}` after the save plus the server change becomes `{_id, status: "open", total: 10}`.

Severity:

High (silent data loss on concurrent edits; it breaks AC2 on a path that a simple field deletion triggers).

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.`

(One possible approach, for the fixer to decide: on the replace path, the conflict check must cover every field of the saved version, for example an `expected` that checks each top-level field of `after` and `$exists: false` for the fields only `before` has, or the replace is refused or falls back to the minimal update.)

## Coverage

Status: partial-failed. The suite has 1 legitimately failing test (TW-1). Vitest writes no coverage report on a failed run (a plain `--coverage` run left `packages/renderer/coverage/` empty). The numbers below therefore come from a diagnostic run that selected every document test except the TW-1 test with `--filter`. The test itself stays in the suite unchanged. The numbers are diagnostic, not verified task coverage.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured (no changed-line tooling is configured).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `undo-last-save`; base `92135866b7a38de086eb5412b793c93c16d39c7f`; HEAD `3e07e41b1e9a367efd7ef75917d7f60278693ee5`; task commits `e49f4b8f`, `3e07e41b`, from the parent worker. Checked against `git diff --stat 92135866..HEAD`: it changes only the files below plus tests.
- Source/test snapshot identifier (including uncommitted inputs): sha256 over the sha256 lines of `document/history/*.ts`, `document/document-header*.ts`, `document/document-actions.service.ts`, `document/index.ts` and `test/e2e/undo-last-save.e2e.ts` = `da2218bd765ea727890aeba0055a94720d4682ebff46d26b9a9e25fc8f81ea87` before and after the run. Uncommitted inputs are the new and changed test files listed above.
- Exact included files; renamed/deleted/excluded files and reasons: included `src/app/document/document-actions.service.ts`, `src/app/document/document-header.ts`, `src/app/document/history/apply-update.ts`, `src/app/document/history/save-history.ts`, `src/app/document/history/index.ts`, `src/app/document/index.ts` (all relative to `packages/renderer`). Nothing was renamed or deleted. Excluded: the spec and e2e files (tests).
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with `@vitest/coverage-v8` via the Angular builder; working directory `packages/renderer`; `npx ng test --include='src/app/document/**/*.spec.ts' --filter='^(?!.*replacing over a server change).*$' --coverage --coverage-reporters=json-summary --coverage-reporters=text-summary --coverage-reporters=lcovonly --coverage-include=...` (one `--coverage-include` per included file above); 326 passed, 1 skipped by the filter (TW-1).
- Run start/completion time and exit status: started 2026-11-17 07:39:31 +01:00, report written 07:39:45 +01:00, exit 0 (with the TW-1 test filtered out). The unfiltered coverage run at 07:35:58 exited nonzero (TW-1) and wrote no report.
- Generated report paths and report hashes/run identifier: `packages/renderer/coverage/renderer/coverage-summary.json` (sha256 `e25e3f62539c55a9424edc2f112c409eb5093c67ec90559da8b22a3cdfcaa1e8`), `packages/renderer/coverage/renderer/lcov.info` (sha256 `a153a485ae586699e2320c8863a6d63d68091f67b8eb0bb105ff534b6485b473`). Both are git-ignored.
- Evidence outputs are fresh and inputs stayed unchanged: yes. The directory was empty after the failed run, both files have mtime 07:39:45, and the snapshot hash is the same before and after the run.
- Final run after latest test additions and production fixes: yes for the test additions. No production fixes yet: TW-1 is open, so coverage must be measured again after the fix.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/document/document-actions.service.ts` | 309/312 (99.04%) | 203/208 (97.60%) | 75/75 (100%) | 262/262 (100%) |
| `packages/renderer/src/app/document/document-header.ts` | 97/101 (96.04%) | 45/54 (83.33%) | 20/20 (100%) | 74/75 (98.67%) |
| `packages/renderer/src/app/document/history/apply-update.ts` | 28/29 (96.55%) | 23/24 (95.83%) | 3/3 (100%) | 24/24 (100%) |
| `packages/renderer/src/app/document/history/save-history.ts` | 12/12 (100%) | 2/2 (100%) | 6/6 (100%) | 10/10 (100%) |
| `packages/renderer/src/app/document/history/index.ts` | N/A (0/0, re-export only) | N/A | N/A | N/A |
| `packages/renderer/src/app/document/index.ts` | N/A (0/0, re-export only) | N/A | N/A | N/A |
| Aggregate (summed counters, the 6 files above, none unmeasured) | 446/454 (98.24%) | 273/288 (94.79%) | 104/104 (100%) | 370/371 (99.73%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `document-actions.service.ts:180` (hidesSubFields branch of `undoSave`) | Undo of a save made under a projection that hides sub-fields | Covered by the new test `undoes a save made under a projection that hides sub-fields ...` (was uncovered in the first run) |
| `document-actions.service.ts:391` (true branch of `hidesSubFields ? entry?.original` in `resolveWith`) | Overwrite/Merge under a sub-field projection | Not reachable: `resolveBlocker` (line 303) already refuses Overwrite/Merge when `hidesSubFields` is set. Justified gap |
| `document-actions.service.ts:249, 419, 753, 777` | Code that existed before the task (saveMerged `_id` guard, `id === null` guard in `send`, helpers) | Outside the undo behavior; no test added |
| `document-header.ts:28, 132, 140, 142, 145, 162, 167, 177` | Header code that existed before the task (error display, no-`_id` document) | Covered by other suites (collection view), not part of this task |
| `document-header.ts:172` (`key === null` in `undoSave()`) | Click on a document without `_id` | Not reachable: the button is rendered only when `canUndoSave()` needs a key |
| `history/apply-update.ts:18` (`key === undefined`) | Defensive: `split('.')` always gives at least one segment and recursion happens only with a non-empty rest | Justified gap |

## Unable to test

- Field-order restoration under a projection or for a partial document is not checked. The assumption says the order may differ there by design, so there is nothing to assert beyond the existing projection tests.
- Undo refused before sending under a projection (`Not undone: with a projection active ...`): I found no realistic UI sequence where the save is allowed but its undo would overwrite hidden data, so I added no test. Low risk: it is the same code as Save's refusal, and only the message prefix differs.
- After TW-1 is fixed, coverage must be measured again without `--filter`.

## Summary

Tests added; production defects were discovered and must be passed to the `fixer` before task completion. TW-1 (High): on the replace path, Undo last save overwrites a newer server change to a field the save did not touch, which breaks AC2. It fails both in a unit test and in an e2e test against real MongoDB. All other behavior passes, including AC1 and AC2 on the minimal-update path.

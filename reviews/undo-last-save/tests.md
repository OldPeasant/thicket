# Test Report

Date: 2026-11-17

Task: undo-last-save - M1 (Should): Undo last save (round 3, final code after the round-2 fixes)

Scope: the six task commits `undo-last-save: ...` on `main`, measured at HEAD `f62928b3` (parent `0a11b2cc` holds the round-2 production fixes). The parent gave base `63dd0bfd` and hashes `70e7ffdc..5ac15bcc`. While this run was in progress, the parent rebased the task twice (onto `verify:` commits). The task's commits are now `2045cc16, 464b3b84, 241878b7, 3dce6315, 0a11b2cc, f62928b3`, and the merge base with `origin/main` is `59e93d84`. Task ownership was taken from the commit subjects (all `undo-last-save:`) and the parent's file list. `git diff --stat` of the task range lists the same 12 files and line counts as the parent's `git diff 63dd0bfd..HEAD -- packages test`. Because the commit hashes kept moving, the measured state is pinned by blob hashes (see Coverage). The only uncommitted change is this test-writer's addition to `undo-last-save.spec.ts` (+118 lines, blob `450f2b24` after edits). Production code was not modified.

Requirements:
- `tasks/undo-last-save.md`: acceptance criteria 1-2 and the 4 recorded assumptions (one level per document per tab; Save/Overwrite/Merge count, re-insert does not, Delete drops; refused while there are unsaved edits; a conflicting undo writes nothing, says "Not undone: ...", opens no conflict view and drops the undo; order-restoring replace for a whole document)
- SPEC.md "Undo last save" (keep the pre-save version, write it back with the same conflict check)
- `reviews/undo-last-save/review.md` (round 3), `fixes.md` (round 2), the round-2 `tests.md`
- docs/ARCHITECTURE.md "Coverage", docs/QUALITY.md
- Existing conventions: `history/undo-last-save.spec.ts` (one-document fake server with a strict `$expr` evaluator), `document-header.spec.ts`

## Test files changed

- `packages/renderer/src/app/document/history/undo-last-save.spec.ts` (round-3 tests added at the end; nothing existing changed)

The round-3 tests already committed in `f62928b3` (`apply-update.spec.ts` name-order edge cases; `undo-last-save.spec.ts` "saved version: read-back or model") were reviewed and kept as they are. They are not duplicated here.

## Tests added or updated

Count: 6 (all in `undo-last-save.spec.ts`; 1 of them fails on purpose, TW-1)

- `a conflicting undo of a document deleted on the server opens no conflict view and drops the undo` (assumption 3, deleted case: exact message, no conflict entry, undo no longer offered, nothing inserted)
- `is not offered after inserting a document deleted on the server again (not a save)` (assumption 1: re-inserting is not a save)
- `refuses with its own text an undo that would replace a whole field loaded under a projection` (the undo's own partial refusal text, nothing sent; no unit test reached it before)
- `a document with repeated top-level keys` > `save, undo last save: the server document equals the original again` (AC1 on the fallback path where `wholeDocumentCheck` returns null)
- `a document with repeated top-level keys` > `reports a conflict when the field the save changed was changed on the server since` (AC2 on the fallback path)
- `a document with repeated top-level keys` > `reports a conflict instead of replacing over a server change to a field the save did not touch` (AC2 on the fallback path; **fails: TW-1**)

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: save, undo last save -> server doc equals original (minimal update, order-restoring replace, typed values, nested, two trailing fields, read-back vs model) | unit `save, undo last save: the server document equals the original again`, `restores ...` (4), `checks Date, ObjectId, Decimal128, ...`, `saved version: read-back or model` (6), repeated keys `save, undo last save: ...` (new); header `a click undoes the last save; the button then goes away` | `cd packages/renderer && npx ng test --include='src/app/document/**/*.spec.ts'` | Pass |
| AC1 against real MongoDB (component/e2e) | `test/e2e/undo-last-save.e2e.ts` | `npm run test:e2e -- test/e2e/undo-last-save.e2e.ts` | Not run: the parent worker runs the e2e suite in parallel; this test-writer did not edit or run the e2e file |
| AC2: server change since the save -> conflict, nothing overwritten (minimal-update path, replace path: value, nested, order, Date, ObjectId, array item, removed field, added field, array containing the value, newer change between write and read-back, deleted) | unit `reports a conflict ...` (12 incl. `it.each` rows), `does not take a read-back with other values ...`, `a conflicting undo of a document deleted on the server ...` (new), repeated keys `... the field the save changed ...` (new) | same unit command | Pass |
| AC2 on the repeated-key fallback: a change to a field the save did not touch | repeated keys `reports a conflict instead of replacing over a server change to a field the save did not touch` (new) | same unit command | **Fail: TW-1** |
| AC2 against real MongoDB | `test/e2e/undo-last-save.e2e.ts` | parent's e2e run | Not run: run by the parent worker |
| Assumption 1: one level; Save, Overwrite, Merge count; re-insert does not; Delete drops | `undoes only the last save of the document`, `is offered after a conflict Overwrite ...`, `is offered after Merge manually ...`, `is not offered after inserting a document deleted on the server again` (new), `is no longer offered once the document is deleted`; `SaveHistory` spec (4) | same unit command | Pass |
| Assumption 2: refused while modified (service and button) | `refuses while the document has unsaved edits, and keeps them`; header `is disabled with a hint while the document has unsaved edits` | same unit command | Pass |
| Assumption 3: conflicting undo writes nothing, "Not undone: ...", no conflict view, undo dropped | `reports a conflict and overwrites nothing ...`, `a conflicting undo of a document deleted on the server opens no conflict view ...` (new) | same unit command | Pass |
| Assumption 4: order-restoring replace with a whole-document check; projected/partial stays minimal with Save's rules | replace-path tests above, `keeps the projection rules ...`, `undoes a save made under a projection that hides sub-fields ...`, `refuses with its own text an undo that would replace a whole field ...` (new); `applyUpdate` spec (24) | same unit command | Pass |
| Write guard, busy guard, cancel, failed write | `goes through the write guard ...`, `runs one undo at a time ...`, `a cancelled production confirm ...`, `a failed write (not a conflict) ...`; header `is disabled on a read-only profile ...`, `is disabled while the undo is running` | same unit command | Pass |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/app/document/**/*.spec.ts'`

Result:

Fail: 11 files, 364 passed, 1 failed (365). The one failure is TW-1, a legitimate requirement failure. Before the round-3 additions (committed tests only) the same files passed in the coverage baseline run below.

## Full test execution

Command:

`npm run check` (eslint `--max-warnings 0`, Prettier, type check, root Vitest, renderer `ng test`; this is what `.taskcheck` runs)

Result:

Fail: eslint, Prettier (after `npx prettier --write` on the changed spec) and the type check pass. Root Vitest: 95 files, 4972 passed. Renderer: 120 files, 3957 passed, 1 failed (TW-1). E2E is not part of `npm run check`. The parent worker runs it separately.

## .taskcheck

Result:

Fail (TW-1). `.taskcheck` runs `npm run check`, which was run directly as above. It passes again once TW-1 is fixed in production code.

## Bugs found

### Undo of a document with repeated top-level keys overwrites a server change to a field the save did not touch

Finding ID:

`TW-1`

Test:

`packages/renderer/src/app/document/history/undo-last-save.spec.ts` > `Undo last save` > `a document with repeated top-level keys` > `reports a conflict instead of replacing over a server change to a field the save did not touch` (line 949)

Production source:

`packages/renderer/src/app/document/document-actions.service.ts:719-721` (`keepingOrder`: `if (expected === null) return diff;`) and `:753-755` (`wholeDocumentCheck` returns `null` for repeated keys)

Requirement:

AC2: "If the document changed on the server since, undo reports a conflict instead of overwriting". Also assumption 4: the undo of a whole document sent as a replace is checked against the whole saved version.

Expected behavior:

Seed `{_id: 1, status: "open", tag: "a", tag: "b", total: 10}` (repeated top-level key `tag`; the EJSON parser keeps repeated keys). Save `total: 15`. Another client then sets `status: "shipped"`. Undo last save must report "Not undone: the document was changed on the server since the save ..." and leave the server document unchanged.

Actual behavior:

The undo succeeds and the server document becomes `{_id: 1, status: "open", tag: "a", tag: "b", total: 10}`, so the other client's `status: "shipped"` is silently lost. The cause: repeated keys make core's diff a `replace` (diff.ts:143), so `keepingOrder` takes the whole-document path. `wholeDocumentCheck` returns `null` for repeated keys, and `keepingOrder` then returns the diff unchanged. That diff is a replace of every field whose `expected` checks only the changed field (`{"total":{"$eq":15}}`). The doc comment ("the update stays the minimal one") only covers the update case. For a replace, this fallback is exactly the TW-1 gap of round 1 that the whole-document check was added to close. A real MongoDB `replaceOne` with that filter behaves the same way. Save has the same changed-field check for such documents, but AC2 is specific to the undo, and the undo writes the pre-save version, which the user did not edit.

Severity:

Medium for impact (silent overwrite of another client's data, which AC2 forbids). Reachability is low: only documents with repeated top-level field names, which normal drivers and the shell don't create.

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.`

## Coverage

Status: partial. A verified measurement exists for the committed code with the committed tests (baseline run, exit 0). The final run after the round-3 additions exited 1 because of TW-1 and wrote no coverage report: Vitest cleans `coverage/` and does not report on a failed run. No partial output exists. The task must be measured again after the TW-1 fix.

Metric: whole-file coverage of task-changed production files (includes old code in `document-actions.service.ts` and `document-header.ts`, and hits from every renderer spec).
Changed-line coverage: not measured (the configured tooling has no changed-line report).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `undo-last-save`. The parent supplied base `63dd0bfd`. After the parent's rebases, the merge base with `origin/main` is `59e93d84` and HEAD is `f62928b3`. The task-owned commits are the six `undo-last-save:` commits. The file scope is the parent's list, confirmed by `git diff --stat` of the task range.
- Source/test snapshot identifier (including uncommitted inputs): production blobs `document-actions.service.ts` c1b07a46, `document-header.ts` 6d1ee357, `history/apply-update.ts` 695afbed, `history/save-history.ts` df91cbff, `history/index.ts` 1725211d, `core/src/diff/diff.ts` 51f52645. They were identical at the start and at the end of this session. Baseline test blobs: `undo-last-save.spec.ts` ca7a824f (committed), `apply-update.spec.ts` f320d266, `save-history.spec.ts` fa47a539, `document-header.spec.ts` 55c795f7. The final run used `undo-last-save.spec.ts` 450f2b24 (uncommitted round-3 additions).
- Exact included files; renamed/deleted/excluded files and reasons: included `packages/renderer/src/app/document/document-actions.service.ts`, `document-header.ts`, `history/apply-update.ts`, `history/save-history.ts`, `history/index.ts` (re-export only, 0 executable statements, so N/A). `packages/renderer/src/app/document/index.ts` is excluded: a one-line re-export. `packages/core/src/diff/diff.ts` is excluded: the only change is the `export` keyword and a doc comment on `exprFieldCheck` (no behavior change; core's own suite covers it). Test files and `test/e2e/undo-last-save.e2e.ts` are excluded as tests. No renamed or deleted files.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with `@vitest/coverage-v8` (v8), through `ng test`. Working directory `packages/renderer`. All renderer specs. Command: `npx ng test --coverage --coverage-include='src/app/document/document-actions.service.ts' --coverage-include='src/app/document/history/apply-update.ts' --coverage-include='src/app/document/history/save-history.ts' --coverage-include='src/app/document/history/index.ts' --coverage-include='src/app/document/document-header.ts' --coverage-reporters=text --coverage-reporters=json-summary --coverage-reporters=json`
- Run start/completion time and exit status: baseline started 2026-11-17 08:23:41 +0100, report written 08:24:26, exit 0 (120 files, 3952 passed). Final run started 08:30:36, exit 1 (3957 passed, 1 failed: TW-1), no report.
- Generated report paths and report hashes/run identifier: baseline `packages/renderer/coverage/renderer/coverage-summary.json` (2030 bytes) and `coverage-final.json` (130827 bytes), both written 08:24:26.9. The final run then deleted that directory. I could not compute a file hash because writing a helper script outside the repo was denied in this session. The run is identified by its timestamps and the counters below, copied from `coverage-summary.json`.
- Evidence outputs are fresh and inputs stayed unchanged: yes for the baseline. The directory was created by that run (08:23:41), and the production blobs were the same before and after.
- Final run after latest test additions and production fixes: no. The final run failed because of TW-1 and produced no report. The numbers below are for the committed tests on the unchanged production code. The round-3 additions cover additional branches (the repeated-key fallback at service lines 721/755).

Values below use covered/total (percentage) from the baseline run; zero-denominator metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/document/document-actions.service.ts` | 341/346 (98.55%) | 229/238 (96.21%) | 85/85 (100%) | 290/290 (100%) |
| `packages/renderer/src/app/document/document-header.ts` | 97/101 (96.03%) | 47/54 (87.03%) | 20/20 (100%) | 74/75 (98.66%) |
| `packages/renderer/src/app/document/history/apply-update.ts` | 49/51 (96.07%) | 36/41 (87.80%) | 9/9 (100%) | 38/39 (97.43%) |
| `packages/renderer/src/app/document/history/save-history.ts` | 12/12 (100%) | 2/2 (100%) | 6/6 (100%) | 10/10 (100%) |
| `packages/renderer/src/app/document/history/index.ts` | N/A (0/0) | N/A (0/0) | N/A (0/0) | N/A (0/0) |
| Aggregate (summed counters, the 5 files above) | 499/510 (97.84%) | 314/335 (93.73%) | 120/120 (100%) | 412/414 (99.51%) |

The aggregate excludes `packages/renderer/src/app/document/index.ts` and `packages/core/src/diff/diff.ts` (reasons above). No scoped file is missing from the report.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `document-actions.service.ts:721` (`if (expected === null) return diff`), `:755` (`return null` for repeated keys) | Undo of a document with repeated top-level keys: AC1/AC2 on the fallback path | Tests added (repeated keys, 3). One of them fails: TW-1 |
| `document-actions.service.ts:725` (filter without `_id`, `id ? [id] : []` false) | Defensive: the diff's filter always holds `_id` | Not reachable through `diffDocuments`; no test |
| `document-actions.service.ts:773` (sort comparator returning 0 in `unordered`) | Equal keys happen only with repeated keys | Exercised through the repeated-key tests once they run under coverage; trivial |
| `document-actions.service.ts:438` (`idOf(original) === null`) | Defensive: `pendingSave` has already rejected a document without `_id` | Not reachable; pre-existing line (doc-edit-save) |
| `document-actions.service.ts:267`, `:409`, `:852`, `:876` | Merge with an unknown server version; resolve under a hides-sub-fields projection; `kind: 'none'`; `hasPath` through a scalar | Not changed by this task (`git blame`: doc-edit-save and earlier); out of scope |
| `document-header.ts:29`, `:142`, `:145`, `:177` and template `@if` branches | Diff-bar error text, change count, clone toggling edit mode | Not changed by this task (doc-edit-save); out of scope. The task's button, `canUndoSave` and `undoSave` are covered |
| `apply-update.ts:28` (`a.length - b.length` for one path a prefix of another) | Two ops on a path and its parent, which MongoDB rejects as a path conflict and `diffDocuments` never produces | Non-material; no test |
| `apply-update.ts:37`, `:38`, `:40` (`?? 0`), `:50` (`key === undefined`) | Fallbacks for undefined array items / an empty path that `split` never yields | Not reachable; no test |

## Unable to test

- E2E (`test/e2e/undo-last-save.e2e.ts`, Electron + MongoDB container): not edited and not run here, as instructed. The parent worker runs it in parallel and records it for AC1/AC2.
- TW-1 against real MongoDB: the unit fake server applies the same `replaceOne` filter semantics (`$eq` on the changed field only). A real-server reproduction needs a document with repeated top-level keys inserted as raw BSON. This was not attempted (no container in this session). Follow-up: optional, after the fix.
- Final coverage including the round-3 additions: not available until TW-1 is fixed (see Coverage).
- The round-3 review's CR-1 (multi-edit saves leave the earlier undo offered): this is a scope and disposition decision for the parent. No test was added because no requirement says multi-edit counts as a save.

## Summary

Tests added; production defects were discovered and must be passed to the `fixer` before task completion.

TW-1 (Medium impact, low reachability): on a document with repeated top-level field names, the undo's replace falls back to a changed-field-only check and silently overwrites another client's change, which violates AC2. Every other acceptance criterion and recorded assumption is covered by passing unit tests. The e2e suite is run by the parent worker. Coverage of the task files is verified for the committed tests (aggregate 97.84% statements, 93.73% branches). It must be measured again after the TW-1 fix, because the final run produced no report.

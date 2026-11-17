# Test Report

Date: 2026-11-17

Task: conflict-partial-docs - Conflict view for partly loaded (cut-array) documents

Scope: round 2 (final code). Base 98cd4aaf93fcad419bd6149f972aeaf74bbb3283 .. HEAD 2e11291c738136301f89109dacb8b4b1c49019fe on branch `main`. Task-owned commits (from the parent; checked with `git log`/`git show --stat`): d6159160 (implementation), f382b219 (conflict-view tests, round-1 reports), 2e11291c (fixer: CR-1..3, TW-1/O-1). `git diff 98cd4aa..HEAD` also contains other tasks' work merged into main in between. It is excluded: the task scope is the production files those three commits touch. Uncommitted at measurement: this round's additions to `conflict-view.spec.ts`. `reviews/conflict-partial-docs/review.md` was also modified in the worktree, by someone else (presumably the concurrent code reviewer). I did not touch it.

Requirements:
- `tasks/conflict-partial-docs.md` acceptance criteria 1-3 and its recorded ASSUMPTION (2026-11-17, felix/agent-2)
- `reviews/conflict-partial-docs/review.md` CR-1..CR-3, round-1 `tests.md` TW-1/O-1, `fixes.md`
- `docs/ARCHITECTURE.md` "Paging inside documents", "Coverage"; `SPEC.md` M1 conflict detection

## Test files changed

- `packages/renderer/src/app/document/conflict/conflict-view.spec.ts`

## Tests added or updated

Count: 3 (2 new, 1 strengthened), all in `ConflictView with a partly loaded (cut-array) document`.

- New `a deleted cut document under a top-level projection still names the partial load`: covers the ASSUMPTION combination (cut and deleted, with a projection active). It checks the view's new CR-1 block (one note, the "Inserting your version again is not available" wording, no projection wording, no insert-again button, Keep it deleted) and the re-insert refusal (partial-load wording, not "with a projection active", no `docs.insert`).
- New `leaves a server value that is no object on the way to a dotted cut path as it is`: the server replaced the parent of a cut array with a scalar. The server value is shown as it is, and the note has no "server has" count. This covers the previously uncovered `arrayAt`/`truncateArray` non-object branches (conflict-view.ts:544, :558).
- Strengthened `offers neither Overwrite nor Merge, with the partial-load note, under a top-level projection too`: checks the full partial-blocked note ("Keep the server version, then edit single values again"), that exactly one `conflict-note` is rendered, and that the cut note appears next to it. This is the CR-2 rule for the `'partial'` block.

The fixer's tests for CR-1, CR-2, CR-3 and TW-1/O-1 were reviewed and are adequate. I left them unchanged: `a deleted server version: the partial-load note, ...`, `a document blocked by a projection shows only the projection note (review CR-2)`, `a partial document under a top-level projection (not blocked) keeps the compare note`, `shorter`/`longer` in conflict-view.spec, the CR-1 view assertions in collection-view.spec, and the CR-3 message assertions in document-actions.service.spec.

## Requirement coverage

Focused command (F): `cd packages/renderer && npx ng test --include src/app/document/conflict/conflict-view.spec.ts --include src/app/collection/collection-view.spec.ts --include src/app/document/document-actions.service.spec.ts --include src/app/document/document-editing.spec.ts --coverage --coverage-include='src/app/document/document-actions.service.ts' --coverage-include='src/app/document/conflict/conflict-view.ts'`

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: no never-loaded items listed, whole server array not rendered (300 server items, 100 loaded) | collection-view.spec `compares only the loaded items of the cut array, not the whole server array` | F | Pass |
| AC1: dotted path; server without the array; server non-array; server non-object parent | `compares only the loaded items of a cut array at a dotted path`; `notes a cut array the server version no longer has, ...`; `leaves a server value that is no array ...`; `leaves a server value that is no object on the way to a dotted cut path as it is` (new) | F | Pass |
| AC1: note wording (several arrays, singular, thousands separators); no edits left | `names one note line per cut array, ...`; `with no edits left, ...` | F | Pass |
| AC1 / TW-1, O-1: local cut array edited longer or shorter | `longer: never-loaded server items are neither shown nor counted as differences`; `shorter: shows no never-loaded server items` | F | Pass |
| AC2: conflict note names the partial load (changed server version), one note only | collection-view.spec `names the partial load, not a projection, in the note and the refusals`; `offers neither Overwrite nor Merge, with the partial-load note, under a top-level projection too` (strengthened) | F | Pass |
| AC2: refused-resolve message | document-actions.service.spec `Overwrite and Merge manually are refused for the partial document, nothing is written`; `a cut document is blocked even under a top-level projection` | F | Pass |
| AC2 / CR-1: deleted cut document shows the partial-load note, no insert-again | `a deleted server version: the partial-load note, no insert-again, and re-inserting is refused`; collection-view.spec `refuses to insert the cut document again when it was deleted, naming the partial load`; `a deleted cut document under a top-level projection still names the partial load` (new) | F | Pass |
| AC2 / CR-3: re-insert refusal names the partial load, ends "Keep it deleted.", no "run the query" | document-actions.service.spec `re-inserting a large document deleted on the server is refused (it is partial)`; `a deleted partial document without an active projection gets the partial-load wording` | F | Pass |
| ASSUMPTION: not cut, projection active, so the projection wording is kept | `a deleted server version under a projection keeps the projection wording when not cut` | F | Pass |
| CR-2: one note when blocked by a projection; compare note kept when not blocked | `a document blocked by a projection shows only the projection note (review CR-2)`; `a partial document under a top-level projection (not blocked) keeps the compare note` | F | Pass |
| AC3: failed read-back after Keep server shows the version whole (no cut flags, editable, pager matches real arrays) | collection-view.spec `Keep server version shows the conflict version whole when the read-back fails`; document-actions.service.spec `keepServer shows the conflict version whole (no cut flags) when the read-back fails` | F | Pass |

## Focused test execution

Command:

`F` (above), run 2026-11-17 05:24:39 +01:00 (duration 19.0 s)

Result:

Pass: 4 files, 296 tests passed.

## Full test execution

Command:

`npm run check` (repo root: eslint `--max-warnings 0`, `prettier --check .`, typecheck of all workspaces, root vitest, renderer `ng test`), run 2026-11-17 about 05:25-05:26 +01:00

Result:

Pass. Lint, Prettier and typecheck passed. Root vitest: 76 files / 4132 tests passed. Renderer `ng test`: 98 files / 3214 tests passed.

## .taskcheck

Result:

Pass. `.taskcheck` runs `npm run check` (above); I did not invoke it separately as `.taskcheck`.

## Bugs found

None in this round. TW-1 (round 1) is fixed. Its test `longer: never-loaded server items are neither shown nor counted as differences` now passes unchanged, and the fixer added assertions to it. O-1 is fixed too; `shorter: ...` now asserts it.

## Coverage

Status: verified (focused run F, exit 0, all 296 tests passed, fresh report).

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: measured. I intersected the lcov `DA` records with the added lines of `git diff -U0 98cd4aa..HEAD` for the two files; no other task touched them in that range. Result: document-actions.service.ts 11/11 lines, conflict-view.ts 34/34 lines (45/45 total, 100%). Separately, the lcov `BRDA` branch records located on added lines: 21/21 and 45/46 (66/67). The one miss is conflict-view.ts:542, explained below. Template lines in the component's inline template have no lcov line records and are not in that denominator.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `conflict-partial-docs`. Base 98cd4aaf93fcad419bd6149f972aeaf74bbb3283; HEAD 2e11291c738136301f89109dacb8b4b1c49019fe. Task commits d6159160, f382b219 and 2e11291c come from the parent; the production files they touch were taken from `git show --stat` of those commits.
- Source/test snapshot identifier (including uncommitted inputs): HEAD 2e11291c plus the modified `conflict-view.spec.ts` with sha256 7cf8339f8b29d59388f1ecf42c40a12ae007d514562c50ba9a776307b202cead. Production files at HEAD (unmodified): `conflict-view.ts` 503d3a51a90b7497065f3f65c521dfbee69e225f5735624e7c4eeee829626355 and `document-actions.service.ts` d450125905c83bd036c68be4c63c981bb60c0e9655924eda359a061fcd8ef11b. Other specs at HEAD: `collection-view.spec.ts` 381f9e95..., `document-actions.service.spec.ts` f872d6df..., `document-editing.spec.ts` 06698c37.... I took the hashes at 05:24:26 and again at 05:26:50, and they were identical.
- Exact included files; renamed/deleted/excluded files and reasons: included `packages/renderer/src/app/document/document-actions.service.ts` and `packages/renderer/src/app/document/conflict/conflict-view.ts`. Excluded the task's `*.spec.ts` files (tests) and `reviews/`/`tasks/` files (not code). There are no renames or deletions, and no scoped file is missing from the report.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with v8 coverage through `@angular/build` unit-test. Command F, run in `packages/renderer`, covering 4 spec files.
- Run start/completion time and exit status: 2026-11-17 05:24:39 to 05:24:58 +01:00. 296/296 passed, exit 0.
- Generated report paths and report hashes/run identifier: `packages/renderer/coverage/renderer/coverage-summary.json` sha256 e03faa1d34c783a8d2841637e7aee6b31e59b40b71e66ec57a8500c0cb39d3b1; `packages/renderer/coverage/renderer/lcov.info` sha256 f137ea326a33bdb312f48c4d01a17a572f6e799207ba3e5fac6f8b1290c8b81d. Both were written 05:24:58.5, and the directory was recreated by this run (05:24:39).
- Evidence outputs are fresh and inputs stayed unchanged: yes. The report timestamps fall within this run. An earlier run at 05:23:47 (295 tests, before the dotted non-object test was added) was superseded.
- Final run after latest test additions and production fixes: yes. It ran on HEAD 2e11291c (which includes the fixer's production changes) with all of this round's test additions.

Values below use covered/total (percentage).

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/document/document-actions.service.ts` | 269/272 (98.89%) | 172/177 (97.17%) | 65/65 (100%) | 226/226 (100%) |
| `packages/renderer/src/app/document/conflict/conflict-view.ts` | 220/223 (98.65%) | 141/145 (97.24%) | 36/36 (100%) | 166/167 (99.40%) |
| Aggregate (both files, summed counters; nothing unmeasured or excluded) | 489/495 (98.79%) | 313/322 (97.20%) | 101/101 (100%) | 392/393 (99.75%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `document-actions.service.ts`: branches at 181, 306, 333, 611, 635 | Outside the task's diff hunks (62-74, 207-210, 225-233, 246-251, 268-275, 469-476, 510-537, 582-597) | Pre-existing; not in task scope |
| `conflict-view.ts:542` (`doc ?? undefined`, null side) | `arrayAt` is only called with a non-null server version (`item()` guards `server !== null`) | Unreachable defensive branch; no test added |
| `conflict-view.ts:544`, `:558` (non-object step on a dotted cut path) | Server replaced the cut array's parent with a scalar | Covered now: `leaves a server value that is no object on the way to a dotted cut path as it is` |
| `conflict-view.ts:456, 461, 483, 575` | Pre-existing merge/keepServer/idText paths, outside the task diff | Not in task scope |

## Unable to test

- The "longer" and "shorter" edits end to end through the raw editor in a browser: not done. The component test drives `DocumentEdits.edit` directly, as the raw editor's Apply does. No follow-up needed.
- Dotted cut paths through the real backend: the backend cuts only top-level arrays (`sliceLargeArrays`), so dotted paths are covered at component level only. No follow-up needed.

## Summary

Tests added and all validation passed. The round-1 defect TW-1 and the review findings CR-1..CR-3 are fixed and covered by tests. No new production defects were found.

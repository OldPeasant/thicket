# Test Report

Date: 2026-11-17

Task: conflict-merge-close - Close the conflict merge editor when its conflict disappears or changes state (CR-7 of conflict-ui)

Scope: round 2 (final code): base 6d75b31879dbf63a071886890313241c4f33c4d2 .. HEAD c575ff46fb36f8dda41c34d9b598ff60739ebdfe (task commits 0c620cd, c575ff4), clean working tree. Round 1: base .. 0c620cdd554a6ab5dd59e1f68ba51debe475e2b9 plus uncommitted test additions (kept below).

Requirements:
- tasks/conflict-merge-close.md acceptance criteria
- reviews/conflict-ui/review.md CR-7 (background)
- reviews/conflict-merge-close/review.md CR-1 and fixes.md (round 2)
- docs/ARCHITECTURE.md "Coverage"; existing conventions of document-editing.spec.ts

# Round 2 (final code, HEAD c575ff4)

## Round 2: what changed since round 1

- Production code: unchanged. `conflict-view.ts` has the same content as at 0c620cd
  (sha256 31eb4f72...a65d60); c575ff4 touches only `document-editing.spec.ts` and `reviews/`.
- Tests: the fixer added `stays closed when the deleted conflict changes in place to a readable version`
  (CR-1). It covers the one path where the template guard alone would hide the stale editor:
  the conflict entry turns deleted, then is replaced in place by a readable "changed" conflict.
  Per fixes.md, this test fails when the closing effect is disabled.

## Round 2: test files changed

- None in this round. No new tests were added: every changed line is executed, there are no uncovered
  branches on changed lines, and both acceptance criteria plus the CR-1 path have tests. The remaining
  uncovered locations are the same pre-existing defensive code as in round 1, so no real gaps remain.

## Round 2: requirement coverage

Command for all rows: `npx ng test --include='src/app/document/**/*.spec.ts'` (from `packages/renderer`, run with the coverage flags below)

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: closes on revert / Revert all | `closes on a revert from the document header; a later conflict starts afresh`, `closes on Revert all from the edit bar` | as above | Pass |
| AC1: closes on edit-bar save | `closes when a save from the edit bar succeeds` | as above | Pass |
| AC1: closes when the server version is deleted / unknown | `closes when Save merged finds the document deleted, offering the deleted actions`, `closes when Save merged finds a server version it cannot read`, `stays closed when the deleted conflict changes in place to a readable version` | as above | Pass |
| AC2: later conflict offers Keep server / Overwrite / Merge with fresh text | the revert / Revert all / edit-bar-save tests, `does not show an earlier merge syntax error on a later conflict`, `stays closed when the deleted conflict changes in place to a readable version` | as above | Pass |
| Closing applies only to the conflict being merged | four `with a second conflict on another document` tests | as above | Pass |

## Round 2: focused test execution

Command (cwd `packages/renderer`):

`npx ng test --include='src/app/document/**/*.spec.ts' --coverage --coverage-include='src/app/document/conflict/conflict-view.ts' --coverage-reporters=json-summary --coverage-reporters=text --coverage-reporters=json`

Result:

Pass: 6 files, 254 tests passed.

## Round 2: full test execution and .taskcheck

Not rerun by the test-writer in this round. Since round 1, the only change is one added test. The fixer
reports `npm run check` (= `.taskcheck`) passing on this code: root 3530 tests, renderer 2429 tests.
The parent runs `.taskcheck` as final validation.

## Round 2: bugs found

None.

## Round 2: coverage

Status: verified

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: measured. Every statement that starts on a changed new-side line (121, 145, 367-371, 377, 421, 470) has hits > 0: line 367 has 67 hits, 368 has 118, 369 has 118/82, 370 has 36, 371 has 36/7/7, 377 has 250, 421 has 15 and 470 has 32. No uncovered branch is on a changed line. The method is the same as in round 1: statement/branch start lines from `coverage-final.json`, intersected with the added lines of `git show 0c620cd`.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: conflict-merge-close; base 6d75b31879dbf63a071886890313241c4f33c4d2 (from parent); HEAD c575ff46fb36f8dda41c34d9b598ff60739ebdfe; task commits 0c620cd and c575ff4 (`git log 6d75b31..HEAD`). The only production file is conflict-view.ts.
- Source/test snapshot identifier: the working tree was clean. conflict-view.ts sha256 31eb4f7297acd217d04d1f8a54b99ab86d816267c848c84f522751fa83a65d60; document-editing.spec.ts sha256 06698c3729ae493426a0f36a01d960d19ab4f1e7d68c40b4bc51d0e9c49b8dbb. Both hashes were identical before the run (03:56:22) and after it (03:56:43).
- Exact included files: `packages/renderer/src/app/document/conflict/conflict-view.ts`. No renames, deletions or exclusions of production files.
- Provider/version, command, working directory, and test selection: Vitest v5.1.0 with the v8 provider (Angular builder), run with the command above in `packages/renderer` on `src/app/document/**/*.spec.ts`.
- Run start/completion time and exit status: tests started 03:56:30 +0100 and the report was written 03:56:41 +0100. Exit 0, 254/254 passed.
- Generated report paths and report hashes: `packages/renderer/coverage/renderer/coverage-final.json`, sha256 f313d1d86d461b5fbfc844caf10901d5b87fd0182ba28407ee93e02540e596b0. The directory also has `coverage-summary.json` (git-ignored).
- Evidence outputs are fresh and inputs stayed unchanged: report mtimes are 03:56:41, inside this run, and the input hashes did not change.
- Final run after latest test additions and production fixes: yes. The run is on HEAD c575ff4, which includes the fixer's test; no production fix was made.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/document/conflict/conflict-view.ts` | 182/185 (98.37%) | 106/109 (97.24%) | 29/29 (100%) | 134/135 (99.25%) |

The aggregate equals the single file; no files are missing or unmeasured.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `conflict-view.ts:408` (stmt + if) | Pre-existing: keepServer closes its own merge | Unreachable from the UI (Keep server is hidden while merging); same as round 1 |
| `conflict-view.ts:413` (stmt + if) | Pre-existing openMerge guard `local === null` | Unreachable from the UI; same as round 1 |
| `conflict-view.ts:435` (cond-expr) | Pre-existing branch for a non-Error throw | Not material; same as round 1 |
| `conflict-view.ts:477` (stmt) | Pre-existing idText fallback | Outside the task scope; same as round 1 |

## Round 2: summary

Tests and task-scoped coverage are sufficient; no production defects found. No additional tests were necessary in round 2.

# Round 1 (kept for reference, HEAD 0c620cd plus uncommitted tests)

## Test files changed

- `packages/renderer/src/app/document/document-editing.spec.ts`

## Tests added or updated

Count: 5 added (the parent's 5 CR-7 tests in commit 0c620cd were kept unchanged)

All added inside describe `conflict view > when the conflict being merged goes away or changes (CR-7)`:

- `does not show an earlier merge syntax error on a later conflict`
- `with a second conflict on another document > keeps the open editor and its text when the other document is reverted`
- `... > keeps the open editor and its text when the other conflict keeps the server version`
- `... > keeps the open editor and its text when the other conflict is overwritten`
- `... > keeps the open editor when the other conflict finds its document deleted`

The two-conflict tests guard against an over-eager fix (closing the editor on any change of the
conflict map): each checks the typed merge text survives and that Save merged then sends the merged
`$set` for order 1 with the expected filter of its own server version.

## Requirement coverage

Command for all rows: `cd packages/renderer && npx ng test --include='src/app/document/**/*.spec.ts'`

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: editor closes when its conflict is removed - revert | `closes on a revert from the document header; a later conflict starts afresh`, `closes on Revert all from the edit bar` (parent) | as above | Pass |
| AC1: editor closes - edit-bar save | `closes when a save from the edit bar succeeds` (parent) | as above | Pass |
| AC1: editor closes when server version is deleted / unknown | `closes when Save merged finds the document deleted, offering the deleted actions`, `closes when Save merged finds a server version it cannot read` (parent) | as above | Pass |
| AC2: later conflict offers Keep server / Overwrite / Merge with fresh merge text | the three "closes on revert / Revert all / edit-bar save" tests (parent); `does not show an earlier merge syntax error on a later conflict` (new) | as above | Pass |
| Closing is scoped to the merged conflict only (no regression with several conflicts) | the four `with a second conflict on another document` tests (new) | as above | Pass |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/app/document/**/*.spec.ts'`

Result:

Pass - 6 files, 253 tests passed.

Note: the new error-reset test cannot pass on the pre-fix code by analysis (mergeKey/mergeError would
survive the revert, so `expectResolutions()` fails on the next conflict); it was not run against the
pre-fix revision because that would require changing production code. The parent reported running the
5 original tests against the pre-fix code (all failed).

## Full test execution

Command:

`npm run check` (repository root; lint + Prettier, typecheck of all workspaces, root vitest, renderer `ng test`)

Result:

Pass - exit 0; root vitest 64 files / 3530 tests, renderer 80 files / 2428 tests.

## .taskcheck

Result:

Pass - `.taskcheck` runs `npm run check`, run as above (exit 0) on the working tree with the new tests.

## Bugs found

None.

## Coverage

Status: verified

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: measured - every executable line of the task diff in conflict-view.ts
(new-side lines 121, 145, 367-371, 377, 421, 470 per the v8 statement map) has hits > 0, and no
uncovered branch lies on a changed line. Method: intersect `coverage-final.json` statement/branch
start lines with the added/modified lines of `git show 0c620cd -- .../conflict-view.ts`.
Changed-branch coverage is not separately computed beyond that check.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: conflict-merge-close; base 6d75b31879dbf63a071886890313241c4f33c4d2 (from parent); HEAD 0c620cdd554a6ab5dd59e1f68ba51debe475e2b9; one task commit 0c620cd, which touches only conflict-view.ts and document-editing.spec.ts.
- Source/test snapshot identifier (including uncommitted inputs): conflict-view.ts sha256 31eb4f7297acd217d04d1f8a54b99ab86d816267c848c84f522751fa83a65d60 (unchanged from HEAD); document-editing.spec.ts (uncommitted, with new tests) sha256 038bbebdde93cd7b794de22cceb3bdbc84549cc3552018da4b5365b1e93ce472. Hashes identical before and after the run.
- Exact included files; renamed/deleted/excluded files and reasons: included `packages/renderer/src/app/document/conflict/conflict-view.ts`; excluded `document-editing.spec.ts` (test file). No renames or deletions.
- Provider/version, command, working directory, and test selection: Vitest v5.1.0 with v8 provider via Angular builder; `npx ng test --include='src/app/document/**/*.spec.ts' --coverage --coverage-include='src/app/document/conflict/conflict-view.ts' --coverage-reporters=json-summary --coverage-reporters=text --coverage-reporters=json` in `packages/renderer`.
- Run start/completion time and exit status: started 2026-11-17 03:47:52 +0100, report written 03:48:03 +0100; exit 0, 253/253 tests passed.
- Generated report paths and report hashes/run identifier: `packages/renderer/coverage/renderer/coverage-final.json` sha256 55a2310bb03b6e7f2a95eafc9552bb253dcaff51f2dcf9a6a860849cae7a8a02; `packages/renderer/coverage/renderer/coverage-summary.json` (git-ignored).
- Evidence outputs are fresh and inputs stayed unchanged: coverage directory recreated by this run (mtimes 03:47:52-03:48:03); input hashes matched before and after.
- Final run after latest test additions and production fixes: yes (no production fixes were made).

Values below use covered/total (percentage).

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/document/conflict/conflict-view.ts` | 182/185 (98.37%) | 106/109 (97.24%) | 29/29 (100%) | 134/135 (99.25%) |

Aggregate equals the single file above; no files missing or unmeasured.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `conflict-view.ts:408` (keepServer closes the merge of its own key) | Pre-existing, not changed by the task | Not reachable via the UI: Keep server is not rendered for the conflict being merged. Now also redundant with the new effect. No test added. |
| `conflict-view.ts:413` (openMerge guard `local === null`) | Pre-existing defensive guard | Merge button is hidden when `local === null`; not reachable via UI. No test added. |
| `conflict-view.ts:435` (non-Error thrown by parser) | Pre-existing defensive branch | Parser throws `ShellSyntaxError`; not material. |
| `conflict-view.ts:477` (idText catch) | Pre-existing fallback for an unparsable key | Outside task scope. |

## Unable to test

- Nothing in this task's criteria required a browser or container; all criteria are component-level and were run.

## Summary

Tests added and all validation passed. Tests and task-scoped coverage are sufficient; no production defects found.

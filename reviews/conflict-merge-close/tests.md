# Test Report

Date: 2026-11-17

Task: conflict-merge-close - Close the conflict merge editor when its conflict disappears or changes state (CR-7 of conflict-ui)

Scope: base 6d75b31879dbf63a071886890313241c4f33c4d2 .. HEAD 0c620cdd554a6ab5dd59e1f68ba51debe475e2b9 (single task commit 0c620cd on main), plus the uncommitted test additions below.

Requirements:
- tasks/conflict-merge-close.md acceptance criteria
- reviews/conflict-ui/review.md CR-7 (background)
- docs/ARCHITECTURE.md "Coverage"; existing conventions of document-editing.spec.ts

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

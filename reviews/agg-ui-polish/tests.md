# Test Report

Date: 2026-11-17

Task: agg-ui-polish - Aggregation builder: stage-named preview announcements, no previews in text mode

Scope: base `317b9fc2212558f875e5d5cbb4c9fa0343ca865c`, task commit `afa9e3c` (diff
`git diff 317b9fc..afa9e3c`, supplied by the parent). At measurement time HEAD was
`62691399875af44abf968fad609ffc5628346a66` (the task commit rebased, plus two `assume` commits);
`git diff afa9e3c..HEAD` touches only `tasks/agg-ui-polish.md`, so the production code measured is
identical to `afa9e3c`. Uncommitted input: this report's spec changes in
`packages/renderer/src/app/aggregation/aggregation-view.spec.ts` (test file only).

Requirements:
- `tasks/agg-ui-polish.md` acceptance criteria 1 (CR-8) and 2 (CR-9)
- `reviews/agg-ui/review.md` CR-8, CR-9
- `docs/ARCHITECTURE.md` "Aggregation builder" (previews paragraph updated by the task) and "Coverage"
- Existing agg-ui behavior in the spec ("the next edit anywhere asks for a failed preview again")

## Test files changed

- `packages/renderer/src/app/aggregation/aggregation-view.spec.ts`

## Tests added or updated

Count: 11 added by the test-writer (the 3 tests and 2 live-region test updates in the task commit
were reviewed and kept as they are).

Added, in `describe('previews around full-text mode (agg-ui-polish)')`:
1. `keeps the previews of the stages before one removed at the end in the text`
2. `reads only a stage appended in the text` (also: Run in text mode with the appended stage sends no preview)
3. `reads every remaining stage again when the first one is removed in the text`
4. `a stage inserted in the middle of the text reads it and the stages after it`
5. `Explain in full-text mode applies the text but reads no previews`
6. `a Run refused for a text parse error reads no previews either`
7. `switching back and forth without edits reads nothing again`
8. `a failed preview is not asked again in text mode, and the good ones are kept on return`
9. `a collection change in text mode reads nothing until the stage list is back`
10. `stays silent in every reloading stage until its result names it` (3 stages loading at once, answers out of order)

Added in `describe('preview debounce')` (fake timers):
11. `a preview still waiting for the pause is dropped on entering full-text mode (agg-ui-polish)`

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: the live region names its stage ("Stage N: ...") | `announces the preview status in a live region that persists across preview reloads`, `the live region counts every previewed stage and is empty for stages without a preview`, `names its stage in each announcement after one edit reloads several stages`, `stays silent in every reloading stage until its result names it`, tests 1-3, 8 | `cd packages/renderer && npx ng test --include src/app/aggregation/aggregation-view.spec.ts` | Pass |
| AC1: the live region stays silent while loading | `announces the preview status in a live region ...` (stage 1), `stays silent in every reloading stage until its result names it` (all three downstream stages) | same | Pass |
| AC2: no `agg.previewStage` while in full-text mode | `sends no previews in full-text mode and re-previews only changed stages on return` (Run, Create view), tests 2, 5, 6, 8, 9, 11, `entering full-text mode stops a loading preview and asks again on return` | same | Pass |
| AC2: return to stage mode does not re-preview stages whose prefix did not change | `sends no previews in full-text mode and re-previews only changed stages on return`, tests 1, 2, 3, 4, 5, 7, 8 | same | Pass |
| Loading previews aborted on entering text mode and asked again on return (ARCHITECTURE) | `entering full-text mode stops a loading preview and asks again on return`, test 11 (pending debounce timer) | same | Pass |
| No regression in the rest of the project | full `npm run check` (lint, typecheck, all unit/component tests) | `npm run check` (repo root) | Pass |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include src/app/aggregation/aggregation-view.spec.ts`

Result:

Pass - 104 tests passed (93 before the additions, 11 added).

## Full test execution

Command:

`npm run check` (repo root: `eslint . --max-warnings 0 && prettier --check .`, typecheck, `npm run test` for all workspaces)

Result:

Pass - core/main workspaces 73 files / 4038 tests passed; renderer 87 files / 2756 tests passed.
(The first run failed only on `prettier --check` for the new spec code; the spec was formatted
with `npx prettier --write` on that file and the rerun passed.)

## .taskcheck

Result:

Pass - `.taskcheck` runs `npm run check`; see "Full test execution".

## Bugs found

None. No production defects were found.

Ambiguity for the parent (not filed as a bug): a stage whose preview failed is asked again on the
return to stage mode even when its prefix did not change. This follows the existing agg-ui rule
"a failed preview is forgotten, so the next scheduling pass (any edit) asks again" (comment at
`aggregation-view.ts:449` and the spec `the next edit anywhere asks for a failed preview again`),
but a literal reading of AC2 / the ARCHITECTURE sentence "only stages whose prefix changed are
read again" does not mention it. Test 8 asserts only what is unambiguous (no request in text mode;
the successfully previewed stages are not read again) and does not pin the failed stage's retry
either way.

Mutation check ("tests fail without the fix"): not executed. Temporarily reverting
`aggregation-view.ts` was not possible: the permission system denied the command that backed up the
production file, and this role must not modify production code. By reading the code, the tests
would catch these reverts:
- Effect without the `mode() === 'text'` guard: a Run/Explain in text mode after a text edit
  schedules previews -> fails `sends no previews in full-text mode ...` (after the `$region` edit),
  tests 2, 5 and 9.
- `applyText()` back to fresh ids: every stage is re-read on return -> fails
  `sends no previews ... re-previews only changed stages`, tests 1, 2, 7.
- `pausePreviews()` aborting finished (`ok`) runs too: the same tests fail (ok runs forgotten -> re-read).
- `pausePreviews()` not aborting loading runs: the late answer is stored as `ok` with an unchanged
  key, so nothing is re-read -> fails `entering full-text mode stops a loading preview ...`.
- `pausePreviews()` without `clearTimeout`: the pending debounce fires in text mode -> fails test 11.
- `previewStatus()` without the "Stage N:" prefix or with "Loading preview…" back: fails the
  live-region tests and test 10.
The parent may want to run these reverts itself if it needs executed evidence.

## Coverage

Status: verified (whole-file coverage of the one task-changed TypeScript production file).

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: measured by hand from the provider's `lcov.info` for the added/modified
executable lines of `aggregation-view.ts` (264, 265, 362, 363, 398-402, 472-478): every DA line has
hits > 0 and every BRDA on those lines (264, 363, 400, 472, 474, 477; 12 branch outcomes) is
taken at least once: 15/15 lines, 12/12 branches. Lines 401-402 (abort a loading run) are hit
once, by `entering full-text mode stops a loading preview ...`.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `agg-ui-polish`;
  base `317b9fc2212558f875e5d5cbb4c9fa0343ca865c`; measured HEAD
  `62691399875af44abf968fad609ffc5628346a66`; task commit `afa9e3c` and scope from the parent;
  `git diff afa9e3c..HEAD` only touches `tasks/agg-ui-polish.md`.
- Source/test snapshot identifier (including uncommitted inputs): sha256
  `aggregation-view.ts` aede0c89b5893e1eb36a471fdcb3d80f15f8a5f9a721284263c3b00d172b0054,
  `aggregation-view.html` 2e76d14611f2987adef4d94640d8818227d3396f6faf92ac1ed42c6359033c7d,
  `aggregation-view.spec.ts` (uncommitted, after prettier) 612f48902e61dbac6b4d9769902667e6f51bb65b283a93699f5f61297aab4b18 (same hash before and after the run).
- Exact included files; renamed/deleted/excluded files and reasons: included
  `packages/renderer/src/app/aggregation/aggregation-view.ts`. Excluded: `aggregation-view.html`
  (Angular template, not instrumented by v8; its one change, `previewStatus(stage.id, i + 1)`, is
  exercised by the "Stage 2/3" assertions after a move), `aggregation-view.spec.ts` (test),
  `docs/ARCHITECTURE.md` (documentation). No renamed or deleted files.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with
  `@vitest/coverage-v8` 5.1.0 via the Angular builder;
  `npx ng test --include src/app/aggregation/aggregation-view.spec.ts --coverage --coverage-include=src/app/aggregation/aggregation-view.ts`
  in `packages/renderer`; selection: the one spec file (104 tests).
- Run start/completion time and exit status: start time not captured; completed 2026-11-17
  04:51:05 +01:00 (report file timestamps); 104 passed, coverage summary printed, no failure.
- Generated report paths and report hashes/run identifier: `packages/renderer/coverage/renderer/lcov.info`
  sha256 d7d6032d840c67b040d4e38eda9e3695f4d06103badccead27e8ae28c880d96d;
  `packages/renderer/coverage/renderer/coverage-summary.json` sha256
  6d18270ef38d9f74d06a02474c711df26bf137137d7b4a19d8dcd0dddd84cc23 (Git-ignored).
- Evidence outputs are fresh and inputs stayed unchanged: report files timestamped by this run; the
  lcov contains exactly one `SF:` (the included file); spec hash unchanged across the run. An
  earlier run before the prettier reformat gave identical counters.
- Final run after latest test additions and production fixes: yes (no production fixes were made).

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/aggregation/aggregation-view.ts` | 326/335 (97.31%) | 150/165 (90.9%) | 79/79 (100%) | 278/279 (99.64%) |

Aggregate = the single file above. Not measured: `aggregation-view.html` (template, see above).

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `aggregation-view.ts:247` (line + both branches), BRDA 153, 228, 302, 305, 337, 422, 445, 450, 482, 493, 546, 621, 648 | Pre-existing agg-ui code (codegen throw, defensive guards, retry without plan, etc.), not changed by this task | Outside the task's changed lines; no test added |
| Changed lines 264-265, 362-363, 398-402, 472-478 | AC1, AC2 | Fully covered (see changed-line coverage) |

## Unable to test

- Executed "fails without the fix" mutation runs: not run (permission denied for backing up and
  temporarily reverting the production file; see "Bugs found"). Follow-up optional for the parent.
- Real screen-reader announcement order of the polite live regions: not testable in the component
  test environment; the tests assert the live-region text content only.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. 11 tests added; the
focused spec (104 tests) and `npm run check` pass. One ambiguity (failed previews are retried on
return to stage mode) is reported for the parent to decide.

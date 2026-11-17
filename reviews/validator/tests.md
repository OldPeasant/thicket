# Test Report

Date: 2026-11-17

Task: validator - M3 (Should): Collection validator

Scope: second pass, final revision. Task commits after base `1fef92fde38609ff3d0ebadae6fbbff5145caef1` up to HEAD `6a0b73ef449ce7dbb3581eeee2e62e03664de3a0` on `main`: 5e290eb (backend and integration test), 7f1e0ec (validator tab and markers), 0fd662a (e2e and architecture notes), 096e68a (unit tests and first-pass reports), 6a0b73e (fixer: CR-1, CR-3, CR-4, CR-5). Uncommitted input: this pass's additions to `packages/renderer/src/app/validator/validator-view.spec.ts`. There are no uncommitted production changes. `reviews/validator/review.md` is also modified in the working tree. This helper did not change it.

Requirements:
- `tasks/validator.md` acceptance criteria and recorded assumptions
- `SPEC.md` M3 "Collection validator", `docs/ARCHITECTURE.md` (Coverage, Conventions), `AGENTS.md`
- `reviews/validator/review.md` findings CR-1, CR-3, CR-4, CR-5 and `reviews/validator/fixes.md` (the behaviour the fixes must now guarantee)
- Parent instructions for the second pass

## Test files changed

First pass (committed in 096e68a):
- `packages/backend/src/browse/validator/validator.spec.ts`
- `packages/backend/src/browse/validator/handlers.spec.ts`
- `packages/renderer/src/app/validator/validator.model.spec.ts`
- `packages/renderer/src/app/validator/validator-marks.service.spec.ts`
- `packages/renderer/src/app/validator/validator-view.spec.ts`
- `packages/renderer/src/app/collection/collection-view.spec.ts`

Fixer (committed in 6a0b73e, reviewed in this pass): `validator-view.spec.ts`, `validator-marks.service.spec.ts`, `collection-view.spec.ts`.

This pass (uncommitted):
- `packages/renderer/src/app/validator/validator-view.spec.ts`

## Tests added or updated

Count: 4 tests added in this pass. All are in `validator-view.spec.ts`:
- "Ctrl+Enter right after a successful save sends no second collMod". This is a CR-3 regression test: once a save succeeds, the editor is clean again, so a repeated shortcut sends no no-op `collMod`.
- "Ctrl+Enter saves a change of the level alone, with the stored validator". The new `dirty()` guard must still allow saves that change only the level or action.
- "unlocks the editor after a refused save, and a retry sends again". CR-4 lock: the editor stays locked while the save is pending, is released after a server refusal, keeps the edit, and lets the user retry.
- "locks the editor while the confirmation is open and unlocks it after Cancel". CR-4 on a production profile: the editor is locked while the confirmation dialog is open and is unlocked with the text kept after Cancel.

The fixer's tests are adequate, so I did not change them: check-error notice shown and cleared, Ctrl+Enter or a direct save without a change, Ctrl+Enter on production without a change, read-only Ctrl+Enter or direct save, editor/selects/template locked while saving, per-collection `ValidatorChanges` signal, and no re-check from another collection's change. The fixer replaced the read-only spec "refuses a save called directly". The replacement checks the behaviour that CR-3 requires: nothing is sent and the edit is kept. It does not weaken a requirement.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: integration test; set validator; the check method flags an invalid doc | `test/integration/validator.int.spec.ts` (run by the parent on this revision: 14 passed). Unit level: `checkValidator` and handler specs in `packages/backend/src/browse/validator/*.spec.ts` | `cd packages/backend && npx vitest run src/browse/validator src/server/backend.spec.ts --coverage …` | Unit: Pass (102/102). Integration: not run by this helper; the parent reports 14 passed |
| AC2: e2e; edit the validator; a failing document shows a marker | `test/e2e/validator.e2e.ts` (run by the parent on this revision: 1 passed). Unit level: CollectionView `validator marks` block, ValidatorView save specs | `cd packages/renderer && npx ng test --include='src/app/validator/**/*.spec.ts' --include='src/app/collection/collection-view.spec.ts'` | Unit: Pass (148/148). e2e: not run by this helper; the parent reports 1 passed |
| CR-1: a failed check is visible and is cleared by a successful check | "says why when the check fails, and drops the notice after a successful check" (collection-view.spec.ts) | renderer focused command above | Pass |
| CR-3: Ctrl+Enter and direct `save()` do nothing when Save is disabled (unchanged, saving, read-only) | "Ctrl+Enter without a change sends nothing…", "Ctrl+Enter right after a successful save sends no second collMod", "a second Save while one is running sends nothing", "Ctrl+Enter without a change asks nothing" (production), "Ctrl+Enter and a direct save do nothing…" (read-only), "Ctrl+Enter saves a change of the level alone…" (guard does not block real changes) | renderer focused command above | Pass |
| CR-4: the editor is locked while saving, unlocked afterwards (success, refusal, Cancel) | "locks the editor while saving…", "locks the template button while saving", "unlocks the editor after a refused save, and a retry sends again", "locks the editor while the confirmation is open and unlocks it after Cancel" | renderer focused command above | Pass |
| CR-5: a validator change re-checks only that collection's tabs | "notifies readers of the changed collection only" (validator-marks.service.spec.ts), "keeps this tab's marks when the validator of another collection changes" (asserts no new check) | renderer focused command above | Pass |
| Backend parse/limits/get/set/check/handlers, renderer model and marks service (first-pass rows) | first-pass specs, unchanged | `npm run check` | Pass |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/app/validator/**/*.spec.ts' --include='src/app/collection/collection-view.spec.ts'`

Result:

Pass: 4 files, 148 tests.

## Full test execution

Command:

`npm run check` (repository root: eslint and prettier --check, tsc for every workspace, root `vitest run`, renderer `ng test`)

Result:

Pass. Lint and Prettier clean, typecheck clean, root vitest 75 files / 4100 tests passed, renderer 92 files / 2948 tests passed. This run includes this pass's added tests.

## .taskcheck

Result:

Pass. `.taskcheck` runs `npm run check`, which passed on the final test snapshot. I did not invoke `.taskcheck` separately.

## Bugs found

No production defects found. No test fails.

The first-pass observations (silent check error, every tab re-checked on any change) were reported as CR-1 and CR-5. The fixer fixed both, and tests now cover them.

## Coverage

Status: verified. All three coverage runs exited 0 on the final snapshot: production at HEAD 6a0b73e plus the uncommitted test additions.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured. I compared the uncovered branch lines from `lcov.info` with the hunks of `git diff 1fef92f..HEAD`. In `collection-view.ts`, `workspace.service.ts` and `backend.ts`, every uncovered location lies outside the task's added lines. The task's lines in `collection-view.ts` are new 148-164, 368-389 and 587-606. In the task-new files, the remaining gaps are listed in the table below.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `validator`. Base `1fef92fde38609ff3d0ebadae6fbbff5145caef1` (parent-supplied). HEAD `6a0b73ef449ce7dbb3581eeee2e62e03664de3a0`. Commits 5e290eb, 7f1e0ec, 0fd662a, 096e68a, 6a0b73e. Ownership was established from the parent-supplied commit list, confirmed with `git log 1fef92f..HEAD` (all by dell26/agent-1) and `git diff --stat 1fef92f..HEAD`.
- Source/test snapshot identifier (including uncommitted inputs): sha256 prefixes. They were identical before and after the coverage runs. Production: backend `validator.ts` de772128, `handlers.ts` 797aaba2, `backend.ts` fd9f22f2; contract `coll.ts` e01be718; renderer `validator-view.ts` ffa0b7c5, `validator-marks.service.ts` 39416998, `validator.model.ts` 6ec6c0db, `collection-view.ts` 6c34b532, `collection-view.html` 95d8220e, `validator-view.html` 7a94856e. Tests: `validator-view.spec.ts` 136a1d8b (uncommitted), `validator-marks.service.spec.ts` 919caa8c, `collection-view.spec.ts` 72ab8db8.
- Exact included files:
  - backend: `src/browse/validator/validator.ts`, `src/browse/validator/handlers.ts`, `src/browse/validator/index.ts`, `src/browse/index.ts`, `src/server/backend.ts`
  - contract: `src/coll.ts`
  - renderer: `src/app/validator/validator-view.ts`, `validator-marks.service.ts`, `validator.model.ts`, `index.ts`, `src/app/collection/collection-view.ts`, `src/app/layout/workspace.service.ts`, `src/app/sidebar/sidebar-tree.service.ts`, `src/app/app.config.ts`

  Excluded:
  - `collection-view.html/.css` and `validator-view.html/.css`: templates and styles. v8 does not instrument them; the component specs exercise them through DOM assertions.
  - `docs/ARCHITECTURE.md`, test files, `test/integration`, `test/e2e`, `reviews/`.

  No files were renamed or deleted.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with `@vitest/coverage-v8`.
  - `packages/backend`: `npx vitest run src/browse/validator src/browse/index.spec.ts src/server/backend.spec.ts --coverage --coverage.reportsDirectory=coverage/validator-pass2 --coverage.include=…` (the five backend files above) `--coverage.reporter=text --coverage.reporter=json-summary`. 3 files and 102 tests ran; `src/browse/index.spec.ts` does not exist and matched nothing.
  - `packages/contract`: `npx vitest run --coverage --coverage.reportsDirectory=coverage/validator-pass2 --coverage.include='src/coll.ts' --coverage.reporter=text --coverage.reporter=json-summary`. All contract specs ran.
  - `packages/renderer`: `npx ng test --coverage` with one `--coverage-include='src/app/…'` per renderer file listed above (8 flags). The full renderer suite ran: 92 files, 2948 tests.
- Run start/completion time and exit status: all exited 0.
  - backend: 2026-11-17T04:56:12 to 04:56:16 +01:00
  - contract: 04:56:22 to 04:56:23
  - renderer: 04:56:24 to 04:56:53
- Generated report paths and report hashes/run identifier:
  - `packages/backend/coverage/validator-pass2/coverage-summary.json`: sha256 1fc9b0ea…
  - `packages/contract/coverage/validator-pass2/coverage-summary.json`: sha256 fc2cb418…
  - `packages/renderer/coverage/renderer/coverage-summary.json`: sha256 ba653ff9…, mtime 04:56:53
  - `packages/renderer/coverage/renderer/lcov.info`: sha256 14f597f4…
- Evidence outputs are fresh and inputs stayed unchanged: yes. The backend and contract runs wrote to new directories. The renderer report is timestamped within its run. The production and test hashes were the same before and after the runs.
- Final run after latest test additions and production fixes: yes. All three runs came after the fixer's commit 6a0b73e and after this pass's last spec change.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/browse/validator/validator.ts` | 47/47 (100%) | 39/40 (97.5%) | 10/10 (100%) | 40/40 (100%) |
| `packages/backend/src/browse/validator/handlers.ts` | 4/4 (100%) | N/A (0/0) | 4/4 (100%) | 4/4 (100%) |
| `packages/backend/src/browse/validator/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/backend/src/browse/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/backend/src/server/backend.ts` | 54/62 (87.1%) | 16/18 (88.9%) | 16/23 (69.6%) | 51/57 (89.5%) |
| `packages/contract/src/coll.ts` | 8/8 (100%) | N/A (0/0) | N/A (0/0) | 8/8 (100%) |
| `packages/renderer/src/app/validator/validator-view.ts` | 87/88 (98.9%) | 45/49 (91.8%) | 15/15 (100%) | 78/78 (100%) |
| `packages/renderer/src/app/validator/validator-marks.service.ts` | 49/50 (98.0%) | 24/25 (96.0%) | 10/10 (100%) | 39/39 (100%) |
| `packages/renderer/src/app/validator/validator.model.ts` | 14/14 (100%) | 7/8 (87.5%) | 2/2 (100%) | 12/12 (100%) |
| `packages/renderer/src/app/validator/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/renderer/src/app/collection/collection-view.ts` | 266/273 (97.4%) | 141/163 (86.5%) | 78/79 (98.7%) | 227/227 (100%) |
| `packages/renderer/src/app/layout/workspace.service.ts` | 55/55 (100%) | 37/38 (97.4%) | 16/16 (100%) | 38/38 (100%) |
| `packages/renderer/src/app/sidebar/sidebar-tree.service.ts` | 235/235 (100%) | 103/103 (100%) | 67/67 (100%) | 188/188 (100%) |
| `packages/renderer/src/app/app.config.ts` | 1/1 (100%) | N/A (0/0) | N/A (0/0) | 1/1 (100%) |
| **Aggregate (summed counters, measured files above)** | 820/837 (98.0%) | 412/444 (92.8%) | 218/226 (96.5%) | 686/692 (99.1%) |

The aggregate leaves out the HTML/CSS templates and styles, which v8 cannot instrument. Every scoped `.ts` file was measured; none is missing. The renderer totals differ from the first pass because the files changed: the fixer edited `validator-view.ts` and `validator-marks.service.ts`, and the rebase onto a newer main changed `collection-view.ts` and `sidebar-tree.service.ts`.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `backend/src/browse/validator/validator.ts:29` (non-`Error` arm of the message ternary) | None: `BSON.EJSON.parse` always throws `Error` | Justified gap (defensive) |
| `backend/src/server/backend.ts:68-78,84` | Code that existed before this task. The task changed one line (handler registration), and that line is covered | Out of task scope |
| `renderer/src/app/validator/validator-view.ts:73-75` (`??` fallbacks for a tab without `data`) | A validator tab is always opened with collection data (`openValidator`) | Justified gap |
| `renderer/src/app/validator/validator-view.ts:159` (`revert` with `saved === null`) | Unreachable from the UI: the form appears only once `saved` is set | Justified gap |
| `renderer/src/app/validator/validator-view.ts:172` (new `save()` guard) | CR-3 and CR-4 | All three arms covered: saving, not dirty, read-only, plus the pass-through. Tests added in this pass |
| `renderer/src/app/validator/validator-marks.service.ts:90` (`aborted` after a successful answer) | `ApiService.request` rejects on abort, so a success after an abort cannot reach this line. Stale answers are covered through the reject path | Justified gap (defensive) |
| `renderer/src/app/validator/validator-marks.service.ts` `ValidatorChanges.versionOf` (lazy per-key signal) | CR-5 | Fully covered |
| `renderer/src/app/validator/validator.model.ts:51` (non-`Error` arm) | The parser throws only `ShellSyntaxError` | Justified gap (defensive) |
| `renderer/src/app/collection/collection-view.ts` lines 187-189, 220, 225, 228, 255, 313, 337-338, 363, 437, 470, 476-477, 489, 500, 502, 520, 544, 552, 558 (22 branch arms, 1 function) | All in code that existed before this task. Every branch in the task's new lines (148-164, 368-389, 587-606) is covered | Out of task scope |
| `renderer/src/app/layout/workspace.service.ts:85` (1 branch arm) | Code that existed before this task. The task changed only the `TabKind` union | Out of task scope |

## Unable to test

- AC1 and AC2 need real MongoDB containers and the Electron/Playwright stack. This helper did not re-run them. The parent reports `test/integration/validator.int.spec.ts` (14 passed) and `test/e2e/validator.e2e.ts` (1 passed) on this revision, and should record that evidence with `tasks.py verify`.
- The HTML/CSS of the validator tab, the check-error notice and the collection markers are covered only through component DOM assertions. They were not checked visually.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found.

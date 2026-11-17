# Test Report

Date: 2026-11-17

Task: saved-pipelines - M3: Save and reopen aggregation pipelines (pipelines.json)

Scope: c51222cd89bc7fdcf665aa3528de920aac1daf40 (merge-base with origin/main, from the parent)
..7724ccbe3cd8608a9724fddec0b666db3535ceb1 on `main`. Task commits a2aa12c (contract), 1788862
(store/handlers), d216dfb (renderer panel), 73e3511 (docs), 6513a0e (first-round tests and
reports), 4dcf170 (fixer: CR-1, CR-2), then 7724ccb (merge of origin/main). Working tree clean: no
uncommitted inputs. This is the second test-writer round, on the revision after the fixer's changes
to `packages/renderer/src/app/aggregation/aggregation-view.{ts,html,spec.ts}`.

Requirements:
- `tasks/saved-pipelines.md` acceptance criteria and the recorded assumptions
- `SPEC.md` (M3 "save pipelines"), `docs/ARCHITECTURE.md` "Coverage"
- `reviews/saved-pipelines/review.md` findings CR-1, CR-2 and `reviews/saved-pipelines/fixes.md`
- `AGENTS.md`, parent instructions (validate only; edit tests only for a real defect, because a
  code review runs in parallel)

## Test files changed

- None in this round. (Round 1 added 5 tests to
  `packages/renderer/src/app/aggregation/aggregation-view.spec.ts`, committed in 6513a0e; the fixer
  added 5 more in 4dcf170.)

## Tests added or updated

Count: 0 in this round (validation only, as instructed; no defect found that would justify an edit)

I reviewed the fixer's new tests and found them meaningful. Each one controls ordering with
deferred promises and makes real assertions:
- `pointing the tab elsewhere clears the message and the list error of the previous collection` (CR-1)
- `a save, rename or delete answered after the tab points elsewhere leaves the new panel alone` (CR-1;
  late save success, late rename success and late delete failure)
- `saving says "Saved" for a new pipeline and "Replaced" only for one already listed` (CR-1 wording)
- `Rename and Delete… move the focus to the control that replaces them, and back` (CR-2 focus)
- `Delete and Rename are disabled while their request runs, so a second click sends nothing` (CR-2;
  disabled button and Enter/form submit)

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: store unit tests, missing file / corrupt file / atomic write | `apps/desktop/src/pipelines/store.spec.ts` (`PipelinesStore: missing file`, `corrupt file`, `atomic writes`, handler mapping) | `npx vitest run apps/desktop/src/pipelines packages/contract` (repo root) | Pass |
| AC1: contract samples | `packages/contract/src/index.spec.ts`, `methods.spec.ts` `pipelines.*` samples | same | Pass |
| AC2: save with a disabled stage, reopen in a new builder tab, same stages and enabled flags | `saves a pipeline with a disabled stage and reopens it in a new builder tab` | `npx ng test --include src/app/aggregation` (in `packages/renderer`) | Pass |
| Assumption: per collection, names unique ignoring case, save replaces, rename CONFLICT | store and handler tests; component `saving under a taken name replaces...`, `renames a saved pipeline; a taken name shows the error`, `lists the pipelines of this collection only`, `saving says "Saved"... "Replaced" only for one already listed` | both commands above | Pass |
| Assumption: stage errors (disabled too) block saving | `refuses to save without a name or with a stage that has an error (disabled too)`, `saving in full-text mode with a syntax error is refused and sends nothing` | `npx ng test --include src/app/aggregation` | Pass |
| Assumption: newer file is read-only | store `a file from a newer version is read but never written`, handler UNSUPPORTED, component `a failed save shows the error and keeps the builder...` | both commands above | Pass |
| CR-1: stale answers after the target changes are ignored; panel state cleared | `a list answer for the previous collection is ignored once the tab points elsewhere`, `pointing the tab elsewhere clears the message and the list error...`, `a save, rename or delete answered after the tab points elsewhere...` | `npx ng test --include src/app/aggregation` | Pass |
| CR-2: focus follows Rename / Delete…; no double submit | `Rename and Delete… move the focus...`, `Delete and Rename are disabled while their request runs...` | same | Pass |
| Error paths (blank rename, failed delete, failed list, unreadable stored stage) | `a rename to a blank name is refused; a failed delete...`, `a failed list shows its error`, `a saved pipeline with an unreadable stage is not opened...` | same | Pass |

## Focused test execution

Command:

`npx vitest run apps/desktop/src/pipelines packages/contract` (repo root)

Result:

Pass (6 files, 856 tests; the count rose from 808 because the merged main added contract tests)

Command:

`npx ng test --include src/app/aggregation` (in `packages/renderer`)

Result:

Pass (2 files, 129 tests)

## Full test execution

Command:

`sh .taskcheck` (runs `npm run check`: eslint, Prettier, type check of every workspace including renderer specs, root Vitest, renderer `ng test`)

Result:

Pass: lint and format clean, type check clean, root Vitest 79 files / 4288 tests, renderer 100 files / 3273 tests

## .taskcheck

Result:

Pass (same run as above; every stage printed and passed)

## Bugs found

None. No production defect was found.

## Coverage

Status: verified (whole-file coverage for every executable task-changed file except the Electron bootstrap; see exclusions)

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured, because no changed-line tooling is configured. I mapped
uncovered locations to the task diff (`git diff -U0 c51222c HEAD`) by hand. The gap table below
lists the uncovered locations that fall on task lines.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `saved-pipelines`, merge-base c51222cd89bc7fdcf665aa3528de920aac1daf40 (from the parent), HEAD 7724ccbe3cd8608a9724fddec0b666db3535ceb1. Task commits are the `saved-pipelines:`-prefixed commits a2aa12c, 1788862, d216dfb, 73e3511, 6513a0e and 4dcf170, plus merge 7724ccb. `git diff --stat c51222c HEAD` shows only task files and reviews.
- Source/test snapshot identifier: HEAD 7724ccb, clean working tree. sha256 values, identical before and after all runs: `aggregation-view.ts` 305b00a5…dd13ada, `aggregation-view.spec.ts` 098f618f…5c20e, `aggregation-view.html` 41fdbc67…7b2. Unchanged since round 1: `store.ts` 06b3d6fc…84003, `pipelines/handlers.ts` 17036a64…2d8. Also `main/handlers.ts` 716ab34b…a086f and `contract/src/pipelines.ts` 35d943f4…076ab.
- Exact included files: `packages/contract/src/pipelines.ts`, `apps/desktop/src/pipelines/store.ts`, `apps/desktop/src/pipelines/handlers.ts`, `apps/desktop/src/main/handlers.ts`, `packages/renderer/src/app/aggregation/aggregation-view.ts`.
- Excluded files and reasons:
  - `apps/desktop/src/main/index.ts`: Electron main bootstrap (lazy `pipelinesStore()` wiring) that needs the Electron runtime.
  - `apps/desktop/src/pipelines/index.ts` and `packages/contract/src/index.ts`: re-exports and the method-table spread.
  - `.html`/`.css`: not instrumented; the templates are exercised through the component tests.
  - `SPEC.md`, `docs/ARCHITECTURE.md`: documentation.
  - No files were renamed or deleted.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with v8 coverage.
  - `apps/desktop`: `npx vitest run --coverage --coverage.include='src/pipelines/store.ts' --coverage.include='src/pipelines/handlers.ts' --coverage.include='src/main/handlers.ts' --coverage.reporter=json --coverage.reporter=json-summary --coverage.reporter=text` (whole desktop suite, 17 files / 523 tests).
  - `packages/contract`: `npx vitest run --coverage --coverage.include='src/pipelines.ts' --coverage.reporter=text --coverage.reporter=json-summary` (whole contract suite, 5 files / 822 tests).
  - `packages/renderer`: `npx ng test --include src/app/aggregation --coverage --coverage-include='src/app/aggregation/aggregation-view.ts' --coverage-reporters=json --coverage-reporters=json-summary --coverage-reporters=text` (2 files / 129 tests).
- Run start time and exit status (2026-11-17, local time): renderer 05:53:23, desktop 05:54:04, contract 05:54:12. All tests passed in every run and each run printed its coverage summary.
- Generated report paths and hashes (all Git-ignored):
  - `packages/renderer/coverage/renderer/coverage-final.json` sha256 258ee27f…e72cd; `coverage-summary.json` 59fe4e6d…250f0
  - `apps/desktop/coverage/coverage-final.json` 032f8e4b…7c4c8b; `coverage-summary.json` cbb06605…c4c8b
  - `packages/contract/coverage/coverage-summary.json` abb41edc…886a85d. This hash is identical to round 1, as expected: the input is unchanged and the provider regenerated the same summary.
- Evidence outputs are fresh and inputs stayed unchanged: each run regenerated its report, and the coverage tool cleans its directory. The renderer report changed from round 1 (statement total 438 -> 488). Source hashes were the same before and after the runs, and the working tree stayed clean.
- Final run after latest test additions and production fixes: yes. These numbers describe 7724ccb, which includes the fixer's commit 4dcf170 and the merge.

Values below use covered/total (percentage).

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/contract/src/pipelines.ts` | 6/6 (100%) | N/A (0/0) | N/A (0/0) | 6/6 (100%) |
| `apps/desktop/src/pipelines/store.ts` | 120/124 (96.77%) | 54/60 (90.00%) | 35/38 (92.11%) | 108/109 (99.08%) |
| `apps/desktop/src/pipelines/handlers.ts` | 18/19 (94.74%) | 5/6 (83.33%) | 9/9 (100%) | 14/15 (93.33%) |
| `apps/desktop/src/main/handlers.ts` | 18/18 (100%) | 20/20 (100%) | 6/6 (100%) | 15/15 (100%) |
| `packages/renderer/src/app/aggregation/aggregation-view.ts` | 473/488 (96.93%) | 202/224 (90.18%) | 97/97 (100%) | 414/416 (99.52%) |
| Aggregate (summed counters over the 5 files above; excludes `main/index.ts`, index re-exports, templates) | 635/655 (96.95%) | 281/310 (90.65%) | 147/150 (98.00%) | 557/561 (99.29%) |

`main/handlers.ts` branches are 20/20 here (18/18 in round 1) because the merged main added code
to that file outside the task's lines.

In `aggregation-view.ts`, these uncovered locations are not on task lines: statements L232, 251,
353, 388, 473, 496, 597, 672, 699 and branches L157, 320 (the second `binary-expr` arm, see below),
533, 544. They belong to earlier aggregation tasks.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `aggregation-view.ts:766` (tab without a profile id) | Defensive guard | Left uncovered: a builder tab always has a profile (as in round 1) |
| `aggregation-view.ts:830` `before ?? []` fallback arm (save while the list is still `null`) | CR-1: "Saved" wording when the list was not read yet | Left uncovered: cosmetic wording only. With `null` the result is "Saved", which matches the fix description. Not a defect. |
| `aggregation-view.ts:838` (save fails after the target changed) | CR-1 stale guard, failure arm | Left uncovered: same `sameTarget` guard as the tested success arm (L828), and the late delete failure (L933) is tested. Low risk. |
| `aggregation-view.ts:902` (rename fails after the target changed) | CR-1 stale guard, failure arm | Left uncovered: the late rename success (L896) is tested, and so is the same failure pattern for delete |
| `aggregation-view.ts:927` (delete succeeds after the target changed) | CR-1 stale guard, success arm | Left uncovered: the test covers a late delete failure (L933), and the success guards for save and rename are tested |
| `aggregation-view.ts:922` (`deleteSaved` while `savedBusy`) | CR-2 double submit | Left uncovered: defensive. The confirm button is disabled while the request runs (tested), so a click cannot reach it. The equivalent rename guard (L885) is covered through form submit. |
| `aggregation-view.ts:320` (focus falls back to the save-name input when the requested control is gone) | CR-2 focus fallback | Left uncovered: reached only when the list reload no longer shows the item, for example after a concurrent delete from another window. Low risk because the fallback only affects focus. |
| `aggregation-view.ts:851` (stored stage that is not parseable EJSON) | Odd `pipelines.json` | Left uncovered: same message path as the tested `{}` case (as in round 1) |
| `store.ts:71, 124-126, 140, 225, 290-291`; `pipelines/handlers.ts:18` | Defensive branches, production defaults, best-effort cleanup, plain rethrow | Unchanged since round 1; same justification as recorded there (non-material, or covered by tests at the store level) |

## Unable to test

- `apps/desktop/src/main/index.ts` `pipelinesStore()` wiring (`userData/pipelines.json` path) needs the
  Electron runtime, so it has no unit test. The test for `mainHandlers` serving `pipelines.*` passes
  when it is given a store. Follow-up: an Electron e2e run if a later task names one. This task's
  criteria do not require one.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. All validation passed
on 7724ccb: the focused suites, `.taskcheck` and fresh task-scoped coverage. This round changed no
test files. The remaining uncovered CR-1/CR-2 arms (L830, 838, 902, 922, 927, 320) mirror tested
paths and are documented above as low-risk gaps.

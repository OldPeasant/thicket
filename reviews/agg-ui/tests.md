# Test Report

Date: 2026-11-17

Task: agg-ui - M3: Aggregation pipeline builder (final round, after review/fix rounds 1 and 2)

Scope: `git diff ee32d24eb81473ce09be0131f954f888132ca0ac..142f443831d8e0c51b8b1e5feeafc97688539c80`
on branch `main`, excluding `tasks/` and `reviews/` (task commits c76cb7f, e3b2cf6, 92c8a0c, ae781ab,
b638489, 2811e73, dab2d57, 142f443; 82ffc9f/8605b19 only add/edit `tasks/saved-pipelines.md`). Base
and commit list come from the parent worker and match `git log ee32d24..HEAD`. Focus of this round:
the round-2 production changes in 142f443 (CR-6: a text-mode Run refused for a parse error clears
the earlier result and run error; CR-7: persistent `agg-preview-live` live region fed by
`previewStatus()` / `countText()`). Uncommitted inputs: only my edit of
`packages/renderer/src/app/aggregation/aggregation-view.spec.ts` (hash under Coverage); no
production file is modified in the working tree. `reviews/agg-ui/review.md` is also modified in the
working tree by the parallel reviewer; I did not touch it.

Requirements:
- `tasks/agg-ui.md` acceptance criteria and recorded assumptions (tab kind `aggregation`; a syntax
  error blocks only its own preview; Run/Export/Create view refuse until fixed or disabled; `//- `
  disabled lines in full text; `$out`/`$merge` always ask first and run unpaged)
- `reviews/agg-ui/fixes.md` (round 1 CR-1..CR-5 and observations; round 2 CR-6, CR-7) as the
  intended behavior of the fixes
- `SPEC.md` (M3 aggregation, M1 Safety), `docs/ARCHITECTURE.md` ("Coverage"), `AGENTS.md`

## Test files changed

This round (uncommitted):
- `packages/renderer/src/app/aggregation/aggregation-view.spec.ts`

Earlier rounds (committed): the same file, `packages/renderer/src/app/aggregation/pipeline.model.spec.ts`,
`packages/renderer/src/app/sidebar/sidebar-tree.service.spec.ts`,
`packages/renderer/src/app/collection/collection-view.spec.ts`, `test/e2e/aggregation.e2e.ts`.

## Tests added or updated

Count this round: 2 added in `aggregation-view.spec.ts`. No existing test was changed, weakened or
skipped.

- "the live region counts every previewed stage and is empty for stages without a preview" (CR-7):
  plural count text in the live region ("3 documents from a sample", "2 documents …"); for a
  disabled stage, a stage with a syntax error, a `$out` and a `$merge` stage the live region is
  empty (`previewStatus` returns `''`), the region element stays the same DOM node across disable /
  re-enable / error, the count comes back after re-enabling, and every stage has exactly one
  `aria-live` element.
- "a Run refused for a full-text parse error sends nothing and keeps the text and stages" (CR-6):
  no `agg.run` request is sent, Run is not replaced by Cancel, results and pager are gone, the view
  stays in text mode with the text as typed, the stage list is not replaced; fixing the text and
  Run sends the edited pipeline, clears the text error and shows the result.

Summary of earlier rounds (kept from the previous reports, now all on the final code):
- Round 1 test-writer: 46 added (40 in `aggregation-view.spec.ts`, 4 in
  `sidebar-tree.service.spec.ts`, 2 in `collection-view.spec.ts`): previews in flight (abort on
  edit/remove/disable/invalid/close, out-of-order and aborted answers, whitespace edit not re-asked),
  debounce with fake timers, failed preview, retargeted tab, no profile, several invalid stages,
  operator templates, empty stage list, full-text errors, Run stream failure/cancel/close/empty/one
  page/later empty page/unreadable doc, `$merge` asks first, read-only profile (Create view disabled,
  `$out` refused, WriteGuard refusal), Create view validation and errors, Export fallbacks and Copy;
  drop/rename close aggregation tabs; Aggregate… opens the tab once.
- Round 1 fixer (CR-1..CR-5): 9 added (text-mode Export/Create view, Retry button and retry on next
  edit, paging the shown pipeline, failed run clears result, Run refused for a stage error, live
  region / no re-announced stage errors).
- Round 2 (dab2d57): 7 added (Next pages the collection that produced the result after retarget, a
  failing page turn clears the result, `$out` refused on read-only clears the result, cancelled `$out`
  confirmation keeps the result, Retry names its stage and can be retried, Retry asks only for its
  stage, Copy in full-text mode).
- Round 2 fixer (CR-6, CR-7): 1 added ("a Run refused for a full-text parse error clears the earlier
  result and run error"), the live-region test rewritten to "announces the preview status in a live
  region that persists across preview reloads" and the stage-error part split into "does not
  re-announce stage errors while typing".

Aggregation specs now: 2 files, 80 tests.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 e2e: demo step 8 ($match → $group → $sort, preview per stage, export as shell and Node) | `test/e2e/aggregation.e2e.ts` "demo step 8: $match → $group → $sort with a preview per stage, export as shell and Node" | `npm run test:e2e -- aggregation` (repo root; builds renderer and desktop, Playwright Electron) | Pass (1 passed, 8.0 s) on HEAD 142f443 plus the uncommitted spec |
| AC2 reorder/disable updates the pipeline | "reordering stages changes the pipeline that runs and the previews", "a disabled stage is left out of the pipeline and of later previews", "disabling a stage cancels its running preview", "disabling the stage with an error lets Run, Export and Create view use the pipeline" | `cd packages/renderer && npx ng test --include='src/app/aggregation/**/*.spec.ts'` | Pass |
| AC2 syntax error blocks preview of that stage only | "a syntax error blocks the preview of that stage only", "names every stage left out of a preview", "a stage turning invalid cancels its running preview" | same | Pass |
| CR-6 text-mode Run refused for a parse error clears result/run error, sends nothing | "a Run refused for a full-text parse error clears the earlier result and run error", "a Run refused for a full-text parse error sends nothing and keeps the text and stages" | same | Pass |
| CR-7 persistent live region with count/loading/error, empty without a preview | "announces the preview status in a live region that persists across preview reloads", "the live region counts every previewed stage and is empty for stages without a preview", "does not re-announce stage errors while typing" | same | Pass |
| Round 1 fixes (CR-1..CR-5) and earlier edge cases | see "Tests added or updated" | same, plus `npm run check` | Pass |
| Drop/rename close aggregation tabs; Aggregate… opens the tab | sidebar-tree and collection-view specs | `npm run check` (renderer suite) | Pass |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/app/aggregation/**/*.spec.ts'`

Result:

Pass (2 files, 80 tests).

## Full test execution

Command:

`npm run check` (repository root: eslint `--max-warnings 0`, `prettier --check`, typecheck of every
workspace incl. renderer specs, root Vitest, renderer `ng test`)

Result:

Pass. Root Vitest: 60 files, 3388 tests. Renderer: 74 files, 2245 tests. No lint, format or type
errors. Also `npx prettier --check` and `npx eslint` on the changed spec: clean.

E2E: `npm run test:e2e -- aggregation` -> 1 passed (see Requirement coverage). The full e2e suite was
not run (outside this task's criteria).

## .taskcheck

Result:

Pass. `.taskcheck` runs `npm run check` (package.json exists), which passed on the final spec file
(run started 03:24:58 local).

## Bugs found

No production defects found: every test passes against the final implementation (142f443).

## Coverage

Status: verified (fresh run, all tests passed, on production revision 142f443 plus the final spec
file).

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: 340/342 executable added lines (99.42%), measured by intersecting the `DA:`
records of this run's `lcov.info` with the added lines of `git diff -U0 ee32d24..142f443` per file.
The two uncovered changed lines are `aggregation-view.ts:117` and `pipeline.model.ts:52` (see gaps).
Note that v8's lcov `DA:` records are per source-mapped line and do not have the same denominator as
the summary's line totals. Changed-branch coverage not measured.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: agg-ui; base
  ee32d24eb81473ce09be0131f954f888132ca0ac; HEAD 142f443831d8e0c51b8b1e5feeafc97688539c80; commit
  range from the parent worker, checked against `git log ee32d24..HEAD` and
  `git diff --stat ee32d24..HEAD -- . ':!tasks' ':!reviews'`.
- Source/test snapshot identifier (including uncommitted inputs): HEAD 142f443 with clean production
  files plus `aggregation-view.spec.ts` sha256
  0e78c318969748cb99b604570239cca200d9eeadc3da52bd9f72e910d5b70871 and (committed)
  `pipeline.model.spec.ts` sha256 ab3ba39603ed2bee576456d47e22f38b4658a9d729918630c3afa0e3053a2439;
  identical before (03:25:43) and after the run.
- Exact included files: `packages/renderer/src/app/aggregation/aggregation-view.ts`,
  `aggregation/pipeline.model.ts`, `aggregation/index.ts`, `app.config.ts`,
  `collection/collection-view.ts`, `layout/workspace.service.ts`, `sidebar/sidebar-tree.service.ts`.
  Excluded: `aggregation-view.html`/`.css` (compiled into the component; v8 has no separate counters
  for templates, exercised through the DOM tests), `packages/core/package.json` (export map, no
  executable code), specs and `test/e2e/aggregation.e2e.ts` (tests), `docs/ARCHITECTURE.md`
  (docs). No renames or deletions.
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8` with
  Vitest 5.1.0 through `@angular/build:unit-test`; in `packages/renderer`:
  `npx ng test --coverage --coverage-include='src/app/aggregation/aggregation-view.ts' --coverage-include='src/app/aggregation/pipeline.model.ts' --coverage-include='src/app/aggregation/index.ts' --coverage-include='src/app/app.config.ts' --coverage-include='src/app/collection/collection-view.ts' --coverage-include='src/app/layout/workspace.service.ts' --coverage-include='src/app/sidebar/sidebar-tree.service.ts'`;
  whole renderer suite (74 files, 2245 tests, all passed).
- Run start/completion time and exit status: started 2026-11-17 03:25:59 +0100, reports written
  03:26:27 +0100; all tests passed and the coverage summary was printed.
- Generated report paths and report hashes/run identifier:
  `packages/renderer/coverage/renderer/coverage-summary.json` (sha256
  19e0ce09ba0f75aa3930640057b1fc169a49002b6443559c600d16153e5594c9),
  `packages/renderer/coverage/renderer/lcov.info` (sha256
  eb80bc7dc07e5c6ba2db03b071db4a21677c4ac775e3fb1f12ca007d70db2df8); Git-ignored.
- Evidence outputs are fresh and inputs stayed unchanged: report mtimes are from this run (the
  `coverage/` directory was recreated at 03:25:59); spec hashes match before and after.
- Final run after latest test additions and production fixes: yes (after both round-2 fixes and my
  two added tests). Any later production change makes these numbers stale.

Values below use covered/total (percentage); zero-denominator metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/aggregation/aggregation-view.ts` | 298/307 (97.07%) | 136/151 (90.07%) | 73/73 (100%) | 254/255 (99.61%) |
| `packages/renderer/src/app/aggregation/pipeline.model.ts` | 75/76 (98.68%) | 41/55 (74.55%) | 13/13 (100%) | 70/71 (98.59%) |
| `packages/renderer/src/app/aggregation/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/renderer/src/app/app.config.ts` | 1/1 (100%) | N/A | N/A | 1/1 (100%) |
| `packages/renderer/src/app/collection/collection-view.ts` | 204/211 (96.68%) | 109/128 (85.16%) | 60/61 (98.36%) | 172/172 (100%) |
| `packages/renderer/src/app/layout/workspace.service.ts` | 55/55 (100%) | 37/38 (97.37%) | 16/16 (100%) | 38/38 (100%) |
| `packages/renderer/src/app/sidebar/sidebar-tree.service.ts` | 227/227 (100%) | 95/95 (100%) | 65/65 (100%) | 181/181 (100%) |
| Aggregate (summed counters, the 7 files above) | 860/877 (98.06%) | 418/467 (89.51%) | 227/228 (99.56%) | 716/718 (99.72%) |
| `packages/renderer/src/app/aggregation` only (3 files) | 373/383 (97.39%) | 177/206 (85.92%) | 86/86 (100%) | 324/326 (99.39%) |

The aggregate leaves out the templates/CSS and `packages/core/package.json` (see exclusions).
`collection-view.ts`, `workspace.service.ts` and `sidebar-tree.service.ts` are mostly pre-existing
code (the task's 4 executable changed lines there are covered). All round-2 code (`countText`,
`previewStatus` all four outcomes, the CR-6 branch in `run()`) is covered.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `aggregation-view.ts:117` (`data?.profileId ?? ''`, line reported 0 hits) | Tab without data | Exercised by "previews nothing without a profile" (sets `data: undefined`); the zero `DA` is a v8 source-map attribution of the object literal in the computed. No test added |
| `aggregation-view.ts` branches 223 (text-mode stage parse error in Export), 242 (catch around `generateCode`) | Export error text | 223: `parsePipeline` already validates every stage, so `parseStage` does not fail here; 242: codegen accepts every parsed pipeline. Defensive; left uncovered |
| `aggregation-view.ts` branches 290, 293 (`moveStage` out of range / empty splice) | Moving first up / last down | Buttons disabled at the ends (tested); defensive |
| `aggregation-view.ts` branches 152, 325, 393, 416, 421, 449, 460, 482, 557, 584 (`firstError` with no error - it is only read when a stage has one, `?? ''`/`?? []` fallbacks, same-mode switch, `retryPreview` without plan/profile, aborted after success, stale-run check, `turnPage` without result, `!code.ok` in copy) | Fallbacks | Not reachable from the UI (e.g. Retry only exists while a plan's preview failed, pager only with a result, Copy disabled while code is not ok - tested); `ApiService.request` rejects on abort so the success-after-abort path is unused. Left uncovered |
| `pipeline.model.ts:52` (`templateBody` `?? '{}'`) and branches 75, 78, 83, 96-97, 142-158 | Unknown-operator template; parse error fallbacks | The picker only offers template operators plus the current one; the parser only throws `ShellSyntaxError`; the `?? ''` are `noUncheckedIndexedAccess` guards. Left uncovered |
| `collection-view.ts` branches 156-430, `workspace.service.ts:85` | Pre-existing code | Outside this task |

## Unable to test

- Visual direction / Business and Tron tokens (no hard-coded colors) in `aggregation-view.css`,
  including the new `.sr-only` rule, and whether a real screen reader announces the live region:
  not covered by unit or e2e tests (jsdom has no accessibility tree); review items. The tests do
  check the region is persistent, polite, holds no documents and has the expected text.

## Summary

Tests added and all validation passed. Tests and task-scoped coverage are sufficient; no production
defects found. The round-2 changes (CR-6, CR-7) are fully covered, including the empty live-region
text for disabled, invalid, `$out` and `$merge` stages and the no-request guarantee of a refused
text-mode Run. The demo step 8 e2e test passes.

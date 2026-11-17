# Test Report

Date: 2026-11-17

Task: agg-ui - M3: Aggregation pipeline builder

Scope: `git diff e08080a659e944cf9af39b5c463e389a224d9481..1d21e962c97222111dbd8fc9c5b57351b81c86ba` on branch `main`
(task commits c2d00c8, d5eb68f, 1a06ba6, 1d21e96; 871b7d7/695dcaa only touch `tasks/`). Base and
commit list come from the parent worker and match `git log e08080a..HEAD`. The uncommitted
inputs are the three spec files changed by this report (hashes under Coverage); no production file
is modified in the working tree.

Requirements:
- `tasks/agg-ui.md` acceptance criteria and recorded assumptions (tab kind `aggregation`, drop/rename
  close it; a syntax error blocks only its own preview; Run/Export/Create view refuse until fixed or
  disabled; `//- ` disabled lines in full text; `$out`/`$merge` always ask first and run unpaged)
- `SPEC.md` (M3 aggregation, M1 Safety: read-only and production writes), `docs/ARCHITECTURE.md`
  ("Coverage"), `AGENTS.md`
- Parent worker's list of edge cases to cover

## Test files changed

- `packages/renderer/src/app/aggregation/aggregation-view.spec.ts`
- `packages/renderer/src/app/sidebar/sidebar-tree.service.spec.ts`
- `packages/renderer/src/app/collection/collection-view.spec.ts`

## Tests added or updated

Count: 46 added (40 in aggregation-view.spec.ts, 4 in sidebar-tree.service.spec.ts, 2 in
collection-view.spec.ts). No existing test was changed, weakened or skipped.

Added in `aggregation-view.spec.ts`:
- Preview requests in flight (controlled with unanswered fake promises, no real delays):
  stage edited again aborts the old preview (bridge `cancel`), the aborted answer is ignored when it
  arrives before and after the newer one, an aborted failure shows no error; removing, disabling,
  or making a stage invalid cancels its running preview at once; closing the tab cancels running
  previews; a stage whose parsed pipeline did not change (whitespace edit) is not asked again.
- Preview debounce (Vitest fake timers, `PREVIEW_DEBOUNCE_MS`): three edits each less than the
  debounce apart produce no request until 400 ms after the last one, then exactly one request with
  the last text. Checked that the test fails when the debounce is 0.
- A failed preview stops loading and is asked again when the stage is disabled and re-enabled; a
  retargeted tab previews against the new collection; no profile: nothing previewed, the title is
  used as the collection name.
- Several invalid stages: "Without stages 1, 2: they have errors."; disabling the invalid stage lets
  Run/Export use the pipeline while the disabled stage still shows its error.
- Operator change replaces an untouched template argument and keeps an edited one; an operator
  outside the templates (`$densify`) shows in the picker.
- Empty stage list (Run sends only `$limit`, export works, text is `[]`); full text: not an array,
  a stage with two operators, error cleared on typing; Run in text mode runs the edited text.
- Run: stream failure shows the error and Run works again; Cancel cancels the stream and ignores its
  late data; closing the tab cancels a running aggregation; empty result; exactly one page (no next
  page, `batchSize` 21); later page that came back empty ("No more documents"); unreadable
  document shown as `// unreadable document` next to readable ones.
- `$merge` asks first; cancelling sends nothing and shows no error.
- Read-only profile: Create view and its submit disabled with the read-only hint; a read-only
  pipeline still previews and runs; `$out` Run is refused with READ_ONLY without a dialog or request;
  a forced createView call is refused by the WriteGuard and sends nothing.
- Create view: refuses `$out`/`$merge`, refuses a pipeline with an error, blank name refused and
  name trimmed, server error shown, production profile asks first and cancelling sends nothing.
- Export: `profiles.get` failure falls back to the localhost URI, the profile is read only once,
  Copy writes the code and is disabled while a stage has an error, a refused clipboard does not show
  "Copied".

Added in `sidebar-tree.service.spec.ts` ("aggregation tabs"): dropping a collection closes its
aggregation tab only; dropping a database closes the aggregation tabs of all its collections (other
db/profile kept); renaming closes the old aggregation tab; a cancelled or failed drop keeps it.

Added in `collection-view.spec.ts`: Aggregate… opens `aggregation:p1:shop.orders` (kind, title,
detail, production flag, copied data) and selects it instead of opening a second tab; the button is
enabled on a read-only profile.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 e2e: demo step 8 ($match, $group, $sort, preview per stage, export shell and Node) | `test/e2e/aggregation.e2e.ts` | `npm run test:e2e -- aggregation` | Not run by the test-writer: the parent worker reports it passing (Podman, headless). Component-level cover: "previews each stage with the stages up to it", "exports the pipeline as shell and Node code" |
| AC2 reorder/disable updates the pipeline | "reordering stages changes the pipeline…", "a disabled stage is left out…", "disabling a stage cancels its running preview", "disabling the stage with an error lets Run, Export and Create view use the pipeline" | `cd packages/renderer && npx ng test --include='src/app/aggregation/**/*.spec.ts'` | Pass |
| AC2 syntax error blocks preview of that stage only | "a syntax error blocks the preview of that stage only", "names every stage left out of a preview", "a stage turning invalid cancels its running preview" | same | Pass |
| Preview debounce / abort when a stage changes again | "asks for previews only once the typing has paused…", "a stage edited again while its preview runs aborts…", "an aborted preview that answers after the newer one…", "an aborted preview that fails…" | same | Pass |
| Removed stage's preview cancelled | "removing a stage cancels its running preview at once and drops it", "closing the tab cancels running previews" | same | Pass |
| Read-only profile disables Create view | "read-only profile > disables Create view and its submit button", "…refuses to create a view even when the form is submitted" | same | Pass |
| `$out` on read-only | "read-only profile > refuses a $out run without asking and without sending it" | same | Pass |
| `$out`/`$merge` ask first, unpaged | "a $out pipeline asks first…", "a $merge pipeline asks first too…" | same | Pass |
| Drop/rename close aggregation tabs | "aggregation tabs > dropping a collection…", "…dropping a database…", "…renaming…", "…a cancelled or failed drop keeps…" | `npx ng test --include='src/app/sidebar/sidebar-tree.service.spec.ts'` (also in the full run) | Pass |
| Aggregate… opens the right tab | "Aggregate… opens the aggregation tab of this collection, once", "Aggregate… is offered on a read-only profile" | `npx ng test --include='src/app/collection/collection-view.spec.ts'` (also in the full run) | Pass |
| Run paging, cancel, errors; export; create view | see "Tests added" | aggregation command above | Pass |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/app/aggregation/**/*.spec.ts' --include='src/app/sidebar/sidebar-tree.service.spec.ts' --include='src/app/collection/collection-view.spec.ts'`

Result:

Pass (4 files, 199 tests; the aggregation specs alone after the last additions: 2 files, 60 tests).

## Full test execution

Command:

`cd packages/renderer && npx ng test --coverage --coverage-include=…` (whole renderer suite, see Coverage) and `npm run check` at the repository root

Result:

Pass. Renderer: 73 files, 2085 tests. Root Vitest: 55 files, 3264 tests.

## .taskcheck

Result:

Pass. `.taskcheck` runs `npm run check` = `eslint . --max-warnings 0 && prettier --check .`, then
typecheck of every workspace (incl. `tsc -p tsconfig.spec.json` for the renderer specs), then the
root and renderer unit tests. Ran on the final spec files (started 03:05:55 local).

## Bugs found

No production defects found: every added test passes against the current implementation.

Observations (no failing test, not requirements in the task; for the parent to decide):
- A failed preview is cached under its pipeline key (`previewRuns`), so it is not asked again until
  that stage's parsed pipeline changes (a whitespace edit does not retry, there is no retry control).
  After a reconnect the user has to edit the stage or disable and re-enable it. Low.
- Prev/Next re-run the current pipeline at the old page index: after editing a stage, Next shows page
  2 of the new pipeline without page 1. Low.
- `AggregationView.readOnly` (aggregation-view.ts:123) is never read (the template uses
  `appWriteControl`). Low, maintainability only.

## Coverage

Status: verified (fresh run, exit 0, on the final spec files and production revision 1d21e96).

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: 289/291 executable added lines (99.31%), measured by intersecting the
`DA:` records of the run's `lcov.info` with the added lines of
`git diff -U0 e08080a..1d21e96` per file. Changed-branch coverage not measured.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: agg-ui; base
  e08080a659e944cf9af39b5c463e389a224d9481; HEAD 1d21e962c97222111dbd8fc9c5b57351b81c86ba; commit
  range and file list from the parent worker, checked against `git diff --stat e08080a..HEAD`.
- Source/test snapshot identifier (including uncommitted inputs): HEAD 1d21e96 with clean production
  files plus `aggregation-view.spec.ts` sha256 898b3458ae487640ce773f5ac07e0e75a28a8100204991b49be7fa3891a47338,
  `sidebar-tree.service.spec.ts` sha256 794a1495978611a0af1d60039e430bcb50d5d66e2bf8fb2ceb746a64b08ab076,
  `collection-view.spec.ts` sha256 980000c87dd87d645ebebec4337cda195729fe54dfc62b78c418d89b4683a647
  (unchanged from before the run to after).
- Exact included files: `packages/renderer/src/app/aggregation/aggregation-view.ts`,
  `aggregation/pipeline.model.ts`, `aggregation/index.ts`, `app.config.ts`,
  `collection/collection-view.ts`, `layout/workspace.service.ts`, `sidebar/sidebar-tree.service.ts`.
  Excluded: `aggregation-view.html`/`.css` (compiled into the component; v8 reports no separate
  counters for templates, their behavior is exercised through the DOM tests), `packages/core/package.json`
  (export map only, no executable code), `test/e2e/aggregation.e2e.ts` and the specs (tests),
  `docs/ARCHITECTURE.md` and `tasks/saved-pipelines.md` (docs/task files). No renames or deletions.
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8` 5.1.0
  (Vitest 5.1.0 through `@angular/build:unit-test`); in `packages/renderer`:
  `npx ng test --coverage --coverage-include='src/app/aggregation/aggregation-view.ts' --coverage-include='src/app/aggregation/pipeline.model.ts' --coverage-include='src/app/aggregation/index.ts' --coverage-include='src/app/app.config.ts' --coverage-include='src/app/collection/collection-view.ts' --coverage-include='src/app/layout/workspace.service.ts' --coverage-include='src/app/sidebar/sidebar-tree.service.ts'`;
  the whole renderer suite (73 files, 2085 tests).
- Run start/completion time and exit status: started 2026-11-17 03:06:43 +0100, reports written
  03:06:58 +0100, all tests passed.
- Generated report paths and report hashes/run identifier:
  `packages/renderer/coverage/renderer/coverage-summary.json` (sha256 7cf96351cc9e8f5d4fe2d98ec4b72ad963ece3fbf5a6e00ec07ee1adc6ce7483),
  `packages/renderer/coverage/renderer/lcov.info` (sha256 484d4283503aadeb0f42a0078cefb5496580ffc6b94ae9f333a5d2af654f6313); Git-ignored.
- Evidence outputs are fresh and inputs stayed unchanged: the report timestamps are those of this run
  (the earlier baseline and intermediate runs wrote different hashes); spec hashes were taken after the run and
  no file was edited after it started.
- Final run after latest test additions and production fixes: yes for the test additions; no
  production fixes were made. A fixer change to production code makes these numbers stale.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/aggregation/aggregation-view.ts` | 253/260 (97.30%) | 109/120 (90.83%) | 64/65 (98.46%) | 215/216 (99.53%) |
| `packages/renderer/src/app/aggregation/pipeline.model.ts` | 75/76 (98.68%) | 41/55 (74.54%) | 13/13 (100%) | 70/71 (98.59%) |
| `packages/renderer/src/app/aggregation/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/renderer/src/app/app.config.ts` | 1/1 (100%) | N/A | N/A | 1/1 (100%) |
| `packages/renderer/src/app/collection/collection-view.ts` | 201/208 (96.63%) | 107/126 (84.92%) | 59/60 (98.33%) | 168/168 (100%) |
| `packages/renderer/src/app/layout/workspace.service.ts` | 55/55 (100%) | 37/38 (97.36%) | 16/16 (100%) | 38/38 (100%) |
| `packages/renderer/src/app/sidebar/sidebar-tree.service.ts` | 227/227 (100%) | 95/95 (100%) | 65/65 (100%) | 181/181 (100%) |
| Aggregate (summed counters, the 7 files above) | 812/827 (98.18%) | 389/434 (89.63%) | 217/219 (99.08%) | 673/675 (99.70%) |

The aggregate leaves out the templates/CSS and `packages/core/package.json` (see exclusions).
collection-view.ts, workspace.service.ts and sidebar-tree.service.ts are mostly pre-existing code;
the task changed 17, 1 and 1 lines in them. Baseline before the new tests (aggregation specs only):
aggregation-view.ts 88.41% statements / 71.66% branches.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `aggregation-view.ts:214` (catch around `generateCode`) | Export shows the codegen error | Not reachable from the UI: the pipeline is already parsed BSON and codegen accepts every operator; left uncovered |
| `aggregation-view.ts:262,265` (`moveStage` out of range, empty splice) | Moving the first stage up / last down | Defensive: the buttons are disabled at the ends (tested); left uncovered |
| `aggregation-view.ts:370` (aborted after a successful answer) | Stale preview | Not reachable: `ApiService.request` rejects at abort, so the catch path is used (tested by the abort tests) |
| `aggregation-view.ts:150,297,383,394,462,489` (`?? ''`, same-mode switch, `?? []`, `result === null`, `!code.ok` in copy) | Fallbacks | Defensive branches, the UI does not reach them (e.g. Copy is disabled while code is not ok, tested); left uncovered |
| `pipeline.model.ts:78` and branches at 75, 83, 96-97, 142-158 (non-`ShellSyntaxError`, `?? ''` fallbacks in `uncommentDisabled`) | Parse error reporting | The parser only throws `ShellSyntaxError`; the `?? ''` are `noUncheckedIndexedAccess` guards; left uncovered |
| `collection-view.ts` branches 153-420 | Pre-existing collection view code | Outside this task (the task's 4 executable lines there are covered) |
| `workspace.service.ts:85` | Pre-existing `cycle` branch | Outside this task |

## Unable to test

- AC1 (e2e demo step 8) was not run by the test-writer; the parent worker reports
  `npm run test:e2e -- aggregation` passing with Podman headless. It needs its own recorded evidence.
- Visual direction / Business and Tron tokens (no hard-coded colors) in `aggregation-view.css`: not
  covered by unit tests; it is a review item.

## Summary

Tests added and all validation passed. Tests and task-scoped coverage are sufficient; no production
defects found (three low-severity observations above for the parent to decide).

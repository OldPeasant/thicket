# Test Report

Date: 2026-11-17

Task: validator - M3 (Should): Collection validator

Scope: task commits after base `3c0e3cbe86b245e9e551fc2aed38cb292f270599` up to HEAD `0c4d1efd1e8d832f221579212fe13b28c5197d7b` on `main` (c1274e5 backend + integration test, b39cd00 validator tab and markers, 0c4d1ef e2e test and architecture notes; all by dell26/agent-1), plus the new uncommitted test files listed below. No uncommitted production changes.

Requirements:
- `tasks/validator.md` acceptance criteria and recorded assumptions (check method `coll.validator.check` with `{_id:{$in}, $nor:[validator]}`; marks in the list view, summary plus link in the table view; marks reflect stored documents)
- `SPEC.md` M3 "Collection validator", `docs/ARCHITECTURE.md` (Coverage, Conventions), `AGENTS.md`
- Parent instructions (unit specs for backend validator.ts and handlers, renderer validator.model.ts, validator-marks.service.ts, validator-view.ts, collection-view marker rendering)

## Test files changed

- `packages/backend/src/browse/validator/validator.spec.ts` (new)
- `packages/backend/src/browse/validator/handlers.spec.ts` (new)
- `packages/renderer/src/app/validator/validator.model.spec.ts` (new)
- `packages/renderer/src/app/validator/validator-marks.service.spec.ts` (new)
- `packages/renderer/src/app/validator/validator-view.spec.ts` (new)
- `packages/renderer/src/app/collection/collection-view.spec.ts` (new `validator marks` describe block; no existing test changed)

## Tests added or updated

Count: 124 test cases (backend 54 including `it.each` rows; renderer validator specs 58; collection-view 12).

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 Integration test: set validator, invalid doc flagged by the check method | existing `test/integration/validator.int.spec.ts` (not changed or re-run by this helper); unit level: `checkValidator` "finds the failing _ids with the collection's validator as {_id: {$in}, $nor: [validator]}", "keeps the BSON types of the failing _ids", "collects every batch", "checks a draft validator without reading the stored one"; handlers "passes db, collection and parameters of each request to the server" | `cd packages/backend && npx vitest run src/browse/validator` | Pass (54/54); integration suite Not run by test-writer: the parent reported it passing |
| AC2 e2e: edit validator; failing document shows a marker | existing `test/e2e/validator.e2e.ts` (not re-run by this helper); unit level: CollectionView `validator marks` (marks failing docs in list view, summary text 1/n, table view link "Show them marked", next page, re-check on ValidatorChanges, failure clears marks, stale page answer, closing the tab cancels, Validator… opens the tab) and ValidatorView save/dirty/parse-error/WriteGuard tests | `cd packages/renderer && npx ng test --include='src/app/validator/**/*.spec.ts' --include='src/app/collection/collection-view.spec.ts'` | Pass (128/128 then 58/58 after the last addition); e2e Not run by test-writer: the parent reported it passing |
| validator/ids parse errors -> INVALID_PARAMS; ids limit (1000 ok, 1001 refused); nothing sent on bad input | `parseValidator`/`parseIds` `it.each` rows, `checkValidator` "refuses %s with INVALID_PARAMS before sending anything", "refuses more than MAX_VALIDATOR_CHECK_IDS" | backend vitest above | Pass |
| get defaults (no options, empty validator, unknown level/action -> strict/error), NOT_FOUND, server errors | `getValidator` tests | backend vitest above | Pass |
| set: one collMod; null -> `validator: {}`; server refusal -> SERVER_ERROR | `setValidator` tests, handler "coll.validator.set with a null validator removes it" | backend vitest above | Pass |
| check: no validator / empty draft -> hasValidator false without find; empty ids -> no find; cancel kills the cursor | `checkValidator` tests | backend vitest above | Pass |
| Handlers: exact method set, NOT_CONNECTED, reads cancellable, set not cancellable once sent | `validatorHandlers` tests | backend vitest above | Pass |
| Renderer model: shell syntax to and from canonical EJSON, empty/{} = remove, code refused, error position | `validator.model.spec.ts` | renderer ng test above | Pass |
| Marks: stale answers dropped (success and failure), keys normalized (`$numberDouble "1.0"`), no ids/no profile = no request, max ids, error clears marks, CANCELLED ignored, stop() | `validator-marks.service.spec.ts` | renderer ng test above | Pass |
| View: load, loading, no validator + template, load error + Refresh, stale reads (success and failure), dirty/revert, parse error on Save, save via WriteGuard + ValidatorChanges bump, remove, refused save, double Save, Ctrl+Enter, production confirm/cancel, read-only | `validator-view.spec.ts` | renderer ng test above | Pass |

## Focused test execution

Command:

`cd packages/backend && npx vitest run src/browse/validator`
`cd packages/renderer && npx ng test --include='src/app/validator/**/*.spec.ts' --include='src/app/collection/collection-view.spec.ts'`

Result:

Pass (backend 54/54; renderer 128/128; after the last added test, validator specs 58/58).

## Full test execution

Command:

`npm run check` (repository root: eslint + prettier --check, tsc for every workspace, `vitest run` and `ng test`)

Result:

Pass: root vitest 75 files / 4100 tests, renderer 87 files / 2730 tests, lint and typecheck clean.

## .taskcheck

Result:

Pass. `.taskcheck` runs `npm run check`, and that command passed on the final test snapshot (see above). `.taskcheck` was not invoked separately.

## Bugs found

No production defects found. No test fails.

Observations, not requirement violations, so they have no failing tests (the parent decides whether they matter):

- `ValidatorChanges.version(target)` reads the whole versions map signal. So saving the validator of any collection re-checks every open collection tab, not only tabs of that collection. Results stay correct; the cost is extra `coll.validator.check` requests (`packages/renderer/src/app/validator/validator-marks.service.ts:28-30`). The test "keeps this tab's marks when the validator of another collection changes" checks only correctness.
- `ValidatorMarks.error` is set when a check fails, but nothing in `collection-view.html` displays it. A failed check (for example, missing `listCollections` privilege) silently shows no marks. The task does not define the expected behaviour.

## Coverage

Status: verified (backend, contract and renderer runs exited 0 on the final snapshot).

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured. However, every uncovered statement or branch in `collection-view.ts`, `workspace.service.ts` and `backend.ts` lies outside the lines this task added (checked against `git diff 3c0e3cb..HEAD`).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `validator`; base `3c0e3cbe86b245e9e551fc2aed38cb292f270599`; HEAD `0c4d1efd1e8d832f221579212fe13b28c5197d7b`; commits c1274e5, b39cd00, 0c4d1ef (parent-supplied, confirmed with `git log 3c0e3cb..HEAD` and `git diff --stat 3c0e3cb..HEAD`).
- Source/test snapshot identifier (including uncommitted inputs): production files unchanged from HEAD (sha256 prefixes stable before and after the runs: validator.ts de772128, handlers.ts 797aaba2, validator-marks.service.ts a4e2a7ea, validator-view.ts 8455301a, validator.model.ts 6ec6c0db, collection-view.ts 9713c97d). Uncommitted tests: validator.spec.ts 3183d2bf, handlers.spec.ts 6c955dac, validator-marks.service.spec.ts bcbf4c19, validator-view.spec.ts d66a7017, validator.model.spec.ts 9acb718d, collection-view.spec.ts af6b49c1.
- Exact included files: backend `src/browse/validator/validator.ts`, `src/browse/validator/handlers.ts`, `src/browse/validator/index.ts`, `src/server/backend.ts`; contract `src/coll.ts`; renderer `src/app/validator/validator-view.ts`, `validator-marks.service.ts`, `validator.model.ts`, `index.ts`, `src/app/collection/collection-view.ts`, `src/app/layout/workspace.service.ts`, `src/app/sidebar/sidebar-tree.service.ts`, `src/app/app.config.ts`. Excluded: `collection-view.html/.css`, `validator-view.html/.css` (templates and styles: v8 cannot instrument them; the template is exercised by the component specs), `docs/ARCHITECTURE.md`, test files, `test/integration` and `test/e2e`. No renamed or deleted files.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with `@vitest/coverage-v8`.
  - `packages/backend`: `npx vitest run src/browse/validator src/server/backend.spec.ts --coverage --coverage.include='src/browse/validator/validator.ts' --coverage.include='src/browse/validator/handlers.ts' --coverage.include='src/browse/validator/index.ts' --coverage.include='src/server/backend.ts' --coverage.reporter=text --coverage.reporter=json-summary`
  - `packages/contract`: `npx vitest run --coverage --coverage.include='src/coll.ts' --coverage.reporter=text` (all contract specs)
  - `packages/renderer`: `npx ng test --coverage` with one `--coverage-include='src/app/…'` per renderer file listed above (8 flags; full renderer suite)
- Run start/completion time and exit status: backend 2026-11-17 04:41:44 (about 4 s), exit 0; contract 04:44:44, exit 0; renderer final run 04:44:16 (about 21 s), exit 0.
- Generated report paths and report hashes/run identifier: `packages/backend/coverage/coverage-summary.json` sha256 bb8bc2c3…; `packages/renderer/coverage/renderer/coverage-summary.json` sha256 ef3af140…, `packages/renderer/coverage/renderer/lcov.info` sha256 ee9a8ebf…; contract: text output only. `packages/renderer/coverage/coverage-summary.json` is a stale file from 2026-11-16 and was not used.
- Evidence outputs are fresh and inputs stayed unchanged: yes. The report files are timestamped at the run, and the production hashes are identical before and after.
- Final run after latest test additions and production fixes: yes for renderer and contract. The backend run came after the last backend spec change (backend specs did not change afterwards). No production fixes were made.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/browse/validator/validator.ts` | 47/47 (100%) | 39/40 (97.5%) | 10/10 (100%) | 40/40 (100%) |
| `packages/backend/src/browse/validator/handlers.ts` | 4/4 (100%) | N/A (0/0) | 4/4 (100%) | 4/4 (100%) |
| `packages/backend/src/browse/validator/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/backend/src/server/backend.ts` | 54/62 (87.1%) | 16/18 (88.9%) | 16/23 (69.6%) | 51/57 (89.5%) |
| `packages/contract/src/coll.ts` | 8/8 (100%) | N/A (0/0) | N/A (0/0) | 8/8 (100%) |
| `packages/renderer/src/app/validator/validator-view.ts` | 86/87 (98.9%) | 42/46 (91.3%) | 15/15 (100%) | 77/77 (100%) |
| `packages/renderer/src/app/validator/validator-marks.service.ts` | 44/45 (97.8%) | 26/27 (96.3%) | 9/9 (100%) | 34/34 (100%) |
| `packages/renderer/src/app/validator/validator.model.ts` | 14/14 (100%) | 7/8 (87.5%) | 2/2 (100%) | 12/12 (100%) |
| `packages/renderer/src/app/validator/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/renderer/src/app/collection/collection-view.ts` | 256/263 (97.3%) | 139/161 (86.3%) | 77/78 (98.7%) | 217/217 (100%) |
| `packages/renderer/src/app/layout/workspace.service.ts` | 55/55 (100%) | 37/38 (97.4%) | 16/16 (100%) | 38/38 (100%) |
| `packages/renderer/src/app/sidebar/sidebar-tree.service.ts` | 227/227 (100%) | 97/97 (100%) | 65/65 (100%) | 181/181 (100%) |
| `packages/renderer/src/app/app.config.ts` | 1/1 (100%) | N/A (0/0) | N/A (0/0) | 1/1 (100%) |
| **Aggregate (summed counters, measured files above)** | 796/815 (97.7%) | 403/435 (92.6%) | 214/222 (96.4%) | 663/670 (99.0%) |

The aggregate excludes the HTML/CSS templates and styles (not instrumentable). Every scoped `.ts` file was measured; none is missing.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `backend/src/browse/validator/validator.ts:29` (non-`Error` arm of the message ternary) | none: `BSON.EJSON.parse` always throws `Error` | Justified gap (defensive) |
| `backend/src/server/backend.ts:68-78,84` | code that existed before this task; the task changed one line (handler registration), and that line is covered | Out of task scope |
| `renderer/src/app/validator/validator-view.ts:71-73` (`??` fallbacks for a tab without `data`) | a validator tab is always opened with collection data (`openValidator`) | Justified gap |
| `renderer/src/app/validator/validator-view.ts:127` (stale read failure) | ordering: an older failed read must not overwrite a newer result | Covered after adding "ignores an older read that fails after a newer one answered". The remaining partial arm in the final report is the `finally`/`return` pairing |
| `renderer/src/app/validator/validator-view.ts:157` (`revert` with `saved === null`) | unreachable from the UI: the form appears only once `saved` is set | Justified gap |
| `renderer/src/app/validator/validator-marks.service.ts:80` (`aborted` after a successful answer) | `ApiService.request` rejects on abort, so a success after abort cannot reach this line; stale answers are covered via the reject path | Justified gap (defensive) |
| `renderer/src/app/validator/validator.model.ts:51` (non-`Error` arm) | the parser throws `ShellSyntaxError` only | Justified gap (defensive) |
| `renderer/src/app/collection/collection-view.ts` lines 183-185, 216-224, 251, 309, 333-334, 358, 415, 448-536 (22 branch arms) | all in code that existed before this task; the task's new lines (152-159, 366-382, 569-580) have every branch covered | Out of task scope |
| `renderer/src/app/layout/workspace.service.ts` (1 branch arm) | code that existed before this task; the task changed only the `TabKind` union | Out of task scope |

## Unable to test

- AC1 and AC2 need real MongoDB containers and the Electron/Playwright stack. This helper did not re-run them; the parent reported that `test/integration/validator.int.spec.ts` and `test/e2e/validator.e2e.ts` pass, and the parent should record that evidence with `tasks.py verify`.
- HTML/CSS of the validator tab and collection markers: covered only through component DOM assertions, not visually.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found.

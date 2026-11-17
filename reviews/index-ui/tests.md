# Test Report

Date: 2026-11-17

Task: index-ui — M3: Indexes tab

Scope: task commits e31e972, e4feff8 on top of base b739b48d188a45b25e68023ffc6cc61f3479e17e (`git diff b739b48..HEAD`, HEAD e4feff8d626f36258b68c9e8cf92cee3c115fe0c, branch main). The parent worker supplied base and commits. No uncommitted production changes. Uncommitted inputs are only the test files listed below.

Requirements:
- tasks/index-ui.md acceptance criteria (1) e2e TTL + partial index listed with options, (2) component tests for create form validation
- tasks/index-ui.md goal (list with stats, create with all options, drop with confirm, hide/unhide)
- docs/ARCHITECTURE.md "Coverage"; parent-worker test plan (model spec, IndexesView spec)
- Server rules that `buildIndex` itself documents (sparse+partial, TTL single field, unique hashed/wildcard, ...)

## Test files changed

- `packages/renderer/src/app/indexes/index-form.model.spec.ts` (new)
- `packages/renderer/src/app/indexes/indexes-view.spec.ts` (new)
- `packages/renderer/src/app/indexes/index-create-form.spec.ts` (4 tests added)
- `packages/renderer/src/app/collection/collection-view.spec.ts` (1 test added)
- `packages/renderer/src/app/sidebar/sidebar-tree.service.spec.ts` (3 tests added)

## Tests added or updated

Count: 155 (98 in index-form.model.spec.ts counting parameterized cases, 49 in indexes-view.spec.ts, 4 + 1 + 3 in existing specs). The existing 15 create-form tests are unchanged.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 e2e: create TTL and partial index, see them listed with options | `test/e2e/indexes.e2e.ts` (existing) | not run by test-writer (the parent reported `npm run test:e2e -- test/e2e/indexes.e2e.ts` -> 1 passed) | Not run: test-writer did not re-run the browser suite. The parent's run is the evidence. |
| AC2 create form validation (component) | index-create-form.spec.ts: 15 existing + `removing a field drops the positional and TTL errors...`, `shows a whole-key error and clears it when a field changes`, `on a production profile asks first and a cancel sends nothing...`, `sends one create while the first is still running` | `npx ng test --include='src/app/indexes/**/*.spec.ts'` | Pass |
| AC2 validation rules (pure model): every branch of `buildIndex`, `isWildcard`, `emptyDraft`, `printCreateIndex` | index-form.model.spec.ts (key fields, name, unique, sparse/partial, hidden, TTL incl. INT32_MAX boundary, collation, weights/language, wildcard projection, multi-error, EJSON round-trip) | same | Pass except 1 test that fails: `refuses the field ".$**"` (TW-1) |
| List with stats (keys, tags, partial filter, size, uses, usage meter, count) | indexes-view.spec.ts `shows one row per index...`, `says "1 index"...`, `shows an unparseable "since"...`, `toRows`/`keyParts`/`formatBytes`/`indexesTabId` suites | same | Pass |
| Failed idx.stats only empties sizes/uses | `a failed idx.stats keeps the list and only empties sizes and uses` | same | Pass |
| Failed idx.list / loading state | `a failed idx.list shows the error, keeps the previous rows and ends loading`, `a failed first idx.list...`, `shows "Reading indexes…" while the first read is pending...` | same | Pass |
| Drop with confirm through ConfirmService, nothing sent on cancel | `asks through the confirm dialog and sends nothing on cancel`, `sends idx.drop with confirmed after the user confirms, then reloads`, `shows a server error as an alert...`, `ignores a second write while one is running` | same | Pass |
| Hide/unhide | `hides a visible index without asking...`, `unhides a hidden index`, `shows a hide failure`, `asks before hiding on a production profile and sends nothing on cancel` | same | Pass |
| `_id_` has no actions | `_id_ has no hide or drop actions; others have both` | same | Pass |
| Read-only disables writes | `disables create, hide and drop with the read-only hint but still lists`, `refuses a drop called directly before anything is sent or asked` | same | Pass |
| Stale reload answers ignored | `an older successful answer arriving last...`, `an older failure arriving last...`, `switching to another collection ignores the answer for the previous one`, `a new tab object for the same collection does not read again` | same | Pass |
| Create form opened from the view, reload after create | `opens the form, disables Create while open, and closes on cancel`, `after a create closes the form, reports it and reloads`, `opening the form clears the last message` | same | Pass |
| Indexes… opens the indexes tab (collection-view change) | `Indexes… opens the indexes tab of this collection, once` | `npx ng test --include='src/app/sidebar/sidebar-tree.service.spec.ts' --include='src/app/collection/collection-view.spec.ts'` | Pass |
| Dropping/renaming a collection or database closes its indexes tabs (sidebar change) | `indexes tabs` suite: drop collection, drop database, rename | same | Pass |

## Focused test execution

Command:

`npx ng test --include='src/app/indexes/**/*.spec.ts'` (cwd packages/renderer)

Result:

Fail: 165 passed, 1 failed (TW-1 only).

`npx ng test --include='src/app/sidebar/sidebar-tree.service.spec.ts' --include='src/app/collection/collection-view.spec.ts'` -> Pass (161 passed).

## Full test execution

Command:

`npm run check --prefix /home/eric/work/mongo-db-client-agents/agent-1`

Result:

Fail. Lint (eslint + prettier) passed. Typecheck passed. Root vitest: 64 files, 3545 passed. Renderer `ng test`: 2606 passed, 1 failed. The only failure is the TW-1 test.

## .taskcheck

Result:

Fail. `.taskcheck` runs `npm run check`, so it fails like the run above, only on the TW-1 test. It was not run separately.

## Bugs found

### A wildcard path with an empty leading part (`.$**`) passes validation

Finding ID:

`TW-1`

Test:

`buildIndex: key fields > refuses the field ".$**": A field path has no empty parts.` (packages/renderer/src/app/indexes/index-form.model.spec.ts)

Production source:

`packages/renderer/src/app/indexes/index-form.model.ts:101-104` (`fieldProblem`)

Requirement:

AC2 create form validation. The model has its own rule "A field path has no empty parts.", and it applies that rule to `a..b.$**` and `.a`.

Expected behavior:

`buildIndex` with the field `.$**` returns `errors['field.0'] = 'A field path has no empty parts.'` and sends nothing.

Actual behavior:

`fieldProblem` strips `.$**`, the base is `''`, and `if (base === '') return null` accepts it. The base is only empty for the bare `$**`. The draft is accepted and `{".$**": 1}` would be sent to the server. A fix is to check `field === '$**'` instead of `base === ''`.

Severity:

Low. It is an edge-case input, and the server refuses it with a server error instead of a field error.

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.`

## Coverage

Status: verified (whole-file, task-scoped). The run excluded the TW-1 test with `--filter`, because Vitest writes no coverage report when a test fails. The excluded test only exercises `fieldProblem`, which other tests already cover fully.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured (no changed-line tooling configured).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: index-ui; base b739b48d188a45b25e68023ffc6cc61f3479e17e; HEAD e4feff8d626f36258b68c9e8cf92cee3c115fe0c; commits e31e972, e4feff8 (supplied by the parent, confirmed with `git diff --stat b739b48..HEAD`).
- Source/test snapshot identifier (including uncommitted inputs): production at HEAD e4feff8 (no uncommitted production changes). Uncommitted test files, sha256: index-form.model.spec.ts b314cd3b569195344e437a1c4edec1f06b78ceab1b9014f50858c2b545ad2274; indexes-view.spec.ts aa6f0b640401c1aeed615dd0a3cf6d99caad9c7913a4eeb955284c9cf1bb2aab; index-create-form.spec.ts 93dcb4b537dceff32dab41e30bbb9dc02e3d47eddb939fdf78d7df69a684e18e; collection-view.spec.ts 82aa3380c0a78e3321c174175cc6b4e5339b2179f1263cbd5308ce7c3968f627; sidebar-tree.service.spec.ts c16775211d000d5aa7ea6d8ce3088bf359efed78fcbbaa4a78bb462aad7209e0.
- Exact included files: src/app/indexes/index-form.model.ts, indexes-view.ts, index-create-form.ts, src/app/collection/collection-view.ts, src/app/layout/workspace.service.ts, src/app/sidebar/sidebar-tree.service.ts, src/app/app.config.ts (paths relative to packages/renderer). Excluded: `indexes/index.ts` (re-exports only); templates/CSS (`*.html`, `*.css`; covered through component tests, and v8 does not instrument them); docs/ARCHITECTURE.md; test/e2e/indexes.e2e.ts (a test file).
- Provider/version, command, working directory, and test selection: Vitest v5.1.0 with v8 through the Angular unit-test builder. `npx --prefix packages/renderer ng test --coverage --coverage-reporters=text --coverage-reporters=json-summary --coverage-reporters=json --filter='^(?!.*field "\.\$\*\*").*$' --include='src/app/indexes/**/*.spec.ts' --include='src/app/collection/**/*.spec.ts' --include='src/app/sidebar/sidebar-tree.service.spec.ts' --include='src/app/layout/**/*.spec.ts' --coverage-include=<the 7 files above>` from packages/renderer. 14 spec files, 561 passed, 1 skipped by the filter (TW-1).
- Run start/completion time and exit status: 2026-11-17T04:14:50+01:00 to 04:15:04+01:00. All selected tests passed and the report was written.
- Generated report paths and report hashes/run identifier: packages/renderer/coverage/renderer/coverage-summary.json (sha256 d3c8157006b9b1bf167bc27a2865e2612c948f09b0b23ea153adda25b7c3e3d9), coverage-final.json (sha256 94212ba4c9a1c8ce8fca1b1cec56bbceb84db0a3b155ccef9a23a3b234e1de07), both written 04:15:04. The older `packages/renderer/coverage/coverage-summary.json` (16 Nov) is stale and was not used.
- Evidence outputs are fresh and inputs stayed unchanged: yes. The snapshot was taken just before the run, and no files were edited after it.
- Final run after latest test additions and production fixes: yes for the test additions. No production fixes have been made yet. TW-1 needs a rerun after the fix.

Values below use covered/total (percentage).

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `src/app/indexes/index-form.model.ts` | 143/143 (100%) | 115/115 (100%) | 18/18 (100%) | 111/111 (100%) |
| `src/app/indexes/indexes-view.ts` | 123/125 (98.4%) | 99/101 (98.0%) | 32/34 (94.1%) | 104/104 (100%) |
| `src/app/indexes/index-create-form.ts` | 93/93 (100%) | 40/41 (97.6%) | 34/34 (100%) | 71/71 (100%) |
| `src/app/collection/collection-view.ts` | 211/241 (87.6%) | 114/151 (75.5%) | 65/71 (91.5%) | 182/199 (91.5%) |
| `src/app/layout/workspace.service.ts` | 55/55 (100%) | 37/38 (97.4%) | 16/16 (100%) | 38/38 (100%) |
| `src/app/sidebar/sidebar-tree.service.ts` | 226/227 (99.6%) | 95/96 (99.0%) | 65/65 (100%) | 181/181 (100%) |
| `src/app/app.config.ts` | 0/1 (0%) | N/A (0/0) | N/A (0/0) | 0/1 (0%) |
| **Aggregate (summed counters, 7 files)** | 851/885 (96.2%) | 500/542 (92.3%) | 230/238 (96.6%) | 687/705 (97.4%) |

Aggregate scope: the 7 files above. Excluded: `indexes/index.ts`, templates, CSS. Most of collection-view.ts, workspace.service.ts and sidebar-tree.service.ts is code from before this task. In those files the task changed only `openIndexes`, a `TabKind` union member and one condition, and that changed code is covered.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `indexes/indexes-view.ts:193` (`hasUsage` computed, 2 fns, 2 branches) | None. Nothing reads it: the template and the class never use it. | Left uncovered. This is dead code; the parent may remove it. |
| `indexes/index-create-form.ts:148` (else of `if (key !== 'hidden')`) | Ticking "hidden" does not clear any error. This is trivial. | Left uncovered (non-material). |
| `app.config.ts:16` | Registers the `indexes` tab view at bootstrap | Left uncovered: no unit test loads the app config. The e2e (AC1) opens the tab in the real app. |
| `collection/collection-view.ts` (lines ~413-443 etc.) | Code from before this task, not changed by it | Out of task scope. `openIndexes` (525-527) was uncovered before and is now covered by `Indexes… opens the indexes tab...`. |
| `sidebar/sidebar-tree.service.ts:278` | Code from before this task | Out of task scope. The changed condition (line 448) is covered by the new `indexes tabs` suite. |

## Unable to test

- AC1 (e2e in the browser): the test-writer did not re-run it, because it needs the e2e stack. The parent reported 1 passed. No follow-up is needed unless the parent's run turns out stale.
- Visual direction / theme tokens (no hard-coded colors): there is no automated check for this. It belongs to the code review.

## Summary

Tests added; production defects were discovered and must be passed to the `fixer` before task completion. TW-1 (Low) is the only failing test, and it makes `npm run check` / `.taskcheck` fail until `fieldProblem` is fixed. Every other new and existing test passes.

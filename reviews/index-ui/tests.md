# Test Report

Date: 2026-11-17

Task: index-ui — M3: Indexes tab (second pass, final revision after the fixer)

Scope: the task commits 7e856b7, b17a5c5, 6b2c038, 3bd499e (all "index-ui:" commits in `git log`) on top of 3a2f9aa21b5a65caefd94fa4fa3a1eb508f9985b (`git merge-base HEAD origin/main`; the parent of 7e856b7). The parent named b739b48 as the original base; after the rebase, `git diff 3a2f9aa..HEAD -- packages` shows exactly the task's 18 files. HEAD 3bd499e91de605e396d821e63adeef9c05f98772, branch main. This pass focuses on the fixer's commit 3bd499e (index-form.model.ts, index-create-form.{ts,html}, indexes-view.ts; see reviews/index-ui/fixes.md). No uncommitted production changes. Uncommitted inputs are the three spec files listed below. `reviews/index-ui/review.md` is also modified in the working tree, but the test-writer did not change it.

Requirements:
- tasks/index-ui.md acceptance criteria: (1) e2e TTL + partial index listed with options, (2) component tests for create form validation
- tasks/index-ui.md goal (list with stats, create with all options, drop with confirm, hide/unhide)
- reviews/index-ui/review.md findings CR-1, CR-3, CR-4, CR-5 and TW-1 (previous tests.md), as fixed in reviews/index-ui/fixes.md
- docs/ARCHITECTURE.md "Indexes tab" and "Coverage"

## Test files changed

- `packages/renderer/src/app/indexes/index-create-form.spec.ts` (3 tests added in this pass)
- `packages/renderer/src/app/indexes/indexes-view.spec.ts` (3 tests added in this pass)
- `packages/renderer/src/app/indexes/index-form.model.spec.ts` (1 test added in this pass)

## Tests added or updated

Count: 7 added in this pass. No existing test was changed. The fixer's own tests (in 3bd499e) were reviewed and kept.

- index-create-form.spec.ts: `enables Cancel again after a failed create`, `greys out the wildcard projection only while $** is not a text field`, `shows the 2d position error as a whole-key error`
- indexes-view.spec.ts: `renders a text index with its text fields, the language tag and the wildcard projection tag` (DOM), `keeps the raw _fts/_ftsx key parts when the raw spec has no weights`, `does not tag a default_language that is not a string`
- index-form.model.spec.ts: `reports the 2d position and the 2d collation refusal together`

## Requirement coverage

All rows in the "Pass" state were run with `npx ng test --include='src/app/indexes/**/*.spec.ts'` (cwd packages/renderer): 3 files, 194 passed.

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 e2e: create TTL and partial index, see them listed with options | `test/e2e/indexes.e2e.ts` (existing) | not run by the test-writer | Not run: the test-writer did not run the browser suite. The parent's e2e run is the evidence, and it must be repeated on the final revision if the parent requires it. |
| AC2 create form validation (component) | index-create-form.spec.ts, 24 tests | focused command | Pass |
| TW-1 `.$**` refused | `refuses the field ".$**": A field path has no empty parts.` (now passes) | focused command | Pass |
| CR-1 wildcard text index `{ "$**": "text" }` | model: `allows the wildcard text index...`, `...with plain and other text fields`, `refuses text on a path wildcard`, `refuses the wildcard text field together with a wildcard (non-text) field`, `refuses the wildcard text field together with %s` (3), `refuses a wildcard field of type %s` (3), `sends weights and a language for the wildcard text index`, `is refused for the wildcard text index` (projection); component: `creates a wildcard text index with weights and language...`, `refuses a wildcard projection and a collation on a wildcard text index`, `greys out the wildcard projection only while $** is not a text field` (new) | focused command | Pass |
| CR-3 2d must be first | model: `refuses a 2d field that is not the first field of the key`, `allows a 2d field first with further fields`, `refuses text together with 2d` (whole-key priority); component: `shows the 2d position error as a whole-key error` (new) | focused command | Pass |
| CR-3 collation refused with text / 2d | model: `refuses a collation on a text/2d index`, `refuses a collation on the wildcard text index`, `allows a collation on a 2dsphere index`, `reports the 2d position and the 2d collation refusal together` (new); option order still checked on a plain key in `builds every option in a fixed order` | focused command | Pass |
| CR-4 Cancel disabled while saving | `disables Cancel while a create is running and enables it again afterwards`, `enables Cancel again after a failed create` (new) | focused command | Pass |
| CR-5 text index keys shown from weights; language and wildcard projection tags | toRows: `shows the text fields of a text index from its weights...`, `shows a wildcard text index as $** text and tags a non-default language`, `keeps the raw _fts/_ftsx key parts when the weights cannot be read`, `...when the raw spec has no weights` (new), `does not tag a default_language that is not a string` (new), `tags a wildcard projection...`; DOM: `renders a text index with its text fields, the language tag and the wildcard projection tag` (new) | focused command | Pass |
| List, stats, drop, hide, read-only, stale answers, create form from the view (from the first pass) | indexes-view.spec.ts suites | focused command | Pass |
| Indexes… opens the tab; dropping/renaming closes indexes tabs | collection-view.spec.ts, sidebar-tree.service.spec.ts (first pass) | coverage command below (14 files) | Pass |

## Focused test execution

Command:

`npx ng test --include='src/app/indexes/**/*.spec.ts'` (cwd packages/renderer)

Result:

Pass: 3 files, 194 passed (187 before this pass plus 7 new).

## Full test execution

Command:

`npm run check --prefix /home/eric/work/mongo-db-client-agents/agent-1` (lint = eslint + prettier --check, typecheck, then tests; chained with `&&`)

Result:

Pass. Lint and typecheck passed, because the test stage only starts after them. Root vitest: 69 files, 3866 passed. Renderer `ng test`: 84 files, 2654 passed.

## .taskcheck

Result:

Pass. `.taskcheck` runs `npm run check`, which passed above. It was not run separately.

## Bugs found

None in this pass. TW-1 from the first pass is fixed: its test now passes unchanged.

## Coverage

Status: verified (whole-file, task-scoped, final revision 3bd499e plus the new tests).

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured (no changed-line tooling is configured).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: index-ui. Base 3a2f9aa21b5a65caefd94fa4fa3a1eb508f9985b (the rebased merge-base; the original base was b739b48). HEAD 3bd499e91de605e396d821e63adeef9c05f98772. Commits 7e856b7, b17a5c5, 6b2c038, 3bd499e, identified by the "index-ui:" subject that the parent named. File list from `git diff --stat 3a2f9aa..HEAD -- packages`.
- Source/test snapshot identifier (including uncommitted inputs): production at HEAD 3bd499e, with no uncommitted production changes. Uncommitted spec files, sha256: index-form.model.spec.ts 1df0f5a6c526ad48e4605c945c4f76049bbfdd1f00cf60d66ed28c3aa228f0f3; indexes-view.spec.ts 511529bccef2ff93c981df62e58b3353236b128b09778754c62b889682e2e1c6; index-create-form.spec.ts 32e96e8a0242d0131c9df7b2bc49ed91656cfbc6844963576b1cf47f469e19d0. The hashes were the same after the coverage run and after `npm run check`.
- Exact included files (relative to packages/renderer): src/app/indexes/index-form.model.ts, indexes-view.ts, index-create-form.ts, src/app/collection/collection-view.ts, src/app/layout/workspace.service.ts, src/app/sidebar/sidebar-tree.service.ts, src/app/app.config.ts. Excluded: `indexes/index.ts` (re-exports only), because it has no logic. `*.html` and `*.css` are excluded because v8 does not instrument them; the component and DOM tests exercise the templates. docs/ARCHITECTURE.md is excluded as documentation. test/e2e/indexes.e2e.ts and the spec files are excluded because they are tests. No renamed or deleted files.
- Provider/version, command, working directory, and test selection: Vitest v5.1.0 with v8, through the Angular unit-test builder. Cwd packages/renderer: `npx ng test --coverage --coverage-reporters=text --coverage-reporters=json-summary --coverage-reporters=json --include='src/app/indexes/**/*.spec.ts' --include='src/app/collection/**/*.spec.ts' --include='src/app/sidebar/sidebar-tree.service.spec.ts' --include='src/app/layout/**/*.spec.ts' --coverage-include=<each of the 7 files above>`. 14 spec files ran, 589 passed. No filter was used and nothing was skipped.
- Run start/completion time and exit status: started 2026-11-17T04:23:30+01:00, report written at 04:23:39+01:00. All tests passed and the report was produced.
- Generated report paths and report hashes/run identifier: packages/renderer/coverage/renderer/coverage-summary.json (sha256 d907eb6c5578ca747be5ad5e69713eba573a221238bfb5c55407abdfc4eed744) and coverage-final.json (sha256 345ed1b4d03d4a37a3048a5e649ce04b082b804543726ab684ec252ac41043d6), both with mtime 04:23:39.
- Evidence outputs are fresh and inputs stayed unchanged: yes. The report mtimes match this run. The spec hashes were checked again after the run.
- Final run after latest test additions and production fixes: yes. The run covers the fixer's commit 3bd499e and all 7 new tests.

Values below use covered/total (percentage).

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `src/app/indexes/index-form.model.ts` | 155/155 (100%) | 133/133 (100%) | 18/18 (100%) | 119/119 (100%) |
| `src/app/indexes/indexes-view.ts` | 144/144 (100%) | 115/115 (100%) | 39/39 (100%) | 118/118 (100%) |
| `src/app/indexes/index-create-form.ts` | 93/93 (100%) | 42/43 (97.67%) | 34/34 (100%) | 71/71 (100%) |
| `src/app/collection/collection-view.ts` | 211/241 (87.55%) | 114/151 (75.49%) | 65/71 (91.54%) | 182/199 (91.45%) |
| `src/app/layout/workspace.service.ts` | 55/55 (100%) | 37/38 (97.36%) | 16/16 (100%) | 38/38 (100%) |
| `src/app/sidebar/sidebar-tree.service.ts` | 226/227 (99.55%) | 95/96 (98.95%) | 65/65 (100%) | 181/181 (100%) |
| `src/app/app.config.ts` | 0/1 (0%) | N/A (0/0) | N/A (0/0) | 0/1 (0%) |
| **Aggregate (summed counters, 7 files)** | 884/916 (96.5%) | 536/576 (93.05%) | 237/243 (97.53%) | 709/727 (97.52%) |

Aggregate scope: the 7 files above. Excluded from it: `indexes/index.ts`, the templates and the CSS. Most of collection-view.ts, workspace.service.ts and sidebar-tree.service.ts is code from before this task. In those files the task changed only `openIndexes`, a `TabKind` member and one condition, and tests cover that changed code. The three indexes files are at 100% except one branch.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `indexes/index-create-form.ts:149` (else of `if (key !== 'hidden')`) | Ticking "hidden" clears no error. This is trivial. | Left uncovered (non-material). |
| `app.config.ts:16` | Registers the `indexes` tab view at bootstrap | Left uncovered: no unit test loads the app config. The e2e (AC1) opens the tab in the real app. |
| `collection/collection-view.ts` (lines 413-424, 442-443, etc.) | Code from before this task | Out of task scope. The task's `openIndexes` is covered. |
| `layout/workspace.service.ts:85`, `sidebar/sidebar-tree.service.ts:278` | Code from before this task | Out of task scope. The changed lines are covered. |

The dead `hasUsage` computed from the first pass was removed by the fixer, so indexes-view.ts is now at 100%.

## Unable to test

- AC1 (browser e2e): the test-writer did not run it in this pass, so it is "Not run" here. The parent should use its own e2e run on the final revision as the evidence.
- Visual direction / theme tokens: there is no automated check. This belongs to the code review.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. Every fixed behavior has tests: the wildcard text index, 2d first, collation with text/2d, Cancel disabled while saving (now also after a failed create), and the text-index key display with the language and wildcard projection tags (now also in the rendered DOM). The 7 new tests pass, and `npm run check` / `.taskcheck` pass.

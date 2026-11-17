# Test Report

Date: 2026-11-17

Task: e2e-layout-import-heading - layout.e2e: welcome Import button test expects a page-heading the import page no longer has

Scope: `git diff 8efeae088488bc4b4589cbdeb64b997f901dac7d..bfab1677a87e6c3b9f22a6e551d103988a1fda6a` (base 8efeae08 = claim commit, task commit bfab1677 = HEAD on `main`), plus the uncommitted test change listed below.

Requirements:
- `tasks/e2e-layout-import-heading.md` acceptance criteria
- `docs/ARCHITECTURE.md` "Coverage" (task-scoped renderer coverage command)
- Existing `page-heading` unit tests on other pages (`welcome.spec.ts`, `app-shell.spec.ts`, `connection-editor.spec.ts`) as the convention

## Test files changed

- `packages/renderer/src/app/connections/import/import-export-page.spec.ts`

## Tests added or updated

Count: 1

- `ImportExportPage > marks its h1 as the page heading like the other pages`: renders the page and checks that exactly one `[data-testid="page-heading"]` exists, that it is the `H1`, and that its text is `Import and export connections`.

Why add it: the e2e suite is slow and not part of `npm run check`, which is how this regression got in unnoticed. Other pages already unit-test their `page-heading` (e.g. `connection-editor.spec.ts` checks `tagName === 'H1'`). Without the template change, `one('page-heading')` throws `no page-heading`, so the test fails on the base revision.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| 1. The import/export page h1 carries `data-testid="page-heading"` | `ImportExportPage > marks its h1 as the page heading like the other pages` | `cd packages/renderer && npx ng test --include='src/app/connections/import/import-export-page.spec.ts'` | Pass (18/18) |
| 2. `test/e2e/layout.e2e.ts` expects the real heading text and passes | `welcome buttons navigate to the connection editor and the Compass import` (layout.e2e.ts) | `npm run test:e2e -- layout.e2e.ts` | Not run by test-writer: the parent reports 6 passed. The unit test above checks the same heading text and test id. |
| 3. `npm run check` passes | whole check incl. the new test | `npm run check` | Pass (root Vitest 85 files / 4426 tests; renderer 102 files / 3387 tests; lint and typecheck ran with no errors) |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/app/connections/import/import-export-page.spec.ts'`

Result:

Pass: 1 file, 18 tests

## Full test execution

Command:

`npm run check`

Result:

Pass: root 85 files / 4426 tests, renderer 102 files / 3387 tests

## .taskcheck

Result:

Pass (`.taskcheck` runs `npm run check`, see above)

## Bugs found

None.

## Coverage

Status: verified

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: measured by hand from `lcov.info`. The only changed executable production line is `import-export-page.html` line 3 (the `h1`). It has `DA:3,15`, so it was hit 15 times: 1/1 changed lines covered. Changed-branch coverage was not measured because the change adds no branches.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `e2e-layout-import-heading`. Base is `8efeae088488bc4b4589cbdeb64b997f901dac7d`, and the measured HEAD and only task commit is `bfab1677a87e6c3b9f22a6e551d103988a1fda6a`. Both were supplied by the parent and checked with `git diff --stat 8efeae08..bfab1677`.
- Source/test snapshot identifier (including uncommitted inputs): HEAD bfab1677 plus the uncommitted `import-export-page.spec.ts` (sha256 `e5b4427671ad6fb4c13f3d47fc0315d9751c900ee05cd11c27c436622863f40b`). `import-export-page.html` has sha256 `12861abeb376ecaf403727dee10788a3c7fbb7061015c8d0cf5791bbd134c6d6`.
- Exact included files; renamed/deleted/excluded files and reasons: included is `packages/renderer/src/app/connections/import/import-export-page.html`. Excluded are `test/e2e/layout.e2e.ts` (a test file) and `tasks/e2e-layout-import-heading.md` (task metadata). There are no renames or deletions. `import-export-page.ts` was instrumented for context only. It was not changed by the task, so it is not in the scope.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with v8 through `@angular/build:unit-test`. The command was `npx ng test --include='src/app/connections/import/import-export-page.spec.ts' --coverage --coverage-include='src/app/connections/import/import-export-page.html' --coverage-include='src/app/connections/import/import-export-page.ts'`, run in `packages/renderer`.
- Run start/completion time and exit status: the build finished at 2026-11-17T05:36:03Z and the report was written at 05:36:06Z (local 06:36). All 18 tests passed and a coverage summary was printed.
- Generated report paths and report hashes/run identifier: `packages/renderer/coverage/renderer/coverage-summary.json` (sha256 `f237189ea892cd82f922ec95924f8695b2b592c137f619bf76de487df584c40c`) and `packages/renderer/coverage/renderer/lcov.info` (sha256 `31686651dda2eaa55c225fd68888eb46468f02ddaff90301d1eaaeebf4b8b924`). Both are git-ignored.
- Evidence outputs are fresh and inputs stayed unchanged: yes. The report files have mtime 06:36:06, which is this run. The spec and template were not edited after the run, and the hashes above were taken afterwards.
- Final run after latest test additions and production fixes: yes. The new test was added before the run, and there were no production fixes.

Values below use covered/total (percentage).

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/connections/import/import-export-page.html` | 130/130 (100%) | 18/18 (100%) | 6/6 (100%) | 83/83 (100%) |

The template is measured through Angular's AOT source maps. The change only adds a static attribute. So this coverage shows that the line is rendered, while the new unit test is what checks the attribute itself. No aggregate is given because there is only one file in scope.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `import-export-page.html` | none uncovered | n/a |
| (context, out of scope) `import-export-page.ts`: branches at lines 111 and 123 | not changed by this task | none, outside the task scope |

## Unable to test

- AC 2 (the e2e run) was not run again by the test-writer. The parent reports `npm run test:e2e -- layout.e2e.ts -> 6 passed`. The parent should record that as the evidence for AC 2.

## Summary

Tests added and all validation passed.

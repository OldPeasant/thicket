# Test Report

Date: 2026-11-17

Task: shell-scripts — M4 (Should): Run a script file in the shell

Scope: base `c1d702aa77c62dfdf6e705dbfba7f6bfdda09a92` .. HEAD `69cc678ae8b00d4e7b7cde86659dc3be37298f60`
(task commit `69cc678a` "shell-scripts: run a .js/.mongodb file in the mongosh console, e2e"; the
parent rebased it from `2e5d877a` during this run, and `git diff --stat` shows the same 6 files and
259+/9- lines), plus the uncommitted new/changed spec files listed below.

Requirements:
- `tasks/shell-scripts.md` acceptance criterion: "e2e: run a fixture script that inserts 3 docs; output shown, docs present"
- Task assumptions in `tasks/shell-scripts.md`: the file comes from the renderer's own `<input type=file>` and is sent through the existing `shell.eval`; only .js/.mongodb files up to 5 MB; "progress" means "Running <file>… N outputs so far" and then a finished/failed announcement
- Parent's list of component behaviour to cover (runScript sends shell.eval with the file text, the transcript shows the name and line count, running progress text, rejected files show the problem and send nothing, scripts are not added to history, the button is disabled while running or when the session is not open, the announcement for scripts)
- `docs/ARCHITECTURE.md` "Coverage"; existing conventions in `shell-console.spec.ts`

## Test files changed

- `packages/renderer/src/app/console/scripts/script-file.spec.ts` (new)
- `packages/renderer/src/app/console/shell-console.spec.ts` (new `describe('script files')` block and one new `announce` test; no existing test was changed)

## Tests added or updated

Count: 35 (15 in `script-file.spec.ts`, 19 in the `ShellConsole` > `script files` block, 1 in `announce`)

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: e2e, a fixture script inserts 3 docs; output shown, docs present | the existing e2e test in `test/e2e/shell.e2e.ts` (the parent's test, not written here) | parent ran `npm run test:e2e -- test/e2e/shell.e2e.ts` -> 3 passed | Not run by test-writer: the parent's result is reported here and was not repeated |
| Only .js/.mongodb files (case-insensitive) | `scriptFileProblem` > `accepts .js and .mongodb files…`, `refuses other files…`, `reports the wrong extension before the size`; `SCRIPT_ACCEPT` test; `Run script… opens the file chooser for .js and .mongodb files` | `cd packages/renderer && npx ng test --include='src/app/console/**/*.spec.ts'` | Pass |
| 5 MB limit (boundary) | `accepts a script of exactly the size limit and refuses one byte more`, `refuses a too large file without reading it` | same | Pass |
| Read/empty/BOM handling, line count | `readScriptFile` > `returns the name, the text and the number of lines`, `counts lines without the final line break…`, `keeps the text as it is…`, `drops a UTF-8 byte order mark`, `reports a file that could not be read`, `refuses an empty, blank or BOM-only file`, `throws Error instances…`, `allows an empty file through the check…` | same | Pass |
| runScript sends shell.eval with the file text | `runs the file text in the session with shell.eval`, `runs the file chosen in the file input`, `runs in the current database after \`use\`` | same | Pass |
| Transcript shows the name and line count, not the code | `shows the file name and its lines in the transcript instead of the code`, `says "1 line" for a one-line script` | same | Pass |
| Progress while running, output streams in | `shows the progress while the script runs and its output as it streams in` | same | Pass |
| Rejected files show the problem and send nothing | `shows why a chosen file is not run, and sends nothing`, `refuses a too large, an empty or an unreadable file`, `clears the problem with the next good file or the next typed run`, `does nothing when the file chooser was cancelled` | same | Pass |
| Not added to the input history | `does not add the script to the input history and keeps the typed draft` | same | Pass |
| Disabled while running or when the session is not open | `is disabled while something runs and sends no second run`, `a running script disables Run script… and the typed run`, `is disabled when the session is not open and runs nothing`, `sends nothing when the tab goes away while the file is read` | same | Pass |
| Script announcements (finished/stopped/failed) | `announces the end of a script by its name`, `announces the first error of a failed script`, `stops a running script and announces it by name`, `announce` > `names the script of a script run` | same | Pass |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/app/console/**/*.spec.ts'`

Result:

Pass: 3 files, 140 tests.

## Full test execution

Command:

`sh .taskcheck` (`npm run check`: eslint + prettier, typecheck, root `vitest run`, renderer `ng test`)

Result:

Pass. Root vitest: 87 files, 4457 tests passed. Renderer: 103 files, 3422 tests passed. The first attempt failed lint (`@typescript-eslint/consistent-type-definitions` on a `type` alias in the new spec). I changed it to an `interface` and the re-run passed.

## .taskcheck

Result:

Pass

## Bugs found

None. No test failed against the production code.

Observations below the bug threshold (no requirement covers them, so no failing test was written; the parent can decide):
- `shell-console.ts:292`: if a typed run starts while a chosen file is still being read, `runScript` returns without running the script and without a message, so the user's choice is dropped silently. The window is very short (`File.text()`), so the risk is low.
- `script-file.ts:39`: a file just above the limit reports "(5.0 MB; at most 5.0 MB)" because of the rounding to one decimal. This is cosmetic.

## Coverage

Status: verified

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: measured by intersecting the provider's lcov `DA`/`BRDA` records with the added and modified lines of `git diff -U0 c1d702aa 69cc678a`. `script-file.ts` is all new: 22/22 lines and 12/14 branches. `shell-console.ts` changed executable lines (104, 105, 113, 144, 146, 148, 186, 187, 259, 260, 265, 266, 270, 271, 273, 274, 283, 285, 286, 288, 289, 291–295, 300, 308, 309): 29/29 lines, and 20/21 branches on changed lines. Total changed lines: 51/51 (100%).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `shell-scripts`; base `c1d702aa77c62dfdf6e705dbfba7f6bfdda09a92` (from the parent); HEAD `69cc678ae8b00d4e7b7cde86659dc3be37298f60`. The only task code commit is `69cc678a`, the rebase of `2e5d877a`, with the same file list. The parent supplied the scope, and `git log --stat c1d702aa..HEAD -- packages test` confirms it.
- Source/test snapshot identifier (including uncommitted inputs): sha256 `script-file.ts` 5eba83a9…b31b3b, `shell-console.ts` 3b63e80a…afeb5, `shell-console.html` f2399690…26c4a (all the same as HEAD, with no uncommitted production changes), `script-file.spec.ts` 4080725d…dafeb5ce (uncommitted, new), `shell-console.spec.ts` 92c85141…2167d42 (uncommitted). The hashes were the same before and after the final run.
- Exact included files; renamed/deleted/excluded files and reasons: included `packages/renderer/src/app/console/scripts/script-file.ts` and `packages/renderer/src/app/console/shell-console.ts`. Excluded: `shell-console.html` (an Angular template that v8 does not instrument as a separate file; its behaviour is asserted through DOM tests), `shell-console.css` (styles only), `test/e2e/shell.e2e.ts` and `test/e2e/fixtures/insert-three.mongodb` (test code and fixture). No files were renamed or deleted.
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8` via `@angular/build:unit-test`, vitest 5.1.0, node v24.21.0; `npx ng test --include='src/app/console/**/*.spec.ts' --coverage --coverage-include='src/app/console/scripts/script-file.ts' --coverage-include='src/app/console/shell-console.ts'` in `packages/renderer`; console specs only (3 files, 140 tests).
- Run start/completion time and exit status: start 2026-11-17 06:49:12 +01:00, report written 06:49:17 +01:00; 140 passed, success.
- Generated report paths and report hashes/run identifier: `packages/renderer/coverage/renderer/coverage-summary.json` (sha256 7cc42ef0…92fe544), `packages/renderer/coverage/renderer/lcov.info` (sha256 e2222550…11832ae), `packages/renderer/coverage/renderer/lcov-report/`.
- Evidence outputs are fresh and inputs stayed unchanged: yes. The report files have the 06:49:17 timestamps of this run (an older 05:40 report was overwritten), and the source hashes did not change during the run.
- Final run after latest test additions and production fixes: yes. It ran after the last spec edit, and no production fixes were made.

Values below use covered/total (percentage).

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/console/scripts/script-file.ts` | 26/28 (92.85%) | 12/14 (85.71%) | 5/5 (100%) | 22/22 (100%) |
| `packages/renderer/src/app/console/shell-console.ts` | 287/295 (97.28%) | 191/202 (94.55%) | 58/62 (93.54%) | 242/244 (99.18%) |
| Aggregate (summed counters, both files; html/css excluded as above) | 313/323 (96.90%) | 203/216 (93.98%) | 63/67 (94.02%) | 264/266 (99.24%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `script-file.ts:66` and `:67` (the B and KB branches of `formatSize`) | none | Unreachable today: `formatSize` is only called with a size above 5 MB or with the 5 MB limit itself, so it always formats MB. This is a justified gap. |
| `shell-console.ts:288` branch 1 (`String(error)` for a non-`Error` throw) | none | Defensive: `readScriptFile` only throws `Error`, and `throws Error instances` asserts that. This is a justified gap. |
| `shell-console.ts:155/157` (the `target` equality function), `:213` (no transcript element), `:232` and `:248` (`.catch` of `shell.close`), `:335`, `:348`, `:353`, `:450`, `:491`, `:539`, and the `viewQuery` function | Code that existed before this task, unchanged by it | Outside the task's changed lines; no tests were added. |

## Unable to test

- AC1 (e2e against real mongosh/MongoDB): I did not run it. The parent reports `npm run test:e2e -- test/e2e/shell.e2e.ts` -> 3 passed; that result is the parent's evidence, not this report's.
- The real OS file chooser dialog cannot be opened in unit tests. The tests check that `Run script…` calls `click()` on the hidden file input, and they simulate the input's `change` event with a stubbed `files` list. No follow-up is needed because the e2e covers the real input.

## Summary

Tests added and all validation passed. Task-scoped coverage is sufficient (changed lines 51/51), and no production defects were found.

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

# Round 2

Date: 2026-11-17

Task: shell-scripts — M4 (Should): Run a script file in the shell

Scope: base `c1d702aa77c62dfdf6e705dbfba7f6bfdda09a92` .. HEAD `dc96c1f1470f060d6ddb2f05a56382bc870c7e6e`. The task code commits are `e6f99bee` (the implementation), `45897b54` (round-1 tests and reports) and `dc96c1f1` (fixes for CR-1, CR-2 and TW-2; see `reviews/shell-scripts/fixes.md`). The measurement also includes one uncommitted spec change made in this round (listed below). The production files are the same as in round 1: `script-file.ts` and `shell-console.ts`, plus `shell-console.html` and `.css`.

Requirements: same as round 1, plus the fixed behaviour from `fixes.md`. That covers CR-1 (when a script is not run because the session closed or a run started while the file was read, the user is told why), CR-2 (a script run does not keep its text in `Run.code`) and TW-2 (the exact "larger than 5 MB" message).

## Review of the fix tests

| Fixed behaviour | Tests (in dc96c1f1 unless marked new) | Assessment |
|---|---|---|
| CR-1, busy: a run started while the file was read | `says why when a run started while the file was read` (deferred `text()`, typed run during the read; asserts one eval, `role="alert"`, "slow.js was not run: the shell is busy"); `is disabled while something runs and sends no second run` (now also asserts the busy message) | Adequate |
| CR-1, session not open: the session ended while the file was read | `says why when the session ended while the file was read` (`NOT_FOUND` on the eval stream during the read; asserts nothing more is sent and the message "the session is not open") | Adequate |
| CR-1, the destroyed tab stays silent | `sends nothing when the tab goes away while the file is read` (unchanged) | Adequate |
| CR-1, retry after a busy refusal: the message clears and the same file runs | **new:** `runs the same file once the busy run ends, and the busy message goes away` | This gap was found in this round. The test passes. |
| CR-2: `code` is empty for script runs, and the text is still sent | `shows the file name and its lines in the transcript instead of the code` (`runs()[0].code === ''`); `runs the file text in the session with shell.eval` (full text sent); typed runs still keep `code` (the existing tests at spec lines 486/487) | Adequate |
| TW-2: exact limit message | `accepts a script of exactly the size limit and refuses one byte more` (`MAX_SCRIPT_BYTES + 1` and 12 MB both give "…larger than 5 MB") | Adequate |

## Test files changed (round 2)

- `packages/renderer/src/app/console/shell-console.spec.ts`: one new test in `ShellConsole` > `script files`. No existing test was changed.

Count: 1 added.

## Focused test execution

Command: `cd packages/renderer && npx ng test --include='src/app/console/**/*.spec.ts'`

Result: Pass. 3 files, 143 tests (142 from the fixer plus 1 new).

`npx prettier --check` and `npx eslint` on `shell-console.spec.ts`: Pass.

## Full test execution / .taskcheck

Not run by the test-writer in round 2. Permission to run `sh .taskcheck` was denied in this session. The fixer reported `npm run check` and `.taskcheck` passing on dc96c1f1 without the new test. The parent should run `.taskcheck` with the new test included.

## Bugs found

None. The new test passed against the production code at dc96c1f1.

## Coverage (round 2)

Status: verified

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: I intersected the lcov `DA`/`BRDA` records with the added and modified lines of `git diff -U0 c1d702aa dc96c1f1` for each file. `script-file.ts` is all new and has 20/20 lines and 10/10 branches. The changed lines in `shell-console.ts` are 31, 66–70, 107–108, 116, 147–151, 189–191, 262–310 and 312–322. Their executable lines are 35/35, and the branches on them are 23/24. The only uncovered branch is `:291` branch 1, which is `String(error)` for a throw that is not an `Error`. Total changed lines: 55/55 (100%). Changed branches: 33/34.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `shell-scripts`; base `c1d702aa77c62dfdf6e705dbfba7f6bfdda09a92` (from the parent); HEAD `dc96c1f1470f060d6ddb2f05a56382bc870c7e6e`. The task code commits are `e6f99bee`, `45897b54` and `dc96c1f1`, as supplied by the parent and confirmed with `git show --stat`.
- Source/test snapshot identifier (sha256, the same before and after the run): `script-file.ts` 8a0e8a4c…2b54e5 and `shell-console.ts` 1735c95e…955f23, both identical to HEAD; `script-file.spec.ts` 3bac3606…edaa, identical to HEAD; `shell-console.spec.ts` 13ee2613…2c2039, uncommitted (+1 test).
- Exact included files and exclusions: included `packages/renderer/src/app/console/scripts/script-file.ts` and `packages/renderer/src/app/console/shell-console.ts`. The exclusions are the same as in round 1: the html template, which v8 does not instrument separately and which the DOM tests cover; the css; and the e2e test and its fixture. No files were renamed or deleted.
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8` via `@angular/build:unit-test`, vitest 5.1.0. Command: `npx ng test --include='src/app/console/**/*.spec.ts' --coverage --coverage-include='src/app/console/scripts/script-file.ts' --coverage-include='src/app/console/shell-console.ts'` in `packages/renderer`. Test selection: the console specs (3 files, 143 tests).
- Run start/completion time and exit status: started 2026-11-17 06:55:31 +01:00, report written 06:55:36 +01:00. 143 passed; the coverage summary was printed.
- Generated report paths and hashes: `packages/renderer/coverage/renderer/coverage-summary.json` (sha256 c89a510f…3c4cc064) and `packages/renderer/coverage/renderer/lcov.info` (sha256 c1eb2a5b…3562d).
- Evidence outputs are fresh and inputs stayed unchanged: yes. The file mtimes are 06:55:36, which is this run, and they replaced round 1's 06:49 report. The totals also differ from round 1's: `script-file.ts` went from 14 to 10 branches after `formatSize` was removed.
- Final run after latest test additions and production fixes: yes. It ran after dc96c1f1 and after the new test.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/console/scripts/script-file.ts` | 24/24 (100%) | 10/10 (100%) | 4/4 (100%) | 20/20 (100%) |
| `packages/renderer/src/app/console/shell-console.ts` | 293/301 (97.34%) | 194/205 (94.63%) | 58/62 (93.54%) | 248/250 (99.20%) |
| Aggregate (summed counters, both files; html/css excluded as above) | 317/325 (97.53%) | 204/215 (94.88%) | 62/66 (93.93%) | 268/270 (99.25%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `script-file.ts` | — | Fully covered. The round-1 gap in `formatSize` was removed by the TW-2 fix. |
| `shell-console.ts:291` branch 1 (`String(error)` for a throw that is not an `Error`) | none | Defensive code. `readScriptFile` only throws `Error`, and `throws Error instances` asserts that. This is a justified gap. |
| `shell-console.ts:158`, `:160`, `:216`, `:235`, `:348`, `:361`, `:366`, `:463`, `:504`, `:552` and the 4 uncovered functions | Code that existed before this task (the round-1 gaps, with line numbers shifted by the fix) | Outside the task's changed lines. No tests were added. |

## Unable to test (round 2)

- The AC1 e2e is re-run by the parent and was not run here.
- `.taskcheck` and the full suite: permission was denied in this session (see above).

## Summary (round 2)

Tests added. The focused console suite passes (143 tests), and no production defects were found. The fixes for CR-1, CR-2 and TW-2 are covered by tests. Changed-line coverage is 55/55 lines and 33/34 branches. `.taskcheck` was not run by the test-writer in this round, so the parent must run it.

# Round 3

Date: 2026-11-17

Task: shell-scripts — M4 (Should): Run a script file in the shell

Scope: base `c1d702aa77c62dfdf6e705dbfba7f6bfdda09a92` .. HEAD `8af8d202370a7227ed427cf68ed2073d2ea3a9db`. The only code change since round 2 is `8af8d202` (fix CR-3; see `reviews/shell-scripts/fixes.md` Round 2). It replaces the literal byte order mark character with the escape `'﻿'` in `script-file.ts:58` and in two places in `script-file.spec.ts` (lines 88 and 125). `shell-console.ts` is unchanged since round 2: its sha256 is the same. No uncommitted source or test changes were in the measured snapshot. The working tree was clean apart from this report.

Requirements: same as rounds 1 and 2, plus CR-3. CR-3 needs no behaviour change, so the BOM must still be stripped.

## Do the BOM tests still exercise real BOM stripping?

Yes.
- `grep -c -P '\x{FEFF}'` finds 0 literal BOM characters in `script-file.ts` and `script-file.spec.ts`, so the escape is now the only BOM in both files.
- In a TS/JS string literal, `'﻿'` is the single code unit U+FEFF. The production check `code.startsWith('﻿')` and the spec input `'﻿print(1)'` therefore use the same character a UTF-8 BOM decodes to. The spec helper's `size` (via `TextEncoder`) counts it as 3 bytes (EF BB BF).
- Runtime evidence from the fresh lcov: `BRDA:58,3,0,3` shows the strip branch at `script-file.ts:58` was taken 3 times. Those are `drops a UTF-8 byte order mark` plus the two BOM inputs of `refuses an empty, blank or BOM-only file`.
- `drops a UTF-8 byte order mark` would fail without the strip, because the code would stay `'﻿print(1)'` and the test expects `'print(1)'`. That test is the regression guard. The BOM-only cases of `refuses an empty, blank or BOM-only file` would pass even without the strip, because ECMAScript `String.prototype.trim()` already removes U+FEFF. They are still correct tests, but they do not by themselves prove the strip runs. This was already true before CR-3, so nothing needs to change.

## Test files changed (round 3)

None. No tests were added or changed in this round. The CR-3 spec edit was made by the fixer in `8af8d202`, and I reviewed it above.

Count: 0

## Focused test execution

Command: `cd packages/renderer && npx ng test --include='src/app/console/**/*.spec.ts'`

Result: Pass. 3 files, 143 tests (06:58:17 +01:00).

## Full test execution / .taskcheck

Command: `sh .taskcheck` (`npm run check` = `npm run lint && npm run typecheck && npm run test`)

Result: Pass. The renderer `ng test` runs last in the `&&` chain and reported 103 files, 3426 tests passed (06:59:40 +01:00), so lint, typecheck and the root vitest run before it also passed. The root vitest file and test counts were cut off by my output tail and are not recorded here.

## Bugs found

None.

## Coverage (round 3)

Status: verified

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: `script-file.ts` is all new in `c1d702aa..8af8d202` and has 20/20 lines and 10/10 branches. CR-3 changed only line 58, which has `DA:58,32` and both branches taken (`BRDA:58,3,0,3` and `BRDA:58,3,1,29`). `shell-console.ts` is byte-identical to round 2 (sha256 1735c95e…955f23), and its round-2 changed-line result still holds: 35/35 lines and 23/24 branches on changed lines. The only uncovered branch is `:291` branch 1, the defensive `String(error)`. Total: 55/55 changed lines and 33/34 changed branches.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `shell-scripts`; base `c1d702aa77c62dfdf6e705dbfba7f6bfdda09a92` (from the parent); HEAD `8af8d202370a7227ed427cf68ed2073d2ea3a9db`. The task commits are `e6f99bee`, `45897b54`, `dc96c1f1`, `b32e49cc` and `8af8d202`. I confirmed the CR-3 file list with `git show --stat HEAD`.
- Source/test snapshot identifier (sha256, the same before and after the coverage run, all equal to HEAD): `script-file.ts` 8d6a657e…9d01e377, `shell-console.ts` 1735c95e…29955f23, `script-file.spec.ts` 3ad1eae7…a303a289, `shell-console.spec.ts` 13ee2613…2c2039.
- Exact included files and exclusions: included `packages/renderer/src/app/console/scripts/script-file.ts` and `packages/renderer/src/app/console/shell-console.ts`. The exclusions are the same as before: the `shell-console.html` template, which v8 does not instrument separately and which the DOM tests cover; `shell-console.css`, which holds only styles; and the e2e test and its fixture. No files were renamed or deleted.
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8` via `@angular/build:unit-test`, vitest 5.1.0. Command: `npx ng test --include='src/app/console/**/*.spec.ts' --coverage --coverage-include='src/app/console/scripts/script-file.ts' --coverage-include='src/app/console/shell-console.ts'` in `packages/renderer`. Test selection: the console specs (3 files, 143 tests).
- Run start/completion time and exit status: started 2026-11-17 06:58:37 +01:00, report written 06:58:42 +01:00. 143 passed, and the coverage summary was printed.
- Generated report paths and hashes: `packages/renderer/coverage/renderer/coverage-summary.json` (sha256 c89a510f…dcc4064) and `packages/renderer/coverage/renderer/lcov.info` (sha256 c1eb2a5b…1b03562d).
- Evidence outputs are fresh and inputs stayed unchanged: yes. The report files have mtime 06:58:42, which is this run. Their content hashes are identical to round 2. That is expected: CR-3 kept line 58's position and runtime meaning, and the reports contain no timestamps. The input hashes did not change during the run.
- Final run after latest test additions and production fixes: yes. It ran on `8af8d202`, after CR-3.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/console/scripts/script-file.ts` | 24/24 (100%) | 10/10 (100%) | 4/4 (100%) | 20/20 (100%) |
| `packages/renderer/src/app/console/shell-console.ts` | 293/301 (97.34%) | 194/205 (94.63%) | 58/62 (93.54%) | 248/250 (99.20%) |
| Aggregate (summed counters, both files; html/css excluded as above) | 317/325 (97.53%) | 204/215 (94.88%) | 62/66 (93.93%) | 268/270 (99.25%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `script-file.ts` | — | Fully covered. |
| `shell-console.ts:291` branch 1 (`String(error)` for a throw that is not an `Error`) | none | Defensive code. `readScriptFile` only throws `Error`, and `throws Error instances` asserts that. This is a justified gap. |
| `shell-console.ts:158`, `:160`, `:216`, `:235`, `:348`, `:361`, `:366`, `:463`, `:504`, `:552` and the 4 uncovered functions | Code that existed before this task | Outside the task's changed lines. No tests were added. |

## Unable to test (round 3)

- AC1 (the e2e against real mongosh/MongoDB) was not run by the test-writer. The parent owns that evidence.

## Summary (round 3)

Tests and task-scoped coverage are sufficient, and no production defects were found. After CR-3, the BOM tests still exercise real U+FEFF stripping (the strip branch was taken 3 times). The focused console suite (143 tests) and `.taskcheck` (renderer 3426 tests) pass. Changed-line coverage is 55/55 lines and 33/34 branches.

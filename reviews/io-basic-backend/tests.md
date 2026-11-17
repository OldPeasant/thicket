# Test Report

Date: 2026-11-17

Task: io-basic-backend - M1: Export and import JSON / JSON Lines

Scope: third test pass, on the final fix revision. Base 7906c6ca3aba897605b541415380aa044f49ec6f .. HEAD e577190c905c650a1caa49729601060e5fed0ef3 on branch main. The parent worker named the base and range. Task commits (`git log 7906c6c..HEAD`): 7ef0d1a (implementation), 3171c1e (integration tests), 1c9214b (docs), e4c771f (first test pass), 29ddec4 (fixes TW-1/TW-2/TW-3), 68b9042 (regression tests), e676611 (second test pass and code review), e577190 (fixes CR-1, CR-2, FX-1). This pass focuses on e577190 (`packages/backend/src/io/{scanner,import,export}.ts`). It checks that those fixes are well tested and that every acceptance criterion is still tested. The only uncommitted inputs from this helper are the three spec files listed below. `reviews/io-basic-backend/review.md` also shows as modified in `git status`. This helper did not change it.

Requirements:
- `tasks/io-basic-backend.md` acceptance criteria and the recorded assumptions
- `reviews/io-basic-backend/review.md` (CR-1, CR-2) and `reviews/io-basic-backend/fixes.md` (CR-1, CR-2, FX-1 fix descriptions)
- `docs/ARCHITECTURE.md` "Import/export" bullet and "Coverage" section
- Parent instructions for this pass

## Test files changed

- `packages/backend/src/io/scanner.spec.ts`
- `packages/backend/src/io/import.spec.ts`
- `packages/backend/src/io/export.spec.ts`

## Tests added or updated

Count: 8 added in this pass. No existing test was changed, weakened or skipped.

Review of the fixer's tests: they cover the main paths of all three fixes. CR-1 has a value that keeps growing in each of the three JSON shapes and in JSONL, a too-long value inside one chunk, the exact-limit acceptance and `importFile`/`previewFile` with the real constant. CR-2 has the stop mode and continue mode ordering and the 100-error cap with out-of-order arrival. FX-1 has the gated-open regression test for JSONL. The new tests close these gaps:

- scanner (5), CR-1:
  - `JsonScanner refuses an array element one character over the limit, however it is cut`
  - `JsonScanner refuses a sequence document one character over the limit, however it is cut`
  - `JsonScanner refuses a bare scalar one character over the limit, however it is cut` (the scalar ends at a newline, and also at `end()`)
  - `LineScanner refuses a line one character over the limit, however it is cut`

  The fixer's tests never closed a too-long value in a later chunk than the one where it started. So the size counted over earlier chunks (`this.size + to - from` in `close`) was not checked. Each new test checks every two-way cut and one character per chunk. It asserts the values before the long one and the exact error message with the start line.
- scanner, CR-1: `JsonScanner counts every value on its own: consecutive values at the limit are accepted`. The size must reset for each value. It covers array, sequence and scalar values, with every cut.
- import (2), CR-2 in stop mode:
  - `unordered: a refused earlier line found when flushing wins over a later bad line`. One unordered insert of lines 1-4, nothing sent again, the import rejects at line 2, and errors are `[2 SERVER_ERROR, 5 INVALID_PARAMS]` in line order.
  - `a bad line after a refused line of an earlier flushed batch keeps the earlier stop`. Reading stops at once, and the later bad line is never reported.
- export (1), FX-1: `a failed JSON export settles only after the late open, and leaves no file`. JSON writes `[` into the stream while the open is still pending. The test asserts that the export promise settles only after the gated open finished, and that no file is left.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: export 10 000 docs and import into a new collection gives identical documents (canonical) | int `exports 10 000 documents as jsonl (canonical) and imports them unchanged`, `... as json (canonical) ...`. Unit: `writes one JSON array in canonical EJSON that parses back to the same documents`, `parses canonical and relaxed EJSON into exact BSON types`, `inserts every document in order with exact types and reports totals` | `npm --prefix /home/felix/work/thicket-agents/agent-1 run test:int -- io.int` (Podman containers); `npx vitest run --root packages/backend src/io` | Pass (int 10/10, unit 154/154) |
| AC2: import with a bad line, continue mode reports the line number and imports the rest | int `continue mode reports the bad lines and imports the rest (JSON Lines)`, `continue mode in a JSON array reports the line of the bad element`. Unit: `skips bad lines, reports their line numbers and imports the rest`, `ordered: resubmits the rest of the batch after a refused document`, `unordered: sends the batch once; every refused document is reported`, `reports errors in line order when a refused line comes before a bad one` | same | Pass |
| AC3: memory stays bounded, export streams (200 000 docs) | int `streams 200 000 documents to the file without buffering them`. Unit: `waits for the file stream to drain when a batch exceeds its buffer (back pressure)` | same | Pass |
| CR-1: a scanned value or line longer than `MAX_VALUE_CHARS` throws a ScanError naming its start line. Import and preview reject INVALID_PARAMS, and the import keeps the documents before it | Fixer: `JsonScanner refuses %s that grows past the limit, naming its first line` (3), `JsonScanner refuses a value completed in one chunk that is too long`, `JsonScanner accepts a value of exactly the limit, however it is cut`, `LineScanner refuses a line that grows past the limit ...`, `LineScanner returns the lines before a too long one, then throws on the next call`, `LineScanner accepts a line of exactly the limit ...`, import `a %s value longer than MAX_VALUE_CHARS stops the import ...` (json, jsonl). New: the four `... one character over the limit, however it is cut` tests and `... consecutive values at the limit are accepted` | `npx vitest run --root packages/backend src/io` | Pass |
| CR-2: stop mode ends with the earliest failed line, and errors are kept in line order (first 100 lines) | Fixer: `a refused earlier line found when flushing wins over a later bad line`, `reports errors in line order when a refused line comes before a bad one`, `keeps the first 100 lines when errors come out of order`. New: `unordered: a refused earlier line found when flushing wins over a later bad line`, `a bad line after a refused line of an earlier flushed batch keeps the earlier stop`. Existing: `a stop before the broken structure wins (its line comes first)` | same | Pass |
| FX-1: a failed or cancelled export removes its file only after the open settled | Fixer: `a failure before the file is open removes the file once the open completed` (JSONL). New: `a failed JSON export settles only after the late open, and leaves no file`. Existing: `a cancel stops the export, kills the server operation and removes the file`, `removes the partial file ... when a getMore fails`, disk-full tests | same, plus `--repeats 5` | Pass (5 repeats, no flake) |
| Earlier fixes TW-1, TW-2, TW-3 (from earlier passes) | unchanged tests in `export.spec.ts` / `import.spec.ts` / `scanner.spec.ts` | same | Pass |
| Assumptions: stop mode keeps earlier lines, a failed export deletes the partial file, the preview skips values that do not parse | as listed in the earlier passes, plus int `stop mode ends with the first bad line and keeps the lines before it` | unit and int commands above | Pass |
| Dialogs, routing, write guard, UNSUPPORTED formats (unchanged since the first pass) | `src/io/handlers.spec.ts`, `src/server/backend.spec.ts`, `apps/desktop/src/dialogs/handlers.spec.ts`, `apps/desktop/src/main/handlers.spec.ts`; int `a cancelled save dialog answers streamId null`, `a read-only profile cannot import` | `npm --prefix /home/felix/work/thicket-agents/agent-1 run check` and the int command | Pass |

## Focused test execution

Command:

`npx vitest run --root /home/felix/work/thicket-agents/agent-1/packages/backend src/io/scanner.spec.ts`, then `npx vitest run --root /home/felix/work/thicket-agents/agent-1/packages/backend src/io`, then the same with `--repeats 5`

Result:

Pass: scanner 48/48, then 4 files with 154 tests, 0 skipped (also with `--repeats 5`, 6.9 s).

## Full test execution

Command:

`npm --prefix /home/felix/work/thicket-agents/agent-1 run test:int -- io.int` (Podman containers); `npm --prefix /home/felix/work/thicket-agents/agent-1 run check` (eslint, prettier, typecheck, root `vitest run`, renderer `ng test`)

Result:

Pass: io integration 10/10 (started 01:37:42, 12.9 s). Root vitest 53 files, 3160 tests passed. Renderer 64 files, 1596 tests passed. eslint, prettier and typecheck are clean.

Note: the first integration attempt, `npx vitest run --root <repo> --config test/integration/vitest.config.ts io.int`, failed before running any test. With `--root`, the relative config path did not resolve the global setup (`fixtures/global-setup.ts` not found). That was a problem with how the command was called, not a test failure. The `npm run test:int` form above is the project's own command.

## .taskcheck

Result:

Pass. `.taskcheck` runs `npm run check` when `package.json` exists, and that is the run above, made after all test edits.

## Bugs found

None. The fixes CR-1, CR-2 and FX-1 behave as `fixes.md` describes, and every new test passed on the first run.

Observations, not defects (no requirement covers them, and they lose no data):
- The cap counts some characters that are not part of the value. In a JSON array, whitespace between a value and the next `,`/`]` counts toward it. In JSON Lines, a trailing `\r` counts. A value within a few characters of 64 Mi characters can therefore be refused, although its trimmed text fits. At this limit (about 4 times the 16 MiB BSON maximum) this cannot affect a valid document in practice.
- In unordered stop mode, a refused line does not undo the documents after it in the same batch (the new test shows lines 3-4 are inserted while the import "stopped at line 2"). This is how unordered inserts work on the server, and the assumption only says the documents of earlier lines stay inserted.

## Coverage

Status: verified (all runs exited 0 on the final snapshot).

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured (the configured tooling has no changed-line report).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: io-basic-backend; base 7906c6ca3aba897605b541415380aa044f49ec6f; HEAD e577190c905c650a1caa49729601060e5fed0ef3; commits 7ef0d1a, 3171c1e, 1c9214b, e4c771f, 29ddec4, 68b9042, e676611, e577190 (from the parent, checked with `git log 7906c6c..HEAD`). File list from `git diff --stat 7906c6c..HEAD`, without specs, tests, docs and reports.
- Source/test snapshot identifier (including uncommitted inputs): production files equal HEAD (`git status`: only the three spec files and `reviews/io-basic-backend/review.md` are modified). sha256 of the production files: `io/scanner.ts` 9c161b34…fbd5, `io/export.ts` b24c3569…e26c, `io/import.ts` c7c23f1a…a47a9, `io/handlers.ts` dabca036…1bde, `io/index.ts` 8caac045…a127, `server/backend.ts` aa8988d2…26b3, backend `src/index.ts` 1e5a1c5a…04e1. sha256 of the final specs: `scanner.spec.ts` ab9e18d1…4480, `import.spec.ts` c896ab06…32b6, `export.spec.ts` b685d859…c885. I hashed these before and after the coverage runs, and they were identical.
- Exact included files: backend `src/io/{scanner,export,import,handlers,index}.ts`, `src/server/backend.ts`, `src/index.ts`; desktop `src/dialogs/{handlers,index}.ts`, `src/main/handlers.ts`, `src/main/index.ts`; contract `src/backend.ts`, `src/io.ts`. No renames or deletions. Excluded: `docs/ARCHITECTURE.md` (documentation), the spec files, `test/integration/io.int.spec.ts` (a test) and `reviews/` (reports).
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with `@vitest/coverage-v8`. Backend: `npx vitest run --root /home/felix/work/thicket-agents/agent-1/packages/backend --coverage --coverage.include=src/io/scanner.ts --coverage.include=src/io/export.ts --coverage.include=src/io/import.ts --coverage.include=src/io/handlers.ts --coverage.include=src/io/index.ts --coverage.include=src/server/backend.ts --coverage.include=src/index.ts --coverage.reportsDirectory=coverage/io-basic-backend-pass3 --coverage.reporter=text --coverage.reporter=json-summary --coverage.reporter=json`. This ran the whole workspace suite (18 files, 828 tests, none deselected). Desktop: the same pattern with `--root .../apps/desktop` and `src/dialogs/handlers.ts`, `src/dialogs/index.ts`, `src/main/handlers.ts`, `src/main/index.ts` (13 files, 344 tests). Contract: `--root .../packages/contract` with `src/backend.ts`, `src/io.ts` (4 files, 720 tests).
- Run start/completion time and exit status: backend started 2026-11-17 01:39:22 and ran 17.3 s, exit 0. Desktop started 01:39:55 and ran 1.9 s, exit 0. Contract started 01:39:58 and ran 0.6 s, exit 0.
- Generated report paths and report hashes/run identifier: `packages/backend/coverage/io-basic-backend-pass3/coverage-summary.json` sha256 c96603de…109e, `coverage-final.json` ab596bb9…2e52; `apps/desktop/coverage/io-basic-backend-pass3/coverage-summary.json` 4a897d70…73bd; `packages/contract/coverage/io-basic-backend-pass3/coverage-summary.json` bcb9b32c…bb13 (`coverage/` is git-ignored).
- Evidence outputs are fresh and inputs stayed unchanged: `io-basic-backend-pass3` is a new report directory name that only these runs wrote. Source and spec hashes were the same before and after the runs.
- Final run after latest test additions and production fixes: yes. The CR-1/CR-2/FX-1 fixes are in HEAD e577190, and all three workspaces were measured after the last test edit.

Values below use covered/total (percentage); zero-denominator metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/io/scanner.ts` | 162/162 (100%) | 134/138 (97.1%) | 15/15 (100%) | 132/132 (100%) |
| `packages/backend/src/io/export.ts` | 114/119 (95.8%) | 61/67 (91.0%) | 18/20 (90.0%) | 94/94 (100%) |
| `packages/backend/src/io/import.ts` | 125/125 (100%) | 69/77 (89.6%) | 14/14 (100%) | 108/108 (100%) |
| `packages/backend/src/io/handlers.ts` | 53/53 (100%) | 20/20 (100%) | 15/15 (100%) | 47/47 (100%) |
| `packages/backend/src/io/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/backend/src/index.ts` | 1/1 (100%) | N/A | N/A | 1/1 (100%) |
| `packages/backend/src/server/backend.ts` | 30/32 (93.8%) | 9/10 (90.0%) | 10/12 (83.3%) | 28/28 (100%) |
| `apps/desktop/src/dialogs/handlers.ts` | 6/6 (100%) | 18/18 (100%) | 3/3 (100%) | 6/6 (100%) |
| `apps/desktop/src/dialogs/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `apps/desktop/src/main/handlers.ts` | 16/16 (100%) | 8/8 (100%) | 6/6 (100%) | 14/14 (100%) |
| `apps/desktop/src/main/index.ts` | 0/69 (0%) | 0/30 (0%) | 0/26 (0%) | 0/62 (0%) |
| `packages/contract/src/backend.ts` + `src/io.ts` | 9/9 (100%) | N/A | N/A | 9/9 (100%) |

Totals per workspace: backend 485/492 statements, 293/312 branches, 72/76 functions, 410/410 lines. Desktop 22/91, 26/56, 9/35, 20/82. Contract 9/9 statements, 9/9 lines.

Aggregate across all 13 scoped files (summed counters): statements 516/592 (87.2%), branches 319/368 (86.7%), functions 81/111 (73.0%), lines 439/501 (87.6%). Without the Electron entry `apps/desktop/src/main/index.ts`: statements 516/523 (98.7%), branches 319/338 (94.4%), functions 81/85 (95.3%), lines 439/439 (100%). Every scoped file appears in the reports, and every file was measured.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/backend/src/io/scanner.ts:98` (`this.parts ?? []` fallback), `:99` (`from >= 0` false in `close`), `:106` (empty text in `close`), `:199` (empty scalar at `end`) | CR-1 size check in `close` and the initial-state arms | The cap paths are now fully exercised: the new "one character over the limit, however it is cut" tests reach the `close` check with a size carried over from earlier chunks. The remaining arms cannot be reached: `from` is always `>= 0` while `parts` exists, and a value opens only at a non-space character. Not material. |
| `packages/backend/src/io/export.ts:61` (`destroyed` without `errored`), `:83` (`onClose` handler and its `??` arms), `:93` (`finish` on an already broken stream), `:120` (non-Error message), `:177` (`streamError` rethrow before `finish`), `:183` (`rm` failure catch) | Defensive paths for a stream closed without an error, or a removal that fails | Same as the earlier passes. Every real file error goes through `errored`, which the disk-full, missing-folder and drain-wait tests cover. Both arms of the new `closeStream` (`stream.closed` already true, or waiting for `close`) are covered. Forcing `rm` to fail would need mocking `node:fs/promises`. Not material. |
| `packages/backend/src/io/import.ts:47,65` (non-Error reason), `:152-153` (writeError without index/errmsg), `:193` (`errors[at-1]?.index ?? 0` fallback), `:218` (writeConcernError without errmsg), `:224,227` (`?? 0` fallbacks) | Defensive handling of malformed server replies, and a fallback that cannot be reached in the CR-2 sorted insert | Not material. `errors[at-1]` always exists while `at > 0`, and the server always sends these fields. The CR-2 sorted insert and the stop replacement are covered by the five CR-2 tests. |
| `packages/backend/src/server/backend.ts:33` (default `log`) and a window-port close callback | Not task code | Outside the task scope. |
| `apps/desktop/src/main/index.ts:48-207` (task lines: choosing the parent window for `nativeDialogs`) | Electron entry point, which needs a real Electron runtime | Cannot be unit tested without Electron. The handler logic it feeds is covered in `dialogs/handlers.spec.ts`. Needs an Electron/e2e check when an io UI exists. |

## Unable to test

- `apps/desktop/src/main/index.ts` `nativeDialogs` (parenting the dialog to the focused window, any window, or none): needs Electron. Follow-up: an Electron or e2e test when an io UI exists. Not required by this task's criteria.
- A real native dialog: not testable headless. Fakes stand in for it at both the main and backend boundaries.
- The disk-full export tests depend on `/dev/full` and are skipped where it does not exist. They ran here (Linux).
- The FX-1 tests mock `node:fs` `createWriteStream` with a gated `open`. They show the ordering of the fix and do not reproduce a real slow file system.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. I added 8 tests for the CR-1/CR-2/FX-1 fixes:
- the cap check when a value closes in a later chunk than where it started, for every cut and every value shape;
- the size reset for each value;
- CR-2 in unordered stop mode, and a stop from an earlier flushed batch;
- FX-1 for a JSON export with `[` buffered before the open.

All validation passed: unit `src/io` 154/154 (also 5 repeats), io integration 10/10, `npm run check` / `.taskcheck` pass.

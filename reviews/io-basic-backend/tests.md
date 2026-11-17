# Test Report

Date: 2026-11-17

Task: io-basic-backend - M1: Export and import JSON / JSON Lines

Scope: second pass on the final code. Base e0bf99087908fbf893e7b66445f51ef0f362c622 .. HEAD c7c85daf81e6bd1072ebe0b8e5e452558507d92b on branch main. The parent worker named the base and range. The task commits are 3cec5d5 (implementation), 5f33da4 (integration tests), 59fa1a7 (docs), 9c0feb5 (first test pass), 28efdba (fixes TW-1/TW-2/TW-3) and c7c85da (fixer regression tests), checked against `git log` and `git diff --stat e0bf990..HEAD`. The first-pass report named base c65dcfc. The task was rebased since then, and the changed file list is the same. This pass focuses on the fix commits (`git diff 9c0feb5..HEAD`: `packages/backend/src/io/{export,import,scanner}.ts`) and checks that every acceptance criterion is still tested. The only uncommitted inputs are the three spec files listed below. `reviews/io-basic-backend/review.md` is untracked and was written by another helper, not this one.

Requirements:
- `tasks/io-basic-backend.md` acceptance criteria and recorded assumptions
- `reviews/io-basic-backend/fixes.md` (TW-1, TW-2, TW-3 fix descriptions)
- `docs/ARCHITECTURE.md` "Import/export" bullet and "Coverage" section
- Parent instructions for this pass

## Test files changed

- `packages/backend/src/io/export.spec.ts`
- `packages/backend/src/io/import.spec.ts`
- `packages/backend/src/io/scanner.spec.ts`

## Tests added or updated

Count: 11 added in this pass. No existing test was changed, weakened or skipped.

- export (2): `rejects INTERNAL when a write fails while waiting for the buffer to drain (disk full)` (the back-pressure wait of `write()` must end on a stream error; `/dev/full`), `rejects INTERNAL for an empty JSON export when the bracket cannot be written (disk full)`
- scanner (3): `returns the array documents before text after the closing ], then throws it at the end`, `returns the documents completed before a stray bracket, then throws on the next call` (mongoexport sequence), `a broken point with no value completed in its chunk throws at once`
- import (6): `a broken structure (documents one after another with a stray }) ...` and `(text after the closing ]) inserts the documents before it, then rejects`, `a broken structure in a later read chunk inserts every document before it` (30 000 docs, more than one 256 KiB chunk), `continue mode: a refused insert in the last batch before a broken structure is reported`, `a failing final insert after a broken structure rejects with the server error`, preview `a broken structure after the sample is complete still gives the sample`

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: export 10 000 docs and import into a new collection gives identical documents (canonical) | int `exports 10 000 documents as jsonl (canonical) and imports them unchanged`, `... as json (canonical) ...`. Unit tests: `writes one JSON array in canonical EJSON that parses back to the same documents`, `parses canonical and relaxed EJSON into exact BSON types`, `inserts every document in order with exact types and reports totals` | `npx vitest run --config test/integration/vitest.config.ts io.int` (repo root, Podman containers); `cd packages/backend && npx vitest run src/io` | Pass (int 10/10; unit 131/131) |
| AC2: import with a bad line, continue mode reports the line number and imports the rest | int `continue mode reports the bad lines and imports the rest (JSON Lines)`, `continue mode in a JSON array reports the line of the bad element`. Unit tests: `skips bad lines, reports their line numbers and imports the rest`, `ordered: resubmits the rest of the batch after a refused document`, `unordered: sends the batch once; every refused document is reported`, `keeps only the first 100 errors but counts all` | same | Pass |
| AC3: memory stays bounded, export streams (200 000 docs) | int `streams 200 000 documents to the file without buffering them`. Unit tests: `waits for the file stream to drain when a batch exceeds its buffer (back pressure)`, `writes JSON Lines in relaxed EJSON by default, reading every batch` | same | Pass |
| Fix TW-1: export fails (INTERNAL, file named) when the file cannot be created | `rejects INTERNAL naming the file when it cannot be created (server answers at once)`, `rejects INTERNAL for an empty jsonl/json export when the file cannot be created` | `cd packages/backend && npx vitest run src/io` | Pass |
| Fix TW-2: export ends (no hang) and kills the cursor when the stream already failed or fails while writing | `rejects INTERNAL when the file cannot be created and the server answers after the open failed`, `rejects INTERNAL and kills the cursor when a write fails between batches (disk full)`, new `... while waiting for the buffer to drain (disk full)`, new `... empty JSON export when the bracket cannot be written (disk full)` | same | Pass (`/dev/full` exists here, 0 skipped) |
| Fix TW-3: a broken structure inserts the documents read before it, sends a last progress event, then rejects INVALID_PARAMS naming the line; an earlier stop wins | `a broken JSON structure (continue mode / stop mode) ...`, `a broken structure after a full batch keeps ...`, `continue mode: a broken structure after a bad element ...`, `a stop before the broken structure wins`, `a cancel while reading does not write ...`. New in this pass: sequence/trailing-text variants, later read chunk, write error before the broken point, failing final insert | same | Pass |
| Fix TW-3 (scanner): values completed before a broken point are returned; the error follows on the next call | `returns the values completed before a broken point, then throws on the next call` and the three new scanner tests | same | Pass |
| Assumption: stop mode keeps earlier lines and ends with the failure's error | `inserts the lines before a bad line, then rejects with its error`, `stops at a refused insert (ordered) ...`, `a refused insert in a full batch stops reading the file`, `... flushed by size stops before the next document`, `a bad element in a JSON array stops at its line`; int `stop mode ends with the first bad line and keeps the lines before it` | unit and int commands above | Pass |
| Assumption: failed or cancelled export deletes the partial file | `removes the partial file and rejects with the server error when a getMore fails`, `a cancel stops the export, kills the server operation and removes the file`, disk-full tests (`readdir` empty) | `cd packages/backend && npx vitest run src/io` | Pass |
| Assumption: preview skips values that do not parse | `returns the size and the first documents as canonical EJSON, skipping bad values`, new `a broken structure after the sample is complete still gives the sample` | same | Pass |
| Dialogs, routing, write guard, UNSUPPORTED formats (unchanged since the first pass) | `src/io/handlers.spec.ts`, `src/server/backend.spec.ts`, `apps/desktop/src/dialogs/handlers.spec.ts`, `apps/desktop/src/main/handlers.spec.ts`; int `a cancelled save dialog answers streamId null`, `a read-only profile cannot import` | `npm run check` (root vitest projects) and int command | Pass |

## Focused test execution

Command:

`cd packages/backend && npx vitest run src/io`, then `npx vitest run src/io --repeats 4`

Result:

Pass: 4 files, 131 tests, 0 skipped (also with `--repeats 4`).

## Full test execution

Command:

`npx vitest run --config test/integration/vitest.config.ts io.int` (repo root, Podman containers); `sh .taskcheck` (= `npm run check`: eslint, prettier, typecheck, root `vitest run`, renderer `ng test`)

Result:

Pass: io integration 10/10 (2026-11-17 01:19:06). Root vitest 53 files, 3137 tests passed. Renderer 60 files, 1455 tests passed.

## .taskcheck

Result:

Pass on the second run. The first run failed only at `prettier --check` on my new `scanner.spec.ts` code. I fixed it with `npx prettier --write` on the three spec files (formatting only), and the rerun passed.

## Bugs found

None in this pass. The first-pass findings TW-1 and TW-2 are fixed: their tests and the new tests for the remaining error paths pass. TW-3 (broken structure dropping the pending batch) was resolved as the fixer describes, and its behavior is now asserted.

Observation, not a defect (no requirement covers it): the JSON scanner accepts a trailing comma before the closing bracket (`[{"a":1},]` imports one document). This is more lenient than strict JSON but loses no data. I did not add a test that asserts either behavior.

## Coverage

Status: verified (all runs exited 0 on the final snapshot).

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured (the configured tooling has no changed-line report).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: io-basic-backend; base e0bf99087908fbf893e7b66445f51ef0f362c622; HEAD c7c85daf81e6bd1072ebe0b8e5e452558507d92b; commits 3cec5d5, 5f33da4, 59fa1a7, 9c0feb5, 28efdba, c7c85da (from the parent, checked with `git log e0bf990..HEAD`); file list from `git diff --stat e0bf990..HEAD` without specs, tests and docs.
- Source/test snapshot identifier (including uncommitted inputs): production files equal HEAD (`git status` shows only the three spec files modified). sha256 of production files: `io/export.ts` 2087f6ed…6338, `io/import.ts` 46601c83…de6b, `io/scanner.ts` eb06187c…92bf, `io/handlers.ts` dabca036…1bde, `io/index.ts` 8caac045…127, `server/backend.ts` aa8988d2…b3. sha256 of the final specs: `export.spec.ts` c8de9629…a157, `import.spec.ts` 86f836fe…70e1, `scanner.spec.ts` 8070ece1…180e (after Prettier).
- Exact included files: backend `src/io/{scanner,export,import,handlers,index}.ts`, `src/server/backend.ts`, `src/index.ts`; desktop `src/dialogs/{handlers,index}.ts`, `src/main/handlers.ts`, `src/main/index.ts`; contract `src/backend.ts`, `src/io.ts`. No renames or deletions. Excluded: `docs/ARCHITECTURE.md` (documentation), spec files, `test/integration/io.int.spec.ts` (a test), `reviews/` (reports).
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with `@vitest/coverage-v8`. Backend (cwd `packages/backend`): `npx vitest run --coverage --coverage.include='src/io/scanner.ts' --coverage.include='src/io/export.ts' --coverage.include='src/io/import.ts' --coverage.include='src/io/handlers.ts' --coverage.include='src/io/index.ts' --coverage.include='src/server/backend.ts' --coverage.include='src/index.ts' --coverage.reportsDirectory=coverage/io-basic-backend-final --coverage.reporter=text --coverage.reporter=json-summary --coverage.reporter=json`, whole workspace suite (18 files, 805 tests, none deselected). Desktop (cwd `apps/desktop`): same pattern with `src/dialogs/handlers.ts`, `src/dialogs/index.ts`, `src/main/handlers.ts`, `src/main/index.ts` (13 files, 344 tests). Contract (cwd `packages/contract`): `src/backend.ts`, `src/io.ts` (4 files, 720 tests).
- Run start/completion time and exit status: backend final run started 2026-11-17 01:21:12 and ran 3.47 s, exit 0 (an identical run at 01:19:30 before Prettier gave the same report hash). Desktop started 01:19:45 and ran 1.60 s, exit 0. Contract started 01:19:47 and ran 0.40 s, exit 0.
- Generated report paths and report hashes/run identifier: `packages/backend/coverage/io-basic-backend-final/coverage-summary.json` sha256 f539b421…aa76, `coverage-final.json` f17e3025…e8095; `apps/desktop/coverage/io-basic-backend-final/coverage-summary.json`; `packages/contract/coverage/io-basic-backend-final/coverage-summary.json` (git-ignored `coverage/`).
- Evidence outputs are fresh and inputs stayed unchanged: `io-basic-backend-final` is a new report directory name, written by these runs. No production file changed during or after the runs. The only test change after the first backend run was Prettier formatting of `scanner.spec.ts`, and the backend was measured again after it.
- Final run after latest test additions and production fixes: yes. The fixes (28efdba, c7c85da) are in HEAD, and the backend was measured after the last test edit. Desktop and contract production files did not change in the fix commits.

Values below use covered/total (percentage); zero-denominator metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/io/scanner.ts` | 133/133 (100%) | 116/120 (96.7%) | 11/11 (100%) | 106/106 (100%) |
| `packages/backend/src/io/export.ts` | 107/112 (95.5%) | 59/65 (90.8%) | 15/17 (88.2%) | 88/88 (100%) |
| `packages/backend/src/io/import.ts` | 118/118 (100%) | 62/69 (89.9%) | 14/14 (100%) | 101/101 (100%) |
| `packages/backend/src/io/handlers.ts` | 53/53 (100%) | 20/20 (100%) | 15/15 (100%) | 47/47 (100%) |
| `packages/backend/src/io/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/backend/src/index.ts` | 1/1 (100%) | N/A | N/A | 1/1 (100%) |
| `packages/backend/src/server/backend.ts` | 30/32 (93.8%) | 9/10 (90%) | 10/12 (83.3%) | 28/28 (100%) |
| `apps/desktop/src/dialogs/handlers.ts` | 6/6 (100%) | 18/18 (100%) | 3/3 (100%) | 6/6 (100%) |
| `apps/desktop/src/dialogs/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `apps/desktop/src/main/handlers.ts` | 16/16 (100%) | 8/8 (100%) | 6/6 (100%) | 14/14 (100%) |
| `apps/desktop/src/main/index.ts` | 0/69 (0%) | 0/30 (0%) | 0/26 (0%) | 0/62 (0%) |
| `packages/contract/src/backend.ts` + `src/io.ts` | 9/9 (100%) | N/A | N/A | 9/9 (100%) |

Totals per workspace: backend 442/449 statements, 266/284 branches, 65/69 functions, 371/371 lines. Desktop 22/91, 26/56, 9/35, 20/82. Contract 9/9 statements, 9/9 lines.

Aggregate across all 13 scoped files (summed counters): statements 473/549 (86.2%), branches 292/340 (85.9%), functions 74/104 (71.2%), lines 400/462 (86.6%). Without the Electron entry `apps/desktop/src/main/index.ts`: statements 473/480 (98.5%), branches 292/310 (94.2%), functions 74/78 (94.9%), lines 400/400 (100%). No scoped file is missing from the reports, and no file is unmeasured.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/backend/src/io/export.ts:61` (`destroyed` without `errored`), `:83` (`onClose` handler and its `??` arms), `:93` (`finish` on an already broken stream), `:162` (`streamError` rethrow before `finish`) | Defensive paths for a stream that was closed without an error, or that failed between the last write and `end` | Not reachable through the public API: only `exportToFile` owns the stream, and every real file error goes through `errored` (now covered by the disk-full, missing-folder and drain-wait tests). `finish`'s `end` callback catches the remaining case. No test added. |
| `packages/backend/src/io/export.ts:105` (non-Error message), `:168` (`rm` failure catch) | A non-Error thrown value; failure to remove the partial file | Defensive. Forcing `rm` to fail would need mocking `node:fs/promises`, which the project's tests don't do. Not material. |
| `packages/backend/src/io/import.ts:47,65` (non-Error reason), `:152-153` (writeError without index/errmsg), `:203` (writeConcernError without errmsg), `:209,212` (`?? 0` fallbacks) | Defensive handling of malformed server replies | Not material: the server always sends these fields. No test added. |
| `packages/backend/src/io/scanner.ts:75-78` (`close` with `from < 0` / no `parts`), `:166` (empty scalar text at `end`) | Equivalent initial-state arms | Covered behaviorally by the split-at-every-position tests. The remaining arms cannot produce different output. Not material. |
| `packages/backend/src/server/backend.ts:33` (default `log`) and a window-port close callback | Not task code | Outside task scope. |
| `apps/desktop/src/main/index.ts:48-207` (task lines: `nativeDialogs` parent window selection) | Electron entry point, which needs a real Electron runtime | Cannot be unit tested without Electron. The handler logic it feeds is covered in `dialogs/handlers.spec.ts`. Needs an Electron/e2e check when an io UI exists. |

## Unable to test

- `apps/desktop/src/main/index.ts` `nativeDialogs` (parenting to the focused window, any window, or none): needs Electron. Follow-up: an Electron or e2e test when an io UI exists. Not required by this task's criteria.
- A real native dialog: not testable headless. Fakes stand in for it at both the main and backend boundaries.
- The disk-full export tests depend on `/dev/full` and are skipped where it does not exist. They ran here (Linux).

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. 11 tests were added for the fix paths (drain-wait write errors, every kind of broken structure, a break in a later read chunk, a broken structure combined with write errors). All validation passed: unit 131/131, io integration 10/10, `.taskcheck` pass.

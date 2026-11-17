# Test Report

Date: 2026-11-17

Task: io-basic-backend - M1: Export and import JSON / JSON Lines

Scope: base c65dcfc66e53b4f8dc3bfc072521982fc0eef08c .. HEAD cf360e67f54bdba497a0d525d0b84a7b348277bc on branch main (task commits 16ae610, 57a6a62, cf360e6, given by the parent worker and checked against `git log`/`git diff c65dcfc..HEAD`). No uncommitted production changes; uncommitted inputs are only the test files listed below.

Requirements:
- `tasks/io-basic-backend.md` acceptance criteria and recorded assumptions
- `SPEC.md` / `docs/ARCHITECTURE.md` "Import/export" bullet and "Coverage" section
- Parent instructions (unit specs for scanners, parseImportedDocument, exportCommand, handlers, dialogHandlers, privilegedHandlers wiring)

## Test files changed

- `packages/backend/src/io/scanner.spec.ts` (new)
- `packages/backend/src/io/export.spec.ts` (new)
- `packages/backend/src/io/import.spec.ts` (new)
- `packages/backend/src/io/handlers.spec.ts` (new)
- `packages/backend/src/server/backend.spec.ts` (one test added)
- `apps/desktop/src/dialogs/handlers.spec.ts` (new)
- `apps/desktop/src/main/handlers.spec.ts` (one describe with three tests added)

## Tests added or updated

Count: 127 (scanner 30, export 20, import 37, io handlers 24, desktop dialogs 12, privileged wiring 3, startBackend wiring 1). No existing test was changed, weakened or skipped.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: export 10 000 docs and import into a new collection gives identical documents (canonical) | existing int `exports 10 000 documents as jsonl/json (canonical) and imports them unchanged`; unit `writes one JSON array in canonical EJSON that parses back to the same documents`, `parses canonical and relaxed EJSON into exact BSON types`, `inserts every document in order with exact types`, `splits an exported array into its documents ...` | `npx vitest run --config test/integration/vitest.config.ts io.int`; `cd packages/backend && npx vitest run src/io` | Pass (int 10/10; unit pass) |
| AC2: bad line, continue mode reports the line number and imports the rest | existing int `continue mode reports the bad lines ...` (JSONL and JSON array); unit `skips bad lines, reports their line numbers and imports the rest`, `ordered: resubmits the rest of the batch after a refused document`, `unordered: sends the batch once ...`, `keeps only the first 100 errors but counts all`, scanner line-number tests | same as above | Pass |
| AC3: memory bounded, export streams (200 000 docs) | existing int `streams 200 000 documents to the file without buffering them`; unit `waits for the file stream to drain when a batch exceeds its buffer (back pressure)`, `writes JSON Lines ... reading every batch` (getMore batchSize) | same as above | Pass |
| Assumption: stop mode keeps earlier lines and ends with the failure's error | `inserts the lines before a bad line, then rejects with its error`, `stops at a refused insert (ordered)`, `a refused insert in a full batch stops reading the file`, `a refused insert in a batch flushed by size stops before the next document` | `cd packages/backend && npx vitest run src/io` | Pass |
| Assumption: failed or cancelled export deletes the partial file | `removes the partial file and rejects with the server error when a getMore fails`, `a cancel stops the export, kills the server operation and removes the file` | same | Pass |
| Export to a file that cannot be written fails with an error (not success, not a hang) | `rejects INTERNAL naming the file when it cannot be created (server answers at once)`, `rejects INTERNAL when the file cannot be created and the server answers after the open failed` | same | Fail (TW-1, TW-2) |
| Dialogs: cancelled dialog answers `streamId: null` / `null`; renderer only gets an opaque token | handlers spec `a cancelled save dialog ...`, `a cancelled open dialog answers null`, `previews the chosen file and hands out an opaque token, not the path`, `answers NOT_FOUND for an unknown token`, `forgets the oldest token after 100 newer ones` | `cd packages/backend && npx vitest run src/io/handlers.spec.ts` | Pass |
| CSV/BSON answer UNSUPPORTED; csvMapping refused | `answers UNSUPPORTED for csv/bson without a dialog`, `previewImport answers UNSUPPORTED for csv/bson`, `refuses a csvMapping for a JSON file`, export `refuses csv/bson with UNSUPPORTED and creates no file` | same | Pass |
| Privileged `dialog.saveFile`/`dialog.openFile` in main; only on the privileged port | `apps/desktop/src/dialogs/handlers.spec.ts` (all), `the privileged port with native dialogs` (3 tests) | `cd apps/desktop && npx vitest run src/dialogs src/main/handlers.spec.ts` | Pass |
| io.* routed to backend; backend asks main for the dialog; io.import behind the write guard; io.export unguarded | `io.* asks main for the file dialog over the privileged port; io.import is guarded` | `cd packages/backend && npx vitest run src/server/backend.spec.ts` | Pass |

## Focused test execution

Command:

`cd packages/backend && npx vitest run src/io src/server/backend.spec.ts` and `cd apps/desktop && npx vitest run src/dialogs src/main/handlers.spec.ts`

Result:

Fail: backend 144 passed, 2 failed (TW-1, TW-2, both in `export.spec.ts`); desktop 32 passed.

## Full test execution

Command:

`npm run check` (lint, typecheck, `vitest run`, renderer tests); `npm run test -w packages/renderer` separately (the `&&` chain stops before it); `npx vitest run --config test/integration/vitest.config.ts io.int`

Result:

Fail: lint and typecheck pass; root `vitest run` 3115 passed, 2 failed (TW-1, TW-2). Renderer 1455/1455 passed. io integration 10/10 passed (Podman containers).

## .taskcheck

Result:

Fail: `.taskcheck` runs `npm run check`, which fails only on the two TW-1/TW-2 tests until production is fixed.

## Bugs found

### Export reports success but writes no file when the file cannot be created

Finding ID:

`TW-1`

Test:

`exportToFile > rejects INTERNAL naming the file when it cannot be created (server answers at once)` in `packages/backend/src/io/export.spec.ts`

Production source:

`packages/backend/src/io/export.ts:74-79` (`finish`), also `:141`

Requirement:

Export streams to the chosen file; a failed export must fail (and remove the partial file), per task assumption and ARCHITECTURE "a failed or cancelled export removes the file".

Expected behavior:

When the file stream errors (e.g. missing folder, no permission, read-only file chosen in the save dialog), `exportToFile` rejects with `INTERNAL` "Could not write" followed by the file path and the reason and the stream ends with an error event.

Actual behavior:

It resolves with the number of documents (1), so the stream would end with `delivered: 1`, but no file exists. Cause: the open error arrives after the first `write()` was buffered; `stream.end(cb)` calls `cb(err)` and `finish` resolves while ignoring that argument, before the `error` listener can reject.

Severity:

High

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.`

### Export hangs forever when the file stream fails before the first batch is written

Finding ID:

`TW-2`

Test:

`exportToFile > rejects INTERNAL when the file cannot be created and the server answers after the open failed` in `packages/backend/src/io/export.spec.ts`

Production source:

`packages/backend/src/io/export.ts:58-72` (`write`)

Requirement:

Same as TW-1. A stream must end with `end` or `error`.

Expected behavior:

Rejects with `INTERNAL` naming the file; the partial file is removed.

Actual behavior:

The promise never settles (the test reports "still running after 2 s"). When the open error arrives before the first write (the usual case with a real server's latency), the stream is already destroyed. `stream.write()` then returns false without emitting `error` or `drain`, so `write()` waits forever. The export stream never ends, and the cursor and operation stay open. The same applies to a write error (e.g. disk full) that destroys the stream between batches. A fix that checks `streamError`/`stream.destroyed` before writing, and that uses the error argument of `write`/`end` callbacks, would address TW-1 and TW-2.

Severity:

High

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.`

### Observation (not a failing test, needs a decision): broken JSON structure drops the pending batch

`packages/backend/src/io/import.ts:226-249`: a `ScanError`, such as `[{"_id":1},\n{"_id":2}` with no closing `]`, is thrown inside the `for await` loop. That skips the final `flush()`. The documents read before it in the current batch (up to 999) are not inserted, but earlier full batches are, and no final progress event is sent. The import still ends with `INVALID_PARAMS`, as documented ("A broken file structure always stops the import"). The spec does not say whether earlier lines should be inserted in this case, so no test asserts either way. The parent should decide whether this should match the stop-mode rule "documents of earlier lines stay inserted, after a last progress event".

## Coverage

Status: verified for the passing selection. The two TW-1/TW-2 tests were deselected because Vitest writes no coverage report when a test fails. That run exited 0. A full run with them selected exits 1 and writes no report.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured (the configured tooling has no changed-line report).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: io-basic-backend; base c65dcfc66e53b4f8dc3bfc072521982fc0eef08c; HEAD cf360e67f54bdba497a0d525d0b84a7b348277bc; commits 16ae610, 57a6a62, cf360e6 from the parent worker; file list from `git diff --name-only c65dcfc..HEAD -- '*.ts'` without specs.
- Source/test snapshot identifier (including uncommitted inputs): production files unchanged from HEAD (`git diff --stat` shows only spec files). Test sha256: export.spec f344f4a7..., handlers.spec c093f402..., import.spec e8203e79..., scanner.spec c818e3a3..., server/backend.spec 28ef7813..., desktop dialogs/handlers.spec 86fd5abf..., desktop main/handlers.spec 4f1471cf...
- Exact included files: backend `src/io/{scanner,export,import,handlers,index}.ts`, `src/server/backend.ts`, `src/index.ts`; desktop `src/dialogs/{handlers,index}.ts`, `src/main/handlers.ts`, `src/main/index.ts`; contract `src/backend.ts`, `src/io.ts`. No renames or deletions. Excluded: `docs/ARCHITECTURE.md` (documentation), spec files, and `test/integration/io.int.spec.ts` (a test).
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with `@vitest/coverage-v8`, Node 24.22.1. Backend (cwd `packages/backend`): `npx vitest run -t '^(?!.*cannot be created).*$' --coverage --coverage.include='src/io/scanner.ts' --coverage.include='src/io/export.ts' --coverage.include='src/io/import.ts' --coverage.include='src/io/handlers.ts' --coverage.include='src/io/index.ts' --coverage.include='src/server/backend.ts' --coverage.include='src/index.ts' --coverage.reportsDirectory=coverage/io-basic-backend --coverage.reporter=text --coverage.reporter=json-summary --coverage.reporter=json`, whole workspace suite minus the 2 TW tests (783 passed, 2 skipped). Desktop (cwd `apps/desktop`): `npx vitest run --coverage --coverage.include='src/dialogs/handlers.ts' --coverage.include='src/dialogs/index.ts' --coverage.include='src/main/handlers.ts' --coverage.include='src/main/index.ts' --coverage.reportsDirectory=coverage/io-basic-backend` with the text, json-summary and json reporters, full workspace suite (344 passed). Contract (cwd `packages/contract`): same with `src/backend.ts`, `src/io.ts` (720 passed).
- Run start/completion time and exit status: backend 2026-11-17T01:06:09+01:00 to 01:06:12, exit 0; desktop 01:05:51 to 01:05:53, exit 0; contract 01:06:01, exit 0.
- Generated report paths and report hashes/run identifier: `packages/backend/coverage/io-basic-backend/coverage-summary.json` sha256 b45e0255...53ce9, `coverage-final.json` 4b96673d...2f3f2; `apps/desktop/coverage/io-basic-backend/coverage-summary.json` 4a897d70...73bd; `packages/contract/coverage/io-basic-backend/coverage-summary.json` (9/9 statements).
- Evidence outputs are fresh and inputs stayed unchanged: the backend report directory did not exist before the first run, and every run regenerated it. No test or production file changed after the final backend run.
- Final run after latest test additions and production fixes: yes for test additions; no production fixes have been made yet. After the fixer changes `export.ts`, coverage is stale and must be measured again.

Values below use covered/total (percentage); zero-denominator metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/io/scanner.ts` | 124/124 (100%) | 108/112 (96.4%) | 10/10 (100%) | 100/100 (100%) |
| `packages/backend/src/io/export.ts` | 85/91 (93.4%) | 45/49 (91.8%) | 11/14 (78.6%) | 72/75 (96.0%) |
| `packages/backend/src/io/import.ts` | 111/111 (100%) | 58/65 (89.2%) | 13/13 (100%) | 95/95 (100%) |
| `packages/backend/src/io/handlers.ts` | 53/53 (100%) | 20/20 (100%) | 15/15 (100%) | 47/47 (100%) |
| `packages/backend/src/io/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/backend/src/index.ts` | 1/1 (100%) | N/A | N/A | 1/1 (100%) |
| `packages/backend/src/server/backend.ts` | 30/32 (93.8%) | 9/10 (90%) | 10/12 (83.3%) | 28/28 (100%) |
| `apps/desktop/src/dialogs/handlers.ts` | 6/6 (100%) | 18/18 (100%) | 3/3 (100%) | 6/6 (100%) |
| `apps/desktop/src/dialogs/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `apps/desktop/src/main/handlers.ts` | 16/16 (100%) | 8/8 (100%) | 6/6 (100%) | 14/14 (100%) |
| `apps/desktop/src/main/index.ts` | 0/69 (0%) | 0/30 (0%) | 0/26 (0%) | 0/62 (0%) |
| `packages/contract/src/backend.ts` + `src/io.ts` | 9/9 (100%) | N/A | N/A | 9/9 (100%) |

Aggregate across these 13 measured files (summed counters, three workspaces): statements 435/512 (85.0%), branches 266/312 (85.3%), functions 68/99 (68.7%), lines 372/437 (85.1%). Without the Electron entry `apps/desktop/src/main/index.ts`: statements 435/443 (98.2%), branches 266/282 (94.3%), functions 68/73 (93.2%), lines 372/375 (99.2%). No scoped file is missing from the reports.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/backend/src/io/export.ts:66` (drain error), `:116` (stream error listener), `:141` (`streamError` rethrow), `:147` (rm catch), `:83-84` (non-Error message) | File write errors | Exercised only by the deselected TW-1/TW-2 tests, which show these paths are broken. Re-measure after the fix. |
| `packages/backend/src/io/import.ts:47,65` (non-Error reason), `:152-153` (writeError without index/errmsg), `:202` (writeConcernError without errmsg), `:208,211` (`?? 0` fallbacks) | Defensive handling of malformed server replies | Not material: the server always sends these fields. No test added. |
| `packages/backend/src/io/scanner.ts:57-60`, `:148` | Initial state branches of `feed` (value carried in from a previous chunk with an empty `parts`) and the first-line BOM conditional | Covered behaviorally by the split-at-every-position tests. The remaining branch arms are equivalent cases. Not material. |
| `packages/backend/src/server/backend.ts:33,80` | Pre-existing default `log` and the window-port close callback (not task code) | Outside task scope. The task's line 62 (dialogs over the link) is now covered. |
| `apps/desktop/src/main/index.ts:48-207` (task lines 111-121, 134-138: `nativeDialogs` parent window selection) | Electron entry point, which needs a real Electron runtime | Cannot be unit tested without Electron. The handler logic it feeds is covered in `dialogs/handlers.spec.ts`. Needs an Electron/e2e check. |

## Unable to test

- `apps/desktop/src/main/index.ts` `nativeDialogs` (parenting to the focused window, or any window, or none): needs Electron. Follow-up: an Electron or e2e test when an io UI exists. Not required by this task's criteria.
- A real native dialog: not testable headless. Fakes stand in for it at both the main and backend boundaries.

## Summary

Tests added; production defects were discovered and must be passed to the `fixer` before task completion (TW-1, TW-2 in `packages/backend/src/io/export.ts`). One behavioral ambiguity (ScanError drops the pending batch) needs a decision from the parent.

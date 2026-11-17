# Test Report

Date: 2026-11-17

Task: gridfs - M6 (Could): GridFS

Scope: task commits c10fccd45875c380422f1ada78c7e16442ff14c4..08632b7dba48f58ad1d739b8909427577bec2418 (8876ccb6 contract, 3dfa194e backend + int tests, 95911f20 renderer tab + e2e + docs, 08632b7d format), on branch `main`, plus the uncommitted test files listed below. No production code was changed by the test-writer.

Requirements:
- `tasks/gridfs.md` acceptance criteria (1) integration test: upload 20 MB file, download identical (hash); (2) e2e: upload and delete from the UI
- `tasks/gridfs.md` recorded assumptions (fs default bucket, one tab per database, upload is a guarded write, delete always confirms, cancelled upload/download cleans up)
- `SPEC.md` line 196 (GridFS "Could") and line 131 (production: confirm dialog for every write showing the operation)
- `docs/ARCHITECTURE.md` "GridFS" and "Coverage" sections
- Parent instructions (unit specs for backend helpers/handlers, renderer model/view, describeWrite, sidebar)

## Test files changed

- `packages/backend/src/gridfs/gridfs.spec.ts` (new)
- `packages/backend/src/gridfs/handlers.spec.ts` (new)
- `packages/renderer/src/app/gridfs/gridfs.model.spec.ts` (new)
- `packages/renderer/src/app/gridfs/gridfs-view.spec.ts` (new)
- `packages/renderer/src/app/safety/operation.spec.ts` (extended)
- `packages/renderer/src/app/sidebar/sidebar-tree.service.spec.ts` (extended)
- `packages/renderer/src/app/sidebar/sidebar-tree.spec.ts` (extended; one existing read-only test gained an assertion)
- `packages/renderer/src/app/app.spec.ts` (extended)
- `test/integration/gridfs.int.spec.ts` (extended)

## Tests added or updated

Count: 110 added, 1 updated

- backend `gridfs.spec.ts` (24): escapeRegex (metacharacters, literal matching), parseFileId (ObjectId, string, Int32, invalid EJSON as INVALID_PARAMS), toGridfsFile (full document, non-ObjectId ids, Long/Double/number/bigint sizes, missing/negative/NaN/infinite sizes as 0, minimal document, invalid uploadDate, BSON symbol filename, contentType precedence top level then metadata, non-document metadata ignored, contract schema validity), driverDb (fake client INTERNAL, MongoClient Db), every operation INTERNAL on a fake client; cancelled download (CANCELLED, no progress, no local file), failed download removes the file, cancelled upload, cancelled file list, error mapping of list/info/delete (real driver Db against an unreachable 127.0.0.1:1, fast failure).
- backend `handlers.spec.ts` (17): suggestedName (plain, folders with / and \, fallbacks to "download"), exact method set, NOT_CONNECTED before any dialog for all 5 methods, INTERNAL without a driver Db, CANCELLED request, download/upload need a streaming server, invalid id INVALID_PARAMS before dialog, download looks the file up before the save dialog, upload: cancelled dialog nulls and no stream, stream named after the chosen file with its size, explicit filename, unreadable file INTERNAL "Could not read", producer failure sends no progress; delete invalid id.
- renderer `gridfs.model.spec.ts` (11): gridfsTabId, formatBytes boundaries (1023/1024, decimals below 10, TB cap, negative), fraction clamping and empty file, bucketCall escaping, formatDate (local, padding, empty, unparseable).
- renderer `gridfs-view.spec.ts` (46): listing (buckets then files, mongosh call, rows/cells, counts "1 file"/"Newest n of total"), bucket select, filter (trimmed, empty filter omits nameContains, empty-state texts), Refresh keeps/falls back bucket, default "fs" with no buckets, loading text, tab without target, same/different tab target; load errors (buckets, files, recovery, CANCELLED silent); ordering (older files answer arriving last, older failure arriving last, older bucket answer arriving last); upload (bucket param, no confirm on normal profile, progress bar/aria/bytes, completion message and reload, cancelled dialog, Cancel tells backend and ignores late events, mid-stream failure, failed request, double click while pending), production upload confirm (cancel sends nothing, confirm sends confirmed), production upload title; download (id param, progress, saved-path message, no reload, cancelled dialog, Cancel, NOT_FOUND, allowed read-only, closing the tab cancels the stream, one transfer at a time); delete (always confirms with label/detail/operation/namespace, cancel sends nothing, destructive flag, title, confirmed + reload, already gone, server error, second delete ignored); read-only (upload/delete disabled with hint, direct calls refused before sending).
- `operation.spec.ts` (3): describeWrite for gridfs.upload (placeholder vs explicit filename with escaping), gridfs.delete (ObjectId, string, Int32 ids), escaping of db and bucket names.
- `sidebar-tree.service.spec.ts` (3): openGridfs tab shape with production flag, select-existing / per-database tabs, unknown profile fallback.
- `sidebar-tree.spec.ts` (1 added, 1 updated): "GridFS files" menu item opens the gridfs tab; read-only profile keeps `menu-gridfs` enabled.
- `app.spec.ts` (1): `gridfs` tab kind is registered to GridfsView.
- `gridfs.int.spec.ts` (4): cancelled download ends CANCELLED and removes the partial local file (40 MB file, stored file untouched); empty-file round trip (no chunks, final progress 0/0, empty local file); download into a missing folder fails as INTERNAL "Could not write" and leaves no file; contract rejects limit 1001 and a bucket with "$".

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: upload 20 MB file, download identical (hash) | `uploads a 20 MB file with progress and downloads it byte for byte (SHA-256)` (existing) | `npm run test:int -- gridfs` | Pass (11 passed) |
| AC2: e2e upload and delete from the UI | `upload a file into GridFS from the UI, download it, and delete it` (existing) | `npm run test:e2e -- gridfs` (renderer + desktop build, Playwright, headless) | Pass (1 passed) |
| Cancelled upload leaves no chunks/files doc (assumption) | `a cancelled upload leaves no files document and no chunks behind` (existing) | `npm run test:int -- gridfs` | Pass |
| Cancelled download removes the partial local file (assumption) | `a cancelled download ends CANCELLED and removes the partial local file` (int); `a cancelled download is CANCELLED...`, `a failed download removes the file it started to write` (unit) | `npm run test:int -- gridfs`; `npx vitest run packages/backend/src/gridfs` | Pass |
| Upload is a guarded write; read-only refused before dialog | int `refuses uploads and deletes on read-only profiles, before any dialog` (existing); view `read-only profile` tests | `npm run test:int -- gridfs`; `npx ng test --include='src/app/gridfs/**/*.spec.ts'` | Pass |
| Upload confirm only on production profiles | `asks before an upload on a production profile; cancel sends nothing`, `sends gridfs.upload for the chosen bucket without confirming on a normal profile` | `npx ng test --include='src/app/gridfs/**/*.spec.ts'` | Pass |
| Delete always asks for confirmation | `always asks first, describing the file; cancel sends nothing`, `sends gridfs.delete with confirmed after the user confirms, then reloads` | same | Pass |
| Delete confirm is marked destructive (Cancel focused) | `marks the delete as destructive, so Enter does not confirm it by accident` | same | Fail (TW-1) |
| Confirm dialogs titled in words (SPEC line 131 confirm dialog) | `titles the confirm dialog in words, not with the method name`, `titles the production upload confirm dialog in words, not with the method name` | same | Fail (TW-2) |
| Confirm dialog shows the operation (describeWrite) | `gridfs.upload shows the bucket...`, `gridfs.delete prints the file id...`, `gridfs escapes database and bucket names...` | `npx ng test --include='src/app/safety/operation.spec.ts'` | Pass |
| Buckets list, fs default, one tab per database, menu entry | view listing tests; `openGridfs ...` service tests; `opens the GridFS tab of a database from its context menu`; `registers the GridFS view for the gridfs tab kind` | `npx ng test --include=...sidebar...,app.spec.ts` | Pass |
| Name filter is literal, case-insensitive | escapeRegex unit tests; int `lists buckets with counts, and files filtered by name, newest first` (existing) | `npx vitest run packages/backend/src/gridfs`; `npm run test:int -- gridfs` | Pass |
| Upload/download progress shown with Cancel; one transfer at a time | view upload/download tests | `npx ng test --include='src/app/gridfs/**/*.spec.ts'` | Pass |

## Focused test execution

Command:

`npx vitest run packages/backend/src/gridfs` (repo root)

Result:

Pass (2 files, 41 tests)

Command:

`cd packages/renderer && npx ng test --include='src/app/gridfs/**/*.spec.ts' --include='src/app/safety/operation.spec.ts' --include='src/app/sidebar/*.spec.ts' --include='src/app/app.spec.ts'`

Result:

Fail: 3 failed (TW-1, TW-2), 283 passed at the time of that run; the final gridfs-only run `npx ng test --include='src/app/gridfs/**/*.spec.ts'` gave 3 failed, 54 passed (57).

Command:

`npm run test:int -- gridfs`

Result:

Pass (11 tests: 7 existing + 4 added)

Command:

`npm run test:e2e -- gridfs`

Result:

Pass (1 passed, Playwright headless, after building renderer and desktop)

## Full test execution

Command:

`npm run check` (lint, typecheck, `vitest run` for all non-renderer workspaces, `ng test` for the renderer), 07:46:54 to 07:47:52 (about 58 s, well under 2 min)

Result:

Fail: lint and typecheck pass; root Vitest 93 files / 4868 tests pass; renderer 111 of 112 files pass, 3776 passed and 3 failed (the TW-1 / TW-2 tests in `gridfs-view.spec.ts`). No other test fails.

## .taskcheck

Result:

Fail (`.taskcheck` runs `npm run check`; same result as above, failing only on the TW-1 / TW-2 tests until production code is fixed).

## Bugs found

### GridFS delete confirm dialog is not marked destructive

Finding ID:

`TW-1`

Test:

`GridfsView > delete > marks the delete as destructive, so Enter does not confirm it by accident`

Production source:

`packages/renderer/src/app/safety/write-guard.service.ts:35` (`DESTRUCTIVE` list has no `gridfs.delete`), called from `packages/renderer/src/app/gridfs/gridfs-view.ts:268` (`guard.run('gridfs.delete', ..., { alwaysConfirm, confirmLabel, detail })` without `destructive: true`)

Requirement:

Delete with confirm (`tasks/gridfs.md` goal and assumption "delete always asks for confirmation"); project safety convention in `confirm-dialog.ts` ("risky writes focus Cancel, so Enter never confirms them by accident"), applied to every other delete/drop (`docs.delete`, `docs.deleteMany`, `coll.drop`, `db.drop`, `idx.drop`).

Expected behavior:

The confirm request for `gridfs.delete` has `destructive: true` (red styling, Cancel focused).

Actual behavior:

`destructive` is `false`; on a non-production profile the dialog focuses "Delete file", so pressing Enter deletes the file.

Severity:

Medium

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.`

### GridFS confirm dialogs are titled with the raw method name

Finding ID:

`TW-2`

Test:

`GridfsView > delete > titles the confirm dialog in words, not with the method name`; `GridfsView > titles the production upload confirm dialog in words, not with the method name`

Production source:

`packages/renderer/src/app/safety/write-guard.service.ts:44-64` (`TITLES` has entries for every other write method but none for `gridfs.upload` / `gridfs.delete`; the fallback is the method name)

Requirement:

SPEC line 131 (production: confirm dialog for every write showing the operation) and the GridFS delete confirmation; every other write has a worded title.

Expected behavior:

A human-readable title (for example "Delete GridFS file" / "Upload file to GridFS"); the exact wording is the fixer's choice, the tests only reject the raw method id.

Actual behavior:

The dialog heading reads `gridfs.delete` (every delete) and `gridfs.upload` (uploads on production profiles).

Severity:

Low

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.`

## Coverage

Status: partial-failed for the renderer (the coverage run with all tests fails on TW-1/TW-2 and writes no report; numbers below come from a fresh diagnostic run that skips only those 3 tests); verified for backend (unit and integration runs) and contract.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured (the tooling has no changed-line mode; not reconstructed by hand).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: task `gridfs`; base c10fccd45875c380422f1ada78c7e16442ff14c4 (given by the parent, equal to the task's `assume` commit); HEAD 08632b7dba48f58ad1d739b8909427577bec2418; task commits 8876ccb6, 3dfa194e, 95911f20, 08632b7d (all four commits are this task's, `git log c10fccd4..HEAD`).
- Source/test snapshot identifier (including uncommitted inputs): HEAD 08632b7d with no production changes; uncommitted test files SHA-256: gridfs.spec.ts 454880d6..., handlers.spec.ts 4f15f904..., gridfs.model.spec.ts 04304519..., gridfs-view.spec.ts dea16000..., operation.spec.ts fe8c5825..., sidebar-tree.service.spec.ts 9e0b371b..., sidebar-tree.spec.ts 52766c78..., app.spec.ts 4a173ebf..., gridfs.int.spec.ts 0521025e... (taken after the last runs; no inputs changed during the final runs).
- Exact included files; renamed/deleted/excluded files and reasons: included backend `src/gridfs/gridfs.ts`, `src/gridfs/handlers.ts`, `src/gridfs/index.ts`, `src/server/backend.ts`, `src/index.ts`; contract `src/gridfs.ts`, `src/index.ts`; renderer `src/app/gridfs/gridfs.model.ts`, `src/app/gridfs/gridfs-view.ts`, `src/app/gridfs/index.ts`, `src/app/safety/operation.ts`, `src/app/sidebar/sidebar-tree.service.ts`, `src/app/sidebar/sidebar-tree.ts`, `src/app/layout/workspace.service.ts`, `src/app/app.config.ts`. Not instrumentable: `gridfs-view.html` / `gridfs-view.css` (template and styles, exercised through the view spec) and the two `index.ts` re-export files (0 statements, reported N/A). No renames or deletions.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with @vitest/coverage-v8 (Node 24.21.0).
  - Backend unit: `npx vitest run --coverage --coverage.clean=true --coverage.include=...` in `packages/backend`, whole backend suite (50 files, 2146 tests).
  - Backend integration: `npx vitest run --config test/integration/vitest.config.ts gridfs --coverage --coverage.clean=true --coverage.allowExternal=true --coverage.include='**/packages/backend/src/gridfs/gridfs.ts' --coverage.include='**/packages/backend/src/gridfs/handlers.ts'` at repo root (11 tests, MongoDB 8 container fixture).
  - Contract: `npx vitest run --coverage --coverage.clean=true --coverage.include='src/gridfs.ts' --coverage.include='src/index.ts'` in `packages/contract` (891 tests).
  - Renderer: `npx ng test --filter='^(?!.*(titles the production upload confirm dialog|titles the confirm dialog in words|marks the delete as destructive)).*$' --coverage --coverage-include=...` in `packages/renderer` (3776 passed, 3 skipped by the filter). The same command without `--filter` exits 1 on the 3 failing tests and leaves `coverage/` empty.
- Run start/completion time and exit status: backend unit 07:44:34, exit 0; integration 07:45:19, exit 0; renderer 07:48:00 to 07:48:20, exit 0 (filtered); contract 07:48:23, exit 0. All on 2026-11-17 (CET).
- Generated report paths and report hashes/run identifier: `packages/backend/coverage/coverage-summary.json` (sha256 b81222eb...); `test/integration/coverage/coverage-summary.json` (sha256 c0daba41..., final integration run at 07:45:19 with all 11 tests); `packages/renderer/coverage/renderer/coverage-summary.json` (sha256 481a3670...); `packages/contract/coverage/coverage-summary.json` (sha256 7b04c644...). All Git-ignored.
- Evidence outputs are fresh and inputs stayed unchanged: each run used `--coverage.clean` (default for ng test) and the file times match the run times; no source or test file changed between a run and the reading of its report, except the renderer test file, which was rerun afterwards (final run 07:48:00).
- Final run after latest test additions and production fixes: yes for all test additions; no production fixes were made yet (TW-1/TW-2 open), so coverage must be re-run after the fix.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

Backend, unit suite only (no server):

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/gridfs/gridfs.ts` | 75/106 (70.8%) | 52/67 (77.6%) | 18/28 (64.3%) | 67/94 (71.3%) |
| `packages/backend/src/gridfs/handlers.ts` | 27/38 (71.1%) | 13/17 (76.5%) | 10/14 (71.4%) | 25/35 (71.4%) |
| `packages/backend/src/gridfs/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/backend/src/server/backend.ts` | 58/63 (92.1%) | 16/18 (88.9%) | 19/24 (79.2%) | 55/58 (94.8%) |
| `packages/backend/src/index.ts` | 1/1 (100%) | N/A (0/0) | N/A (0/0) | 1/1 (100%) |
| Aggregate (summed counters) | 161/208 (77.4%) | 81/102 (79.4%) | 47/66 (71.2%) | 148/188 (78.7%) |

Backend, gridfs integration tests only (real server; separate run, not merged with the unit run):

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/gridfs/gridfs.ts` | 93/106 (87.7%) | 48/67 (71.6%) | 26/28 (92.9%) | 88/94 (93.6%) |
| `packages/backend/src/gridfs/handlers.ts` | 34/38 (89.5%) | 11/17 (64.7%) | 14/14 (100%) | 33/35 (94.3%) |
| Aggregate (summed counters) | 127/144 (88.2%) | 59/84 (70.2%) | 40/42 (95.2%) | 121/129 (93.8%) |

Contract (unit):

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/contract/src/gridfs.ts` | 8/8 (100%) | 2/2 (100%) | 1/1 (100%) | 8/8 (100%) |
| `packages/contract/src/index.ts` | 25/25 (100%) | 14/14 (100%) | 10/10 (100%) | 21/21 (100%) |

Renderer (diagnostic run with the 3 TW-1/TW-2 tests skipped):

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/gridfs/gridfs-view.ts` | 145/147 (98.6%) | 83/91 (91.2%) | 32/32 (100%) | 124/124 (100%) |
| `packages/renderer/src/app/gridfs/gridfs.model.ts` | 23/23 (100%) | 15/16 (93.8%) | 6/6 (100%) | 18/18 (100%) |
| `packages/renderer/src/app/gridfs/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/renderer/src/app/safety/operation.ts` | 77/78 (98.7%) | 67/69 (97.1%) | 8/8 (100%) | 64/65 (98.5%) |
| `packages/renderer/src/app/sidebar/sidebar-tree.service.ts` | 244/244 (100%) | 109/109 (100%) | 70/70 (100%) | 197/197 (100%) |
| `packages/renderer/src/app/sidebar/sidebar-tree.ts` | 403/412 (97.8%) | 238/272 (87.5%) | 95/95 (100%) | 345/346 (99.7%) |
| `packages/renderer/src/app/layout/workspace.service.ts` | 55/55 (100%) | 37/38 (97.4%) | 16/16 (100%) | 38/38 (100%) |
| `packages/renderer/src/app/app.config.ts` | 1/1 (100%) | N/A (0/0) | N/A (0/0) | 1/1 (100%) |
| Aggregate (summed counters) | 948/960 (98.8%) | 549/595 (92.3%) | 227/227 (100%) | 787/789 (99.7%) |

Not measured: `gridfs-view.html`, `gridfs-view.css` (not instrumented by v8; behavior covered through the view spec DOM assertions). The renderer numbers are partial: the run excludes the 3 failing tests.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/backend/src/gridfs/gridfs.ts:104-110,192-201,239-292` (unit run) | listBuckets data path, ByteCounter progress, successful download/upload, removeFile | Need a real server; covered by the integration run (only 117, 155-156, 173, 221, 305 remain there) |
| `packages/backend/src/gridfs/gridfs.ts:117,155-156,173,221,305` (int run) | error catch blocks of listBuckets / listFiles / fileInfo, non-file-system error mapping, deleteFile error | Server-error mapping is exercised in the unit run against an unreachable server; left as is |
| `packages/backend/src/gridfs/gridfs.ts:214-219` (cancelledOr file-system branch) | download target cannot be written | Added int test `a download into a folder that does not exist fails as INTERNAL "Could not write ..."`; now covered |
| `packages/backend/src/gridfs/handlers.ts:68-82,105-107` (unit), `96-97` (int) | download stream wiring; upload stat failure | Download wiring covered by the integration run; upload stat failure covered by unit `a chosen file that cannot be read ...` |
| `packages/renderer/src/app/gridfs/gridfs-view.ts:142,182` | `if (request.signal.aborted) return;` after a resolved request | Defensive: `ApiService.request` already rejects on abort, so not reachable through the public API; the superseded-response behavior is tested through ordering tests |
| `packages/renderer/src/app/gridfs/gridfs-view.ts:98,108,209,210,236,263` (branches) | nullish fallbacks (`fileName ?? ''`, `sizeBytes ?? 0`, `path ?? ''`), cancel with no transfer | Contract makes these values non-null when a stream starts; justified gap |
| `packages/renderer/src/app/gridfs/gridfs.model.ts:24` (branch) | `UNITS[unit] ?? 'B'` fallback | Unreachable (unit capped at the last index) |
| `packages/renderer/src/app/safety/operation.ts:161` | `default:` of describeWrite | Pre-existing code, not task behavior |
| `packages/renderer/src/app/sidebar/sidebar-tree.ts` (various) | pre-existing tree behavior | The task added only the `gridfs` menu item, which is covered |
| `packages/backend/src/server/backend.ts:82,88,154` | pre-existing wiring | The task's gridfs wiring line is covered (the file's backend.spec runs `startBackend`) |

## Unable to test

- AC2 (e2e) was run headless in this environment (no xvfb); it passed. Not run under a display server.
- Unit tests cannot exercise successful GridFS transfers (the driver `GridFSBucket` needs a real server); these are covered by the integration tests only.
- A download cancelled after some bytes were written: the int test cancels right after the response, so the file may be removed before or after the first bytes arrive; both paths end with no local file, but which one ran is not asserted. No follow-up needed unless partial-write cleanup must be proven separately.
- Changed-line coverage: not available with the configured tooling.

## Summary

Tests added; production defects were discovered and must be passed to the `fixer` before task completion. TW-1 (Medium: GridFS delete confirm is not destructive, so Enter confirms a delete) and TW-2 (Low: GridFS confirm dialogs titled `gridfs.delete` / `gridfs.upload`) keep `npm run check` / `.taskcheck` failing with 3 renderer tests until `write-guard.service.ts` (or the view's options) is fixed. Both acceptance criteria pass (`npm run test:int -- gridfs`: 11 passed; `npm run test:e2e -- gridfs`: 1 passed). Renderer coverage must be re-run without the filter after the fix.

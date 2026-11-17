# Test Report

Date: 2026-11-17

Task: gridfs - M6 (Could): GridFS (round 2, after the review round 1 fixes)

Scope: `git diff 80d5f98f7e4addab429e0b6a2f5a706b30d1af5c..390eb14a6f7b6a9485122b2cfb5d637fb79f0683` on branch `main` (task commits 1ebeeccc contract, 5c6bd4bd backend + int tests, f81add97 renderer tab + e2e, 4ee382b0 format, 05b39ba1 round 1 tests, adcdcf25 review, be092caa fixes CR-1..CR-5 / TW-1..TW-2, 390eb14a fixes report; the heartbeat/assume/verify commits in the range only touch `tasks/`). Round 2 focus, as requested by the parent: the production changes of be092caa (`uploadFile` awaited write/end loop and clean-up on cancel/failure, `downloadFile` closing the write stream before `rm`, `gridfs.delete` destructive and `gridfs.upload`/`gridfs.delete` titles in the write guard, `cancelTransfer` message and reload). Plus the uncommitted test files listed below. No production code was changed by the test-writer.

Requirements:
- `tasks/gridfs.md` acceptance criteria: (1) integration test: upload 20 MB file, download identical (hash); (2) e2e: upload and delete from the UI
- `tasks/gridfs.md` recorded assumptions (a cancelled/failed upload deletes its chunks and files doc; a cancelled download removes the partial local file; delete always asks)
- `reviews/gridfs/review.md` findings CR-1..CR-5 and `reviews/gridfs/fixes.md` (the behavior the fixes promise)
- `SPEC.md` (GridFS "Could"; confirm dialogs for writes on production profiles)
- `docs/ARCHITECTURE.md` "GridFS" and "Coverage"
- Parent instructions for round 2

## Test files changed

- `test/integration/gridfs.int.spec.ts` (extended, 2 tests)
- `test/integration/gridfs-faults.int.spec.ts` (new, 4 tests; wraps `node:fs` with `vi.mock` like `packages/backend/src/io/export.spec.ts`, real functions run when no fault is set)
- `packages/renderer/src/app/gridfs/gridfs-view.spec.ts` (extended, 1 test)

All three are uncommitted in the working tree (the test-writer does not commit). SHA-256:
- `test/integration/gridfs-faults.int.spec.ts` 039c594f2e18ad3aca06940e3412d6d0f9c7153bff26f31cdcad3af26c63fe84
- `test/integration/gridfs.int.spec.ts` b5977fc033d5598df813b9334eccdebf5a23ac9de87a98a920610a802b780b53
- `packages/renderer/src/app/gridfs/gridfs-view.spec.ts` fe84282fde48a10b1b8a01961bac81d98052c9c00d883c6c0986bebb12e7fa62

## Tests added or updated

Count: 7 added, 0 updated (on top of the round 1 tests, which all still pass unchanged)

New tests:
- `gridfs.int.spec.ts` › `an upload whose third chunk insert is refused fails as SERVER_ERROR and removes the chunks already stored` (a `badchunk.chunks` validator `n < 2` makes the awaited `write` reject mid-upload; RPC path; asserts SERVER_ERROR, no "Could not read", no final event with `fileId`, empty bucket now and after 300 ms)
- `gridfs.int.spec.ts` › `an upload whose files document is refused fails as SERVER_ERROR and removes all its chunks` (a `badfiles.files` validator makes the awaited `end` reject after all chunks were stored; asserts every progress step was seen, then an empty bucket, then that the bucket still takes another file)
- `gridfs-faults.int.spec.ts` › `a source read error mid-upload fails as INTERNAL "Could not read …" and removes the chunks already stored` (source fails with EIO after 10 reads of 64 KiB, i.e. after two 255 KiB chunks were stored; asserts the exact message, the 10 progress steps, empty bucket now and after 300 ms)
- `gridfs-faults.int.spec.ts` › `a source that fails on its first read stores nothing` (the upload stream is already open when the read fails)
- `gridfs-faults.int.spec.ts` › `a target write error mid-download fails as INTERNAL "Could not write …", closes and removes the partial file` (target accepts 1 MiB, then ENOSPC; asserts the exact message, partial progress, the write stream is closed, no target file now and after 300 ms, stored file untouched with its 13 chunks)
- `gridfs-faults.int.spec.ts` › `a download cancelled while its target file is still opening leaves no file behind` (CR-4 scenario: the target's `open` is held back and answered 100 ms after the cancel; asserts CANCELLED, closed stream, no target file now and after 300 ms)
- `gridfs-view.spec.ts` › `Cancel of an upload into another bucket reloads that bucket, keeps it chosen and keeps the message` (CR-5: after the reload the chosen bucket `images` stays selected, its list is read again and shows the file the backend stored before the cancel, and the status message stays)

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: integration test, upload 20 MB file, download identical (hash) | `gridfs.int.spec.ts` › `uploads a 20 MB file with progress and downloads it byte for byte (SHA-256)` | `npm run test:int -- gridfs` (Testcontainers MongoDB 8 standalone fixture) | Pass (2 files, 18 tests) |
| AC2: e2e, upload and delete from the UI | `test/e2e/gridfs.e2e.ts` › `upload a file into GridFS from the UI, download it, and delete it` | `npm run test:e2e -- gridfs` (builds renderer and Electron bundles, Playwright `_electron` against the built app) | Pass (1 passed) |
| Upload: awaited write/end; a cancel at any point leaves the bucket empty (CR-2/CR-3) | round 1/fix tests `an upload cancelled mid-transfer …`, `an upload cancelled at any progress step (also at its end) …` | `npm run test:int -- gridfs` | Pass |
| Upload: a server failure mid-upload (chunk insert) removes what was stored | `an upload whose third chunk insert is refused …` | `npm run test:int -- gridfs` | Pass |
| Upload: a failed files-document write (end) removes all chunks | `an upload whose files document is refused …` | `npm run test:int -- gridfs` | Pass |
| Upload: a source read error mid-upload removes what was stored and says "Could not read …" | `a source read error mid-upload …`, `a source that fails on its first read stores nothing` | `npm run test:int -- gridfs` | Pass |
| Upload: cancelled before anything is read | unit `a cancelled upload is CANCELLED before anything is read` | `npx vitest run packages/backend/src/gridfs` | Pass (41 tests) |
| Download: cancel/failure closes the write stream before removing the partial file (CR-4) | `a cancelled download ends CANCELLED and removes the partial local file`, `a target write error mid-download …`, `a download cancelled while its target file is still opening …`, unit `a cancelled download …`, `a failed download removes the file it started to write` | `npm run test:int -- gridfs`; `npx vitest run packages/backend/src/gridfs` | Pass |
| Write guard: `gridfs.delete` destructive (Cancel focused), titles "Upload file"/"Delete file" (TW-1/TW-2/CR-1) | `marks the delete as destructive, so Enter does not confirm it by accident`, `titles the confirm dialog in words, not with the method name`, `titles the production upload confirm dialog in words, not with the method name` | `cd packages/renderer && npx ng test --include src/app/gridfs/gridfs-view.spec.ts` | Pass (47 tests) |
| cancelTransfer: honest message, upload cancel reloads, download cancel does not (CR-5) | `Cancel stops the stream at the backend and reloads the list (it may have committed)`, `Cancel stops the download at the backend`, new `Cancel of an upload into another bucket reloads that bucket …` | `cd packages/renderer && npx ng test --include src/app/gridfs/gridfs-view.spec.ts` | Pass (47 tests) |

## Focused test execution

Commands:

`npx vitest run packages/backend/src/gridfs`

`cd packages/renderer && npx ng test --include src/app/gridfs/gridfs-view.spec.ts`

`npm run test:int -- gridfs`

Result:

Pass (backend unit 2 files / 41 tests; renderer view 47 tests; integration `gridfs.int.spec.ts` + `gridfs-faults.int.spec.ts` 18 tests, run 3 times during this round, all green)

## Full test execution

Commands:

`sh .taskcheck` (`npm run check`: eslint + prettier, tsc for root (includes `test/`) and workspaces, root Vitest, renderer `ng test`)

`npm run test:e2e -- gridfs`

Result:

Pass: lint and typecheck clean; root Vitest 94 files / 4953 tests passed; renderer 113 files / 3805 tests passed. e2e gridfs 1 passed. The full integration suite (all fixtures, LDAP/OIDC/TLS containers) was not run: only the gridfs files are in scope and the full suite starts many unrelated containers.

## .taskcheck

Result:

Pass (run at about 08:07 CET after the last test change)

## Bugs found

None. Every new test passed against the fixed code (be092caa) without production changes.

Observations (no requirement violated, no fix required; for the parent to judge):
- O-1 (`packages/backend/src/gridfs/gridfs.ts:269-270`): the "not yet closed" branch of `closeStream` (destroy, then wait for `close`) is never reached, even when the target's `open` is still pending at cancel time: `pipeline` already waits for the write stream to close before it rejects. The CR-4 behavior (no file left) is verified end to end; the branch is defensive.
- O-2 (`gridfs.ts:308`): `stat(source)` in `uploadFile` is outside the `try`. If the chosen file disappears between the handler's own `stat` and the stream start, the stream error is the generic `INTERNAL "Unexpected error: ENOENT …"` instead of "Could not read …". Unchanged since round 1, a narrow race, not named by any criterion.
- O-3 (`packages/renderer/src/app/gridfs/gridfs-view.ts:266`): the reload after an upload cancel is sent at once, while the backend clean-up may still run, so that list can briefly include a file that is being removed (the next refresh corrects it). Inherent to CR-5's requested reload; not a defect against the criteria.

## Coverage

Status: verified (backend unit, backend integration, contract and renderer runs all exited 0 after the last test change).

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured (the tooling has no changed-line mode; not reconstructed by hand).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: task `gridfs`; base 80d5f98f7e4addab429e0b6a2f5a706b30d1af5c (given by the parent); HEAD 390eb14a6f7b6a9485122b2cfb5d637fb79f0683; task-owned commits 1ebeeccc, 5c6bd4bd, f81add97, 4ee382b0, 05b39ba1, adcdcf25, be092caa, 390eb14a (`git log 80d5f98f..HEAD`; the other commits in the range are other agents' heartbeat/assume/verify commits touching only `tasks/`). Production file list from `git diff --name-only 80d5f98f..HEAD`.
- Source/test snapshot identifier (including uncommitted inputs): HEAD 390eb14a with a clean tree except the three test files above (SHA-256 listed under "Test files changed"); hashes taken after the final runs, no production file changed.
- Exact included files; renamed/deleted/excluded files and reasons: backend `src/gridfs/gridfs.ts`, `src/gridfs/handlers.ts`, `src/gridfs/index.ts`, `src/server/backend.ts`, `src/index.ts`; contract `src/gridfs.ts`, `src/index.ts`; renderer `src/app/gridfs/gridfs-view.ts`, `src/app/gridfs/gridfs.model.ts`, `src/app/gridfs/index.ts`, `src/app/safety/operation.ts`, `src/app/safety/write-guard.service.ts` (new in scope this round, changed by be092caa), `src/app/sidebar/sidebar-tree.service.ts`, `src/app/sidebar/sidebar-tree.ts`, `src/app/layout/workspace.service.ts`, `src/app/app.config.ts`. Not instrumentable: `gridfs-view.html`, `gridfs-view.css` (exercised through the view spec's DOM assertions and the e2e). The `index.ts` re-export files have 0 statements (N/A). No renames or deletions.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with @vitest/coverage-v8, Node 24.21.0.
  - Backend unit: `npx vitest run --coverage --coverage.clean=true --coverage.include='src/gridfs/gridfs.ts' --coverage.include='src/gridfs/handlers.ts' --coverage.include='src/gridfs/index.ts' --coverage.include='src/server/backend.ts' --coverage.include='src/index.ts'` in `packages/backend` (whole backend suite, 2189 tests).
  - Backend integration: `npx vitest run --config test/integration/vitest.config.ts gridfs --coverage --coverage.clean=true --coverage.allowExternal=true --coverage.reporter=json-summary --coverage.reporter=text --coverage.reporter=lcov --coverage.include='**/packages/backend/src/gridfs/gridfs.ts' --coverage.include='**/packages/backend/src/gridfs/handlers.ts'` at the repo root (2 files, 18 tests, MongoDB 8 container fixture).
  - Contract: `npx vitest run --coverage --coverage.clean=true --coverage.include='src/gridfs.ts' --coverage.include='src/index.ts'` in `packages/contract` (891 tests).
  - Renderer: `npx ng test --coverage --coverage-include=<each renderer file above>` in `packages/renderer` (113 files, 3805 tests, nothing filtered or skipped; round 1's filtered diagnostic run is superseded).
- Run start/completion time and exit status (2026-11-17, CET): backend unit 08:03:59, exit 0; renderer about 08:06 (summary written 08:06:18), exit 0; integration final run 08:07:55 to 08:08:04, exit 0; contract about 08:08, exit 0.
- Generated report paths and report hashes/run identifier (all Git-ignored): `packages/backend/coverage/coverage-summary.json` sha256 e3f12377ed169e95e889a42840dbfb9d7db099497d5c776e64a50474a1675c82; `test/integration/coverage/coverage-summary.json` sha256 87f7b4828dc2cd3101ba106ba9b4219914b1c5290b44a6be4674c266a3e361e5; `packages/renderer/coverage/renderer/coverage-summary.json` sha256 402f6d94fcd36056f7fc00b4aceb962459fb77b4e2941fcff9a0a70f0cabff90; `packages/contract/coverage/coverage-summary.json`.
- Evidence outputs are fresh and inputs stayed unchanged: every run used a clean coverage directory (`--coverage.clean=true`, default for `ng test`); production files were unchanged throughout; the only test change after the backend unit and renderer runs was in `gridfs-faults.int.spec.ts`, which those runs do not execute; the integration run was repeated after it (08:07:55).
- Final run after latest test additions and production fixes: yes (the fixes are in HEAD; all runs are after the last test edit that affects them).

Values below use covered/total (percentage); zero-denominator metrics are N/A.

Backend, unit suite only (no server):

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/gridfs/gridfs.ts` | 83/133 (62.4%) | 54/75 (72.0%) | 19/39 (48.7%) | 76/117 (65.0%) |
| `packages/backend/src/gridfs/handlers.ts` | 27/38 (71.1%) | 13/17 (76.5%) | 10/14 (71.4%) | 25/35 (71.4%) |
| `packages/backend/src/gridfs/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/backend/src/server/backend.ts` | 58/63 (92.1%) | 16/18 (88.9%) | 19/24 (79.2%) | 55/58 (94.8%) |
| `packages/backend/src/index.ts` | 1/1 (100%) | N/A (0/0) | N/A (0/0) | 1/1 (100%) |
| Aggregate (summed counters) | 169/235 (71.9%) | 83/110 (75.5%) | 48/77 (62.3%) | 157/211 (74.4%) |

Backend, gridfs integration tests only (real server; separate run, not merged with the unit run):

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/gridfs/gridfs.ts` | 118/133 (88.7%) | 55/75 (73.3%) | 36/39 (92.3%) | 110/117 (94.0%) |
| `packages/backend/src/gridfs/handlers.ts` | 34/38 (89.5%) | 11/17 (64.7%) | 14/14 (100%) | 33/35 (94.3%) |
| Aggregate (summed counters) | 152/171 (88.9%) | 66/92 (71.7%) | 50/53 (94.3%) | 143/152 (94.1%) |

The gridfs.ts totals grew from round 1 (106 to 133 statements) because of the new upload loop and helpers. One integration run before the last test addition had 65/92 branches instead of 66/92: the `closeStream`/progress timing branches vary slightly between runs.

Contract (unit):

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/contract/src/gridfs.ts` | 8/8 (100%) | 2/2 (100%) | 1/1 (100%) | 8/8 (100%) |
| `packages/contract/src/index.ts` | 25/25 (100%) | 14/14 (100%) | 10/10 (100%) | 21/21 (100%) |

Renderer (full run, no tests filtered):

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/gridfs/gridfs-view.ts` | 147/149 (98.7%) | 85/93 (91.4%) | 32/32 (100%) | 125/125 (100%) |
| `packages/renderer/src/app/gridfs/gridfs.model.ts` | 23/23 (100%) | 15/16 (93.8%) | 6/6 (100%) | 18/18 (100%) |
| `packages/renderer/src/app/gridfs/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/renderer/src/app/safety/operation.ts` | 77/78 (98.7%) | 67/69 (97.1%) | 8/8 (100%) | 64/65 (98.5%) |
| `packages/renderer/src/app/safety/write-guard.service.ts` | 81/81 (100%) | 73/76 (96.1%) | 12/12 (100%) | 61/61 (100%) |
| `packages/renderer/src/app/sidebar/sidebar-tree.service.ts` | 244/244 (100%) | 109/109 (100%) | 70/70 (100%) | 197/197 (100%) |
| `packages/renderer/src/app/sidebar/sidebar-tree.ts` | 403/412 (97.8%) | 238/272 (87.5%) | 95/95 (100%) | 345/346 (99.7%) |
| `packages/renderer/src/app/layout/workspace.service.ts` | 55/55 (100%) | 37/38 (97.4%) | 16/16 (100%) | 38/38 (100%) |
| `packages/renderer/src/app/app.config.ts` | 1/1 (100%) | N/A (0/0) | N/A (0/0) | 1/1 (100%) |
| Aggregate (summed counters) | 1031/1043 (98.8%) | 624/673 (92.7%) | 239/239 (100%) | 849/851 (99.8%) |

Not measured: `gridfs-view.html`, `gridfs-view.css` (not instrumented by v8; covered through DOM assertions and the e2e).

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/backend/src/gridfs/gridfs.ts:269-270` (int and unit) | `closeStream` destroy-and-wait branch for a write stream not yet closed (CR-4 guard) | Added `a download cancelled while its target file is still opening …` (open held back past the cancel); the branch is still not reached because `pipeline` waits for the close itself; behavior (no file left) verified; justified defensive gap (O-1) |
| `gridfs.ts:255`, `gridfs.ts:331` (int) | `.catch(() => undefined)` when `rm` or the clean-up `removeFile` itself fails | Needs a failing `rm --force` or a server failing the clean-up after it accepted the inserts; low value, left uncovered |
| `gridfs.ts:329` branch `upload === undefined` (int) | cancel before the upload stream opens | Covered by unit `a cancelled upload is CANCELLED before anything is read` |
| `gridfs.ts:320` (faults file only) / covered in `gridfs.int.spec.ts` | the swallowing `error` listener of the upload stream | Covered by the validator tests (the driver emits `error` on the refused insert) |
| `gridfs.ts:117,155-156,173,357` (int) | error mapping of listBuckets/listFiles/fileInfo/deleteFile | Covered by the unit run against an unreachable server |
| `gridfs.ts:35,66,93` (int) | fake-client refusal, BSON symbol filename, metadata mapping | Covered by unit tests |
| `packages/backend/src/gridfs/handlers.ts:96-97` (int), `68-82,105-107` (unit) | upload `stat` failure; download/upload stream wiring | `stat` failure covered by unit `a chosen file that cannot be read …`; wiring covered by the integration run |
| `packages/renderer/src/app/gridfs/gridfs-view.ts:142,182` | `if (request.signal.aborted) return;` after a resolved request | Defensive (`ApiService.request` rejects on abort); superseded responses covered by the ordering tests |
| `gridfs-view.ts:98,108,209,210,236` (branches) | nullish fallbacks (`total`, `percent`, `fileName ?? ''`, `sizeBytes ?? 0`, `path ?? ''`) | Contract makes these non-null when a stream starts; justified gap |
| `gridfs-view.ts:265` branch `t === null` | `cancelTransfer` with no transfer shown | The Cancel button exists only while a transfer is shown; justified gap |
| `packages/renderer/src/app/safety/write-guard.service.ts:118,150,192` (branches) | pre-existing guard branches | Not task code; the task's lines (DESTRUCTIVE and TITLES entries) are covered by the three view tests |
| `packages/renderer/src/app/gridfs/gridfs.model.ts:24` (branch) | `UNITS[unit] ?? 'B'` fallback | Unreachable (unit capped at the last index) |
| `packages/renderer/src/app/safety/operation.ts:161` | `default:` of describeWrite | Pre-existing code |
| `packages/renderer/src/app/sidebar/sidebar-tree.ts` (various) | pre-existing tree behavior | The task added only the `gridfs` menu item, which is covered |
| `packages/backend/src/server/backend.ts:82,88,154` | pre-existing wiring | The task's gridfs wiring line is covered |

## Unable to test

- A server error during the upload clean-up itself (`removeFile` failing after a failed upload): would need a server that accepts the inserts and then refuses the deletes mid-test; not practical with the fixture. Low risk (the original error is still reported). No follow-up required.
- A cancel that lands exactly while the driver's files-document insert is in flight: covered statistically by the round 1 fix test that cancels at every progress step including the end, but the exact interleaving cannot be forced without fault injection inside the driver. No follow-up required.
- The full integration suite (all fixtures) was not run; only the gridfs files are in scope.

## Summary

Tests added and all validation passed. No production defects found in the round 2 fixes; acceptance criteria 1 (`npm run test:int -- gridfs`, 20 MB SHA-256 round trip) and 2 (`npm run test:e2e -- gridfs`) both pass. Three low-risk observations (O-1..O-3) are recorded for the parent; none requires a fix for the task's criteria.

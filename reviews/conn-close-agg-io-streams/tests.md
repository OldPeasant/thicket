# Test Report

Date: 2026-11-17

Task: conn-close-agg-io-streams - conn.close cancels agg.run and io.export/import streams before closing the client

Scope: `git diff 1f83bd0f28d8aac2994dbf7d9953394d14ae95d4..0d9bf593f87984cc8fb730ceb6371a2a9a7678d6` (task commits a3be31c implementation + agg integration test, 0d9bf59 io unit tests), plus the uncommitted test-file additions listed below. Branch `main`, HEAD 0d9bf593f87984cc8fb730ceb6371a2a9a7678d6.

Requirements:
- `tasks/conn-close-agg-io-streams.md` acceptance criteria and notes
- `docs/ARCHITECTURE.md` "Coverage" and conventions; `docs/QUALITY.md`
- Parent instructions (base commit, task commits, suggested gaps)
- Existing pattern: `packages/backend/src/docs/query/handlers.spec.ts` "conn.close kills a running find"

## Test files changed

- `packages/backend/src/connections/manager.spec.ts`
- `packages/backend/src/agg/handlers.spec.ts`
- `packages/backend/src/io/handlers.spec.ts`

## Tests added or updated

Count: 10 (6 in manager.spec.ts, 2 in agg/handlers.spec.ts, 2 in io/handlers.spec.ts; no existing test changed)

- manager.spec.ts, describe "streamOnConnection (task conn-close-agg-io-streams)":
  - answers the work result while the connection is open
  - passes a non-close failure on unchanged (same error) while the connection is open
  - forwards the caller's abort to the work; the work's own cancel error is kept while open
  - conn.close aborts the work, waits for its cleanup, then answers CANCELLED "The connection was closed"
  - a failure after the connection was closed and reopened (new client) answers CANCELLED
  - refuses to start work for a closed connection or another client (work never runs)
- agg/handlers.spec.ts:
  - conn.close kills a running agg.run (killOp, killCursors) before it closes the client
  - a stream cancel of agg.run while its connection stays open keeps "The operation was cancelled"
- io/handlers.spec.ts, describe "ioHandlers and conn.close":
  - a stream cancel of io.export while the connection stays open is not reported as closed
  - an io.import failure while the connection is open passes on unchanged

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: integration test - conn.close during a slow agg.run ends CANCELLED, backend sent killOp, server op gone | `agg.int.spec.ts` "agg.run and conn.close > conn.close during a slow agg.run ends its stream with CANCELLED and kills the server operation" (task's own test) | `npx vitest run --config test/integration/vitest.config.ts test/integration/agg.int.spec.ts` (repo root, container fixture) | Pass (16/16; the conn.close test also run alone with `-t "conn.close"`: 1 passed) |
| AC1 (unit level): agg.run cleanup (killOp, killCursors) runs before client.close on conn.close | `conn.close kills a running agg.run (killOp, killCursors) before it closes the client` | `cd packages/backend && npx vitest run src/agg/handlers.spec.ts` | Pass |
| AC2: io.export ends CANCELLED on conn.close; cleanup (killOp, killCursors, partial file removal) before client close | `io.export ends CANCELLED; the server operation, cursor and partial file go first` (task's own test) | `cd packages/backend && npx vitest run src/io/handlers.spec.ts` | Pass |
| AC2: io.import ends CANCELLED on conn.close; running insert killed before client close | `io.import ends CANCELLED; its running insert is killed before the client closes` (task's own test) | same | Pass |
| A stream cancel while the connection stays open is not mislabelled "connection closed" (signal forwarding through streamOnConnection) | streamOnConnection "forwards the caller's abort ..."; agg "a stream cancel of agg.run ..."; io "a stream cancel of io.export ..." | `npx vitest run src/connections/manager.spec.ts src/agg/handlers.spec.ts src/io/handlers.spec.ts` | Pass |
| Non-close failures pass through unchanged while open | streamOnConnection "passes a non-close failure on unchanged ..."; io "an io.import failure while the connection is open passes on unchanged"; existing agg "agg.run passes a failure on unchanged ..." | same | Pass |
| Any failure after close or replacement (close + reopen) is CANCELLED "The connection was closed" | streamOnConnection "conn.close aborts the work ..." and "a failure after the connection was closed and reopened ..."; existing agg "closed and reopened meanwhile" | same | Pass |
| Work never starts on a closed/other client | streamOnConnection "refuses to start work ..." | same | Pass |

## Focused test execution

Command:

`cd packages/backend && npx vitest run src/connections/manager.spec.ts src/agg/handlers.spec.ts -t "streamOnConnection|conn.close|stream cancel|connection"` and `npx vitest run src/io/handlers.spec.ts`

Result:

Pass (27 passed / 136 skipped by filter; io: 28 passed)

## Full test execution

Command:

`npm run check` (repo root: lint, typecheck, root vitest, renderer `ng test`)

Result:

Pass (root vitest 75 files / 4112 tests passed; renderer 92 files / 2962 tests passed; lint and typecheck passed, they run first in the `&&` chain). Integration: `agg.int.spec.ts` 16 passed (see above); other integration suites not run (not named by this task).

## .taskcheck

Result:

Pass (`.taskcheck` runs `npm run check`; run above on the snapshot below)

## Bugs found

None. No production defect was found. Note: the new agg.run close-ordering unit test was not executed against the pre-fix code (that would require changing production files); by inspection the pre-fix agg.run producer was not registered with `cancelOnClose`, so `conn.close` would close the client while the aggregate was still pending and the asserted order (killOp, killCursors before client.close) could not occur.

## Coverage

Status: verified

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: measured by intersection - the task's added/modified executable lines are `packages/backend/src/connections/manager.ts` 592-610 (`streamOnConnection`) and the changed hunks of `agg/handlers.ts` and `io/handlers.ts`; the only uncovered locations in scope (manager.ts 329, 486-487) lie outside the task diff, and agg/io handlers are 100% in every metric, so all changed executable lines and their branches are covered.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: conn-close-agg-io-streams; base 1f83bd0f28d8aac2994dbf7d9953394d14ae95d4 (from the parent); HEAD 0d9bf593f87984cc8fb730ceb6371a2a9a7678d6; task commits a3be31c and 0d9bf59 (from the parent, confirmed with `git diff --stat 1f83bd0..HEAD`: 5 files, all task-related).
- Source/test snapshot identifier (including uncommitted inputs): HEAD 0d9bf59 plus uncommitted test changes, sha256: manager.spec.ts 58ff099f94a86c67510bd751fd4d5f127a5435823d58130f2e4bf2d9ca3646dc, agg/handlers.spec.ts 53ff23fc69093b68de2935574de618c1512fc49370e9264b3f00afe6cfaa7821, io/handlers.spec.ts aff1a167d0e116c14f2e9a5c61a5f7f5ed9c6ddaa0d8600251a17f9d3792be9b; production (unchanged, as committed) manager.ts e85ba3520de848ffa5ba9a25b4b87961138eb6cd3665371482e898dcd62c2c4d, agg/handlers.ts ca8c9688f4be34a36ce486966a91f87d801f32b18005e53fdd3b9954decd20d6, io/handlers.ts 773cdd97fc1a0bbd8bebdad8c8065185e566f2ddd458e9c5557043ab0661a6b7.
- Exact included files; renamed/deleted/excluded files and reasons: included `packages/backend/src/connections/manager.ts`, `packages/backend/src/agg/handlers.ts`, `packages/backend/src/io/handlers.ts`. Excluded: `packages/backend/src/io/handlers.spec.ts` and `test/integration/agg.int.spec.ts` (test files). No renames or deletions.
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8` 5.1.0 (vitest 5.1.0); `npx vitest run --coverage --coverage.clean=true --coverage.reporter=json-summary --coverage.reporter=json --coverage.include='src/connections/manager.ts' --coverage.include='src/agg/handlers.ts' --coverage.include='src/io/handlers.ts'` in `packages/backend`; full backend unit suite (38 files, 1655 tests).
- Run start/completion time and exit status: started 2026-11-17 05:09:31 local, report written 04:09:44Z; all tests passed, reports generated.
- Generated report paths and report hashes/run identifier: `packages/backend/coverage/coverage-summary.json` sha256 91665b6e3915e7354052851fa479ecb41f62f8c185e94c760b8c645b11bb3b72; `packages/backend/coverage/coverage-final.json` sha256 e6172fc808b8127583c1958db1075a524f7318a191fbc8941c1f5d7f0d14a29e (git-ignored).
- Evidence outputs are fresh and inputs stayed unchanged: `--coverage.clean=true` regenerated the directory in this run; the file hashes above were identical before and after the run.
- Final run after latest test additions and production fixes: yes (no production fixes were made; all test additions precede the run).

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/connections/manager.ts` | 271/273 (99.26%) | 143/145 (98.62%) | 51/51 (100%) | 235/236 (99.57%) |
| `packages/backend/src/agg/handlers.ts` | 13/13 (100%) | 2/2 (100%) | 8/8 (100%) | 11/11 (100%) |
| `packages/backend/src/io/handlers.ts` | 55/55 (100%) | 20/20 (100%) | 17/17 (100%) | 49/49 (100%) |
| Aggregate (summed counters, all 3 scoped files measured, none missing) | 339/341 (99.41%) | 165/167 (98.80%) | 76/76 (100%) | 295/296 (99.66%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/backend/src/connections/manager.ts:329` (statement + branch: entry replaced after the SSH tunnel opened) | Pre-existing open/SSH path, not part of this task | Left uncovered: outside the task diff and outside this task's responsibility |
| `packages/backend/src/connections/manager.ts:486-487` (configOf without a stored config) | Pre-existing defensive branch, not part of this task | Left uncovered: outside the task diff; defensive and not reachable through the public API in this task |

## Unable to test

- Running the new agg.run close-ordering unit test against the pre-fix code: would require modifying production source, which this helper must not do; the integration test was reported by the parent to fail without the fix. No follow-up required.

## Summary

Tests added and all validation passed. Tests and task-scoped coverage are sufficient; no production defects found.

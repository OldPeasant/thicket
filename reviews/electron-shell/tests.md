# Test Report

Date: 2026-11-16

Task: electron-shell - M0: Electron main, preload, backend utilityProcess and port broker

Scope: `git diff b93d0f27ec0c9375109365a71c4c820b97163e18..18f97c6287496989a8bda6ccea6de951feb57126 -- . ':!tasks' ':!reviews'`
(task commits 89a69ae, ca88857, 18f97c6 on branch `main`; base and commit list supplied by the parent
worker and consistent with the task's `touches` list and acceptance criteria). Working tree at
measurement: HEAD 18f97c6 plus uncommitted changes to the 7 test files listed below (no production
changes).

Requirements:
- `tasks/electron-shell.md` acceptance criteria and recorded assumptions
- `docs/ARCHITECTURE.md` (CSP, Coverage), `docs/QUALITY.md` (report contract)
- Parent instructions (scope, Electron-only glue files covered by the Electron integration test)

## Test files changed

- `apps/desktop/src/main/security.spec.ts`
- `apps/desktop/src/main/backend-host.spec.ts`
- `apps/desktop/src/main/handlers.spec.ts`
- `apps/desktop/src/preload/bridge.spec.ts`
- `packages/backend/src/server/rpc.spec.ts`
- `packages/backend/src/server/backend.spec.ts`
- `packages/contract/src/backend.spec.ts`

No production file, configuration or existing assertion was changed or removed (`git diff` shows 0
removed `it(` cases; the only removed lines are two import lines in `handlers.spec.ts` that were
widened).

## Tests added or updated

Count: 58 added, 1 updated (`mimeType` got two more assertions).

- security.spec (10): navigation blocked for query/path/origin/scheme changes (`file:`, `javascript:`,
  other host, dev server), blocked when one URL is missing or unparsable, hash change on the dev
  server allowed, `window.open` denied regardless of details, null bytes and encoded `/`, `\`, `.`,
  `..` segments refused, dot segments folded by URL parsing never leave the root, query/fragment
  ignored, CSP forbids framing/forms/base changes, dev mode only widens `connect-src`, upper-case CSP
  header replaced and string values normalised.
- backend-host.spec (6): privileged port of main closed on backend death and on `stop()`, every
  (re)start gets a fresh privileged port and no port is handed out twice, renderer connecting during
  back-off gets its port with the restart info, renderer disconnecting during back-off gets nothing,
  several renderers get the same restart info, start/exit/restart log lines.
- handlers.spec (4): main and privileged handler names disjoint; a window's main port served with
  `methods` refuses `secrets.get`/`main.ping` with `UNKNOWN_METHOD` even if a privileged handler were
  mixed in (handler never called); backend methods and inherited keys (`__proto__`, `constructor`)
  refused on the main port; privileged port serves `main.ping` and the secrets stub, validates
  `secrets.get` params and does not serve the renderer contract.
- bridge.spec (21): cancel races (late result after CANCELLED ignored, cancel after response sends
  nothing, id reusable after settle, cancelling one queued request keeps order of the others, request
  queued for main not cancelled on the backend port); privileged and inherited method names answered
  `UNKNOWN_METHOD` without sending; extra request properties not forwarded; main port replacement
  (reload) fails main requests without `backend.restarted` and leaves backend requests running;
  `on(listener)` receives `backend.restarted`, first backend port emits nothing; dead-backend stream
  gets exactly one error event and can no longer be cancelled; main streams survive a backend restart;
  end events buffered for late subscribers; unknown-stream events dropped silently; buffer not
  replayed to a second listener; global listener receives new-stream events without dropping;
  double unsubscribe; `on(stream)` without listener throws; malformed requests rejected; non-string
  cancel ids ignored; unknown response ids ignored; more `isPortMessage` shapes refused.
- rpc.spec (8): cancel in the same tick as its request answers CANCELLED once; result of a handler
  that ignores the abort is dropped; a cancel aborts only its own request; id reusable after cancel;
  inherited names refused even with a `toString` handler; thrown non-Error becomes INTERNAL;
  `RpcClient` ignores late answers after timeout, unknown ids and non-responses; no cancel sent when
  answered before the timeout.
- backend.spec (7): renderer cannot call `secrets.get`/`main.ping` through the backend and nothing is
  forwarded on the privileged port; a replacement privileged port fails the pending call at once and
  the new one works; several renderer ports served independently (same ids, separate cancel);
  malformed renderer messages are logged with the window id; renderer control message without
  numeric window ignored; `sleep` resolves normally and rejects CANCELLED when aborted while waiting.
- contract backend.spec (2): `backend.sleep` boundaries (1 ms, exactly `MAX_SLEEP_MS`, +1, extra key,
  string); `backend.restarted` is a broadcast stream, not a routable method.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: `app.ping` answered by main and `backend.ping` by the backend in a started Electron app | `app.electron.spec.ts` "app.ping is answered by main, backend.ping by the backend process"; unit: handlers.spec "app.ping answers...", "a window's main port ... answers app.ping"; rpc.spec "answers a request with the validated result" | `npm run test:electron -w apps/desktop` (built bundles, Electron via playwright-core against the desktop session display; no xvfb-run on this machine) | Pass (7/7). `npm run dev` itself was not started by me |
| AC2: sandbox, contextIsolation, no nodeIntegration, CSP; `window.open` and navigation blocked (unit tests on the handlers) | security.spec (all `secureWebPreferences`, `contentSecurityPolicy*`, `withCspHeader*`, `window.open and navigation` cases); Electron: "loads the renderer from thicket://app with the CSP header", "exposes only thicket.request/cancel/on and no Node APIs", "blocks window.open and navigation" | `npm run check`; `npm run test:electron -w apps/desktop` | Pass |
| AC3: killed backend detected, restarted, renderer receives `backend.restarted` | backend-host.spec restart/back-off/during-back-off/several renderers; bridge.spec "after a backend restart...", "on(listener) also gets backend.restarted...", "a stream of the dead backend gets one error event..."; Electron: "restarts a killed backend and tells the renderer" | `npm run check`; `npm run test:electron -w apps/desktop` | Pass |
| AC4: long backend request cancelled via `thicket.cancel(id)` answers `CANCELLED` | rpc.spec cancel tests (incl. same-tick, ignored abort, only own request, id reuse); bridge.spec "Bridge: cancel races"; backend.spec "serves several renderer ports independently"; Electron: "cancels a long backend request with CANCELLED" | `npm run check`; `npm run test:electron -w apps/desktop` | Pass |
| AC5: privileged main-backend port exists (stub handler) and is not reachable from the renderer | handlers.spec "the privileged port (main side)", "a window's main port ... refuses privileged methods"; backend.spec "a renderer cannot call privileged methods through the backend", "uses the privileged port to reach main", "a new privileged port replaces the old one"; backend-host.spec privileged port tests; bridge.spec "privileged methods are not reachable"; contract backend.spec "privileged methods"; Electron: "the privileged main ↔ backend methods are not reachable from the renderer" | `npm run check`; `npm run test:electron -w apps/desktop` | Pass |

## Focused test execution

Command:

`npx vitest run src/main/security.spec.ts`, `npx vitest run src/main/backend-host.spec.ts`,
`npx vitest run src/main/handlers.spec.ts`, `npx vitest run src/preload/bridge.spec.ts`,
`npx vitest run packages/backend/src/server`, `npx vitest run packages/contract/src/backend.spec.ts`,
`npx vitest run apps/desktop/src/preload/bridge.spec.ts packages/backend/src/server/backend.spec.ts`
(all from the repo root; Vitest projects resolve the paths)

Result:

Pass. One new assertion of mine failed during development (`thicket://app/media/%2e/x.js` expected
to be refused); the URL parser folds `%2e` segments before `resolveAppFile` sees them, so the path
stays below the root. The test was wrong and now asserts the folded, safe result.

## Full test execution

Command:

`npm run check` (lint, Prettier, type check of all workspaces, `vitest run` and renderer `ng test`)

Result:

Pass: 738 Vitest tests in 12 files and 46 renderer tests; lint and Prettier clean; whole check well
under 2 minutes (Vitest about 1.7 s).

`npm run test:electron -w apps/desktop` -> Pass, 1 file, 7 tests (bundles built by
`scripts/build.mjs`, renderer from the existing `packages/renderer/dist`).

## .taskcheck

Result:

Pass (`.taskcheck` runs `npm run check`; run above on the final test snapshot).

## Bugs found

None. No test exposed a production defect.

Observations (no failing test, not blocking; for the parent/code-reviewer to judge):

- `apps/desktop/src/main/security.ts` documents `blockNavigation` for `will-frame-navigate`, but
  `apps/desktop/src/main/index.ts` registers it only for `will-navigate` and `will-redirect`. Subframe
  navigation is already prevented by the CSP (`frame-src 'none'`, unit-tested), so I found no
  exploitable path; it is a doc/wiring mismatch.
- `Bridge`: when an `on(listener)` subscription exists, events of a new stream are delivered to it
  and the per-stream buffer is discarded, so a stream-specific listener that subscribes later misses
  them. Consistent with the code's comments; noted because SPEC does not define it.

## Coverage

Status: verified (fresh run on the final test snapshot; exit 0; all tests passed)

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured (the configured tooling has no changed-line report).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `electron-shell`;
  base `b93d0f27ec0c9375109365a71c4c820b97163e18`; HEAD `18f97c6287496989a8bda6ccea6de951feb57126`;
  commits 89a69ae, ca88857, 18f97c6 supplied by the parent and matching `git diff --stat` of that
  range and the task `touches` list.
- Source/test snapshot identifier (including uncommitted inputs): HEAD 18f97c6 with no production
  changes, plus git blob hashes of the modified specs: backend-host.spec `326c4932`, handlers.spec
  `c5c49a56`, security.spec `43fd2ce1`, bridge.spec `ea2c05f4`, backend.spec (backend) `0153fff3`,
  rpc.spec `c938409a`, contract backend.spec `e0e72c12`. The same hashes were checked before and
  after the coverage run.
- Exact included files: `apps/desktop/src/main/{security,backend-host,handlers,window,index}.ts`,
  `apps/desktop/src/preload/{bridge,ports,index}.ts`,
  `packages/backend/src/server/{rpc,backend,handlers,ports,protocol,entry}.ts`,
  `packages/backend/src/index.ts`, `packages/contract/src/{backend,app,envelope,index}.ts`. Excluded:
  spec files and `server/testing.ts` (test helpers), `apps/desktop/scripts/*.mjs` (build/dev scripts,
  exercised by `test:electron`), `vitest.electron.config.ts`, `package.json`/`tsconfig.json`/lockfile
  (configuration), `docs/ARCHITECTURE.md`. No renamed or deleted files.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with
  `@vitest/coverage-v8` (node v24.21.0); cwd repo root;
  `npx vitest run --coverage --coverage.reportsDirectory=coverage/electron-shell-final` with one
  `--coverage.include=` option per included file above (root-relative paths, e.g.
  `--coverage.include=apps/desktop/src/main/security.ts`) and `--coverage.reporter=json-summary
  --coverage.reporter=json`; test selection: all root Vitest projects (12 files, 738 tests).
- Run start/completion time and exit status: started 2026-11-16T18:25:28Z (local 19:25:28), duration
  1.84 s, exit 0.
- Generated report paths and report hashes/run identifier:
  `coverage/electron-shell-final/coverage-summary.json` (sha256 `bbeb3115edf4ea3b...dea458`),
  `coverage/electron-shell-final/coverage-final.json` (sha256 `db7d378a2ec01029...f8ea181`); git-ignored.
- Evidence outputs are fresh and inputs stayed unchanged: new report directory for this run; test file
  hashes identical before and after; no production change during the session. (An earlier run with
  workspace-relative includes from the wrong cwd matched 0/0 files and was discarded.)
- Final run after latest test additions and production fixes: yes (no production fixes were made).

Values below use covered/total (percentage); zero-denominator metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `apps/desktop/src/main/security.ts` | 50/50 (100%) | 27/27 (100%) | 12/12 (100%) | 44/44 (100%) |
| `apps/desktop/src/main/backend-host.ts` | 71/74 (95.94%) | 33/36 (91.66%) | 14/16 (87.5%) | 62/62 (100%) |
| `apps/desktop/src/main/handlers.ts` | 6/6 (100%) | N/A (0/0) | 5/5 (100%) | 5/5 (100%) |
| `apps/desktop/src/main/window.ts` | 0/25 (0%) | 0/4 (0%) | 0/8 (0%) | 0/23 (0%) |
| `apps/desktop/src/main/index.ts` | 0/46 (0%) | 0/14 (0%) | 0/17 (0%) | 0/40 (0%) |
| `apps/desktop/src/preload/bridge.ts` | 124/126 (98.41%) | 78/83 (93.97%) | 15/16 (93.75%) | 106/106 (100%) |
| `apps/desktop/src/preload/ports.ts` | 16/16 (100%) | 10/10 (100%) | 7/7 (100%) | 12/12 (100%) |
| `apps/desktop/src/preload/index.ts` | 0/12 (0%) | 0/6 (0%) | 0/5 (0%) | 0/10 (0%) |
| `packages/backend/src/server/rpc.ts` | 98/99 (98.98%) | 53/54 (98.14%) | 18/19 (94.73%) | 86/86 (100%) |
| `packages/backend/src/server/backend.ts` | 20/22 (90.9%) | 7/8 (87.5%) | 5/7 (71.42%) | 19/19 (100%) |
| `packages/backend/src/server/handlers.ts` | 26/26 (100%) | 4/4 (100%) | 8/8 (100%) | 25/25 (100%) |
| `packages/backend/src/server/ports.ts` | 10/11 (90.9%) | 2/2 (100%) | 5/6 (83.33%) | 7/8 (87.5%) |
| `packages/backend/src/server/protocol.ts` | 6/6 (100%) | 8/8 (100%) | 1/1 (100%) | 4/4 (100%) |
| `packages/backend/src/server/entry.ts` | 0/6 (0%) | 0/2 (0%) | 0/1 (0%) | 0/6 (0%) |
| `packages/backend/src/index.ts` | 1/1 (100%) | N/A (0/0) | N/A (0/0) | 1/1 (100%) |
| `packages/contract/src/backend.ts` | 4/4 (100%) | N/A (0/0) | N/A (0/0) | 4/4 (100%) |
| `packages/contract/src/app.ts` | 6/6 (100%) | N/A (0/0) | N/A (0/0) | 6/6 (100%) |
| `packages/contract/src/envelope.ts` | 10/10 (100%) | N/A (0/0) | N/A (0/0) | 10/10 (100%) |
| `packages/contract/src/index.ts` | 25/25 (100%) | 14/14 (100%) | 10/10 (100%) | 21/21 (100%) |

Aggregate, all 19 included files (summed counters): statements 473/571 (82.83%), branches 236/272
(86.76%), functions 100/138 (72.46%), lines 412/492 (83.73%). The 4 Electron-only glue files
(`main/index.ts`, `main/window.ts`, `preload/index.ts`, `server/entry.ts`) are measured at 0% by unit
tests: they import Electron or `process.parentPort` and run only in the Electron integration test,
which the V8 unit coverage does not instrument. Without them (15 files): statements 473/482
(98.13%), branches 236/246 (95.93%), functions 100/107 (93.46%), lines 412/413 (99.76%). No scoped
file is missing from the report. No task-level threshold is defined (`docs/ARCHITECTURE.md`: no
percentage enforced).

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `apps/desktop/src/main/index.ts:39-126`, `main/window.ts:23-62`, `preload/index.ts:11-28`, `packages/backend/src/server/entry.ts:7-15` | Electron wiring: protocol handler, CSP header hook, permission handlers, navigation hooks, window ports, preload `contextBridge`, utilityProcess entry | Exercised by `npm run test:electron -w apps/desktop` (7 tests pass: CSP header, exposed API only, pings, privileged isolation, cancel, window.open/navigation, backend kill/restart); not instrumented for coverage. Justified gap per parent instructions |
| `apps/desktop/src/main/backend-host.ts:66-67` | default `setTimeout`/`Date.now` when no timers are injected | Non-material: production defaults; the real timers run in the Electron test |
| `apps/desktop/src/main/backend-host.ts:135` (`pendingRestart` early return) | exit during a back-off wait | Defensive: during a wait `process` is undefined, so the stale-process guard on line 131 returns first; not reachable through the public API |
| `apps/desktop/src/preload/bridge.ts:59` (default `report`), `:77`/`:116` (`?? []` on the fixed queue map), `:213` (`settle` without pending) | defensive defaults | Non-material: both queue keys are created in the constructor and every `settle` caller checks pending first |
| `packages/backend/src/server/backend.ts:27` (default `log`), `:43` (initial no-op `stop`) | defaults | Non-material; the `onError` log path (`:52`) is now covered by "logs malformed renderer messages with the window id" |
| `packages/backend/src/server/ports.ts:30` (`close`) | closing a wrapped `MessagePortMain` | Non-material one-line delegation; used by main's `closePort` in the Electron test |
| `packages/backend/src/server/rpc.ts:81` (default `onError`) | default no-op | Non-material |

## Unable to test

- `npm run dev` (AC1 names it): not started here; it runs `ng serve` and an interactive Electron and
  does not terminate. The Electron integration test covers the same wiring with the built bundles.
  Follow-up: the parent may record this as skipped/assumed if the criterion requires `dev` literally.
- Headless `xvfb-run`: not installed on this machine; the Electron test ran against the desktop
  session display (as the task assumptions record).
- Electron-only glue files cannot be unit-tested without Electron; they are covered by the Electron
  integration test, not by coverage numbers.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. 58 tests added (1
updated), `npm run check` and the Electron integration test pass; remaining coverage gaps are the
Electron-only glue (covered by `test:electron`) and defensive defaults.

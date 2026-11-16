# Test Report

Date: 2026-11-16

Task: electron-shell - M0: Electron main, preload, backend utilityProcess and port broker

Scope: `git diff 2693efc..6dd230b -- . ':!tasks' ':!reviews'` (base `2693efc` = `origin/main`, task
commits 82b552e, 0526f2e, a42e950, 6cfe1a0, 6dd230b on branch `main`, supplied by the parent worker;
the branch was rebased since the first pass, which used base b93d0f2 and commits 89a69ae..18f97c6;
the production file list of the range is unchanged). This is the second pass, after the fixer's
commit 6dd230b (`reviews/electron-shell/fixes.md`). Working tree at measurement: HEAD 6dd230b plus
one uncommitted test change (`apps/desktop/test/app.electron.spec.ts`); no production changes.

Requirements:
- `tasks/electron-shell.md` acceptance criteria and recorded assumptions
- `docs/ARCHITECTURE.md` (CSP, Tests, Coverage), `docs/QUALITY.md` (report contract)
- Parent instructions (second pass: check whether 6dd230b's changes need tests, e.g. the
  `will-frame-navigate` handler)

## Test files changed

First pass (committed in 6cfe1a0):

- `apps/desktop/src/main/security.spec.ts`
- `apps/desktop/src/main/backend-host.spec.ts`
- `apps/desktop/src/main/handlers.spec.ts`
- `apps/desktop/src/preload/bridge.spec.ts`
- `packages/backend/src/server/rpc.spec.ts`
- `packages/backend/src/server/backend.spec.ts`
- `packages/contract/src/backend.spec.ts`

Second pass (uncommitted, for the parent to commit):

- `apps/desktop/test/app.electron.spec.ts`

No production file, configuration or existing assertion was changed or removed.

## Tests added or updated

Count: second pass 1 added (first pass: 58 added, 1 updated; fixer: 4 in `dev.electron.spec.ts`).

- app.electron.spec (1, new): "will-frame-navigate blocks subframe navigation and leaves the main
  frame to will-navigate". The fixer's guard (CR-5) is inline glue in `main/index.ts:63-66`
  (`!event.isMainFrame && blockNavigation(event)` plus a log line), so it cannot be unit-tested
  without Electron. A real iframe is refused by the CSP (`frame-src 'none'`) before the event fires,
  so the test drives the registered listeners on the real window's `webContents` with synthetic
  `will-frame-navigate` events through `app.evaluate`: a subframe event is `preventDefault`ed and
  logged as `[main] blocked frame navigation to https://frame.example.test/`, a main-frame event is
  not prevented and not logged, and the page stays on `thicket://app/index.html`. Without the 6dd230b
  listener the subframe assertion fails.

Reviewed without adding tests:

- `blockNavigation(event)` without url/current (the subframe call) was already unit-tested in
  `security.spec.ts` ("blocks when one URL is missing or unparsable", `blockNavigation(a)` -> true).
- `scripts/dev.mjs` `waitFor` failure path: a dev script that is not run by any test harness; the
  dev mechanism is covered by the fixer's `dev.electron.spec.ts`. Reading it: `stopAll` calls
  `process.exit` synchronously, so Electron is not started after a timeout. No test added (script, not
  production module; testing it would need a 120 s timeout or a change to the script).
- `scripts/build.mjs`, `security.ts`, `bridge.ts`, `protocol.ts`: comment-only changes.
- Fixer's `dev.electron.spec.ts` / `helpers.ts`: read; they run the dev path (ng serve + Electron with
  `THICKET_DEV_SERVER`), check CSP header incl. the dev server's `ws://localhost` port in `connect-src`, pings and no CSP console
  violations, and kill the `ng serve` process group. After my runs `pgrep -af "ng.js serve"` showed
  no leftover process.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: `app.ping` answered by main and `backend.ping` by the backend in a started Electron app (`npm run dev`) | `app.electron.spec.ts` "app.ping is answered by main, backend.ping by the backend process"; `dev.electron.spec.ts` (fixer: dev server URL, CSP, pings, no CSP violations); unit: handlers.spec, rpc.spec | `npm run test:electron -w apps/desktop` | Pass (2 files, 12 tests). `npm run dev` itself (interactive script) not started; its mechanism (ng serve + Electron with `THICKET_DEV_SERVER`) ran in `dev.electron.spec.ts` |
| AC2: sandbox, contextIsolation, no nodeIntegration, CSP; `window.open` and navigation blocked (unit tests on the handlers) | security.spec (all `secureWebPreferences`, `contentSecurityPolicy*`, `withCspHeader*`, `window.open and navigation` cases); Electron: "loads the renderer from thicket://app with the CSP header", "exposes only thicket.request/cancel/on and no Node APIs", "blocks window.open and navigation", "will-frame-navigate blocks subframe navigation ..." (new) | `npm run check`; `npm run test:electron -w apps/desktop` | Pass |
| AC3: killed backend detected, restarted, renderer receives `backend.restarted` | backend-host.spec restart tests; bridge.spec restart tests; Electron: "restarts a killed backend and tells the renderer" | `npm run check`; `npm run test:electron -w apps/desktop` | Pass |
| AC4: long backend request cancelled via `thicket.cancel(id)` answers `CANCELLED` | rpc.spec cancel tests; bridge.spec "Bridge: cancel races"; backend.spec "serves several renderer ports independently"; Electron: "cancels a long backend request with CANCELLED" | `npm run check`; `npm run test:electron -w apps/desktop` | Pass |
| AC5: privileged main-backend port exists (stub handler) and is not reachable from the renderer | handlers.spec, backend.spec, backend-host.spec, bridge.spec, contract backend.spec privileged tests; Electron: "the privileged main ↔ backend methods are not reachable from the renderer" | `npm run check`; `npm run test:electron -w apps/desktop` | Pass |

## Focused test execution

Command:

`npm run test:electron -w apps/desktop` (builds the bundles with `scripts/build.mjs`, then
`vitest run --config vitest.electron.config.ts`; Electron via playwright-core against the desktop
session display)

Result:

Pass: 2 files, 12 tests (app.electron.spec 8, dev.electron.spec 4), 5.07 s, on the final test file
(run twice; the second run after a lint fix replacing a non-null assertion with an explicit check).

## Full test execution

Command:

`npm run check` (eslint + Prettier, tsc for all workspaces, root `vitest run`, renderer `ng test`)

Result:

Pass: lint and Prettier clean, type checks pass, 738 Vitest tests in 12 files, renderer 181 tests in
5 files. (The first attempt failed on lint, `no-non-null-assertion` in my new test; fixed in the test
and re-run.)

## .taskcheck

Result:

Pass (`.taskcheck` runs `npm run check`; run above on the final snapshot).

## Bugs found

None. No test exposed a production defect.

First-pass observations are resolved by 6dd230b: `will-frame-navigate` is now registered (and tested
above); the `Bridge` buffering behaviour with `on(listener)` is now documented on `ThicketApi.on`.

## Coverage

Status: verified (fresh run on the final snapshot; exit 0; all tests passed)

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured (the configured tooling has no changed-line report).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `electron-shell`;
  base `2693efc` (origin/main); HEAD `6dd230be1460f24b70da49c207a692def35fe0a6`; commits
  82b552e..6dd230b supplied by the parent and matching `git diff --stat 2693efc..6dd230b` and the task
  `touches` list.
- Source/test snapshot identifier (including uncommitted inputs): HEAD 6dd230b, no production changes;
  one modified test file `apps/desktop/test/app.electron.spec.ts` (git blob `5e061263`, identical
  before and after the coverage run). The Electron test file is not part of the root Vitest run.
- Exact included files: `apps/desktop/src/main/{security,backend-host,handlers,window,index}.ts`,
  `apps/desktop/src/preload/{bridge,ports,index}.ts`,
  `packages/backend/src/server/{rpc,backend,handlers,ports,protocol,entry}.ts`,
  `packages/backend/src/index.ts`, `packages/contract/src/{backend,app,envelope,index}.ts`. Excluded:
  spec files, `test/*.ts`, `server/testing.ts` (test helpers), `apps/desktop/scripts/*.mjs`
  (build/dev scripts, run by `test:electron`), `vitest.electron.config.ts`, `package.json`,
  `tsconfig.json`, lockfile (configuration), `docs/ARCHITECTURE.md`. No renamed or deleted files.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with
  `@vitest/coverage-v8`; cwd repo root; `npx vitest run --coverage
  --coverage.reportsDirectory=coverage/electron-shell-pass2 --coverage.reporter=json-summary
  --coverage.reporter=json` plus one `--coverage.include=` option per included file, root-relative (e.g.
  `--coverage.include=apps/desktop/src/main/index.ts`);
  test selection: all root Vitest projects (12 files, 738 tests).
- Run start/completion time and exit status: started 2026-11-16 19:31:32 local, duration 1.84 s,
  exit 0.
- Generated report paths and report hashes/run identifier:
  `coverage/electron-shell-pass2/coverage-summary.json` (sha256 `00055204...4b097748`),
  `coverage/electron-shell-pass2/coverage-final.json` (sha256 `ff56be24...6f1fb569`); git-ignored.
- Evidence outputs are fresh and inputs stayed unchanged: new report directory for this run; test file
  hash identical before and after; no production change during the session.
- Final run after latest test additions and production fixes: yes (after the fixer's 6dd230b and my
  test addition).

Values below use covered/total (percentage); zero-denominator metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `apps/desktop/src/main/security.ts` | 50/50 (100%) | 27/27 (100%) | 12/12 (100%) | 44/44 (100%) |
| `apps/desktop/src/main/backend-host.ts` | 71/74 (95.94%) | 33/36 (91.66%) | 14/16 (87.5%) | 62/62 (100%) |
| `apps/desktop/src/main/handlers.ts` | 6/6 (100%) | N/A (0/0) | 5/5 (100%) | 5/5 (100%) |
| `apps/desktop/src/main/window.ts` | 0/25 (0%) | 0/4 (0%) | 0/8 (0%) | 0/23 (0%) |
| `apps/desktop/src/main/index.ts` | 0/49 (0%) | 0/18 (0%) | 0/18 (0%) | 0/43 (0%) |
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

Aggregate, all 19 included files (summed counters): statements 473/574 (82.40%), branches 236/276
(85.50%), functions 100/139 (71.94%), lines 412/495 (83.23%). The 4 Electron-only glue files
(`main/index.ts`, `main/window.ts`, `preload/index.ts`, `server/entry.ts`) are measured at 0% by unit
tests: they import Electron or `process.parentPort` and run only in the Electron integration tests,
which the V8 unit coverage does not instrument. Without them (15 files): statements 473/482
(98.13%), branches 236/246 (95.93%), functions 100/107 (93.46%), lines 412/413 (99.76%). The only
change against the first pass is `main/index.ts` (+3 statements, +4 branches, +1 function, +3 lines
from the `will-frame-navigate` listener). No scoped file is missing from the report. No task-level
threshold is defined (`docs/ARCHITECTURE.md`: no percentage enforced).

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `apps/desktop/src/main/index.ts:39-131`, `main/window.ts`, `preload/index.ts`, `packages/backend/src/server/entry.ts` | Electron wiring: protocol handler, CSP header hook, permission handlers, navigation hooks (incl. the new `will-frame-navigate` guard, `index.ts:63-66`), window ports, preload `contextBridge`, utilityProcess entry | Exercised by `npm run test:electron -w apps/desktop` (12 tests, incl. the new frame-navigation test and the fixer's dev-path tests); not instrumented for coverage. Justified gap |
| `apps/desktop/src/main/backend-host.ts:66-67` | default `setTimeout`/`Date.now` when no timers are injected | Non-material: production defaults; the real timers run in the Electron test |
| `apps/desktop/src/main/backend-host.ts:135` (`pendingRestart` early return) | exit during a back-off wait | Defensive: during a wait `process` is undefined, so the stale-process guard returns first; not reachable through the public API |
| `apps/desktop/src/preload/bridge.ts` defaults (`report`, `?? []` on the fixed queue map, `settle` without pending) | defensive defaults | Non-material: both queue keys are created in the constructor and every `settle` caller checks pending first |
| `packages/backend/src/server/backend.ts` (default `log`, initial no-op `stop`) | defaults | Non-material |
| `packages/backend/src/server/ports.ts:30` (`close`) | closing a wrapped `MessagePortMain` | Non-material one-line delegation; used by main's `closePort` in the Electron test |
| `packages/backend/src/server/rpc.ts` (default `onError`) | default no-op | Non-material |
| `apps/desktop/scripts/dev.mjs:53-59` (new `waitFor` failure path) | `ng serve` stopped when startup times out | Script outside the coverage scope; not run by a test (would need a 120 s timeout); reviewed by reading, see above |

## Unable to test

- `npm run dev` itself: interactive and long-running, not started. Its mechanism is run by the fixer's
  `dev.electron.spec.ts` (Pass). The parent may record the literal `npm run dev` as assumed/skipped.
- `dev.mjs` startup-timeout cleanup: not tested (see coverage table); no follow-up needed beyond the
  code review.
- Real subframe navigation: a real iframe is refused by the CSP before `will-frame-navigate` fires, so
  the guard is tested with synthetic events on the real `webContents` listeners.
- Headless `xvfb-run`: not installed; the Electron tests ran against the desktop session display.

## Summary

Tests added and all validation passed. One Electron integration test added for the fixer's
`will-frame-navigate` guard; `npm run check` and `npm run test:electron -w apps/desktop` (12 tests)
pass; task-scoped coverage re-measured on 6dd230b with no production defects found.

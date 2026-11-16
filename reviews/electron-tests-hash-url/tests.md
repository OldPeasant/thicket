# Test Report

Date: 2026-11-16

Task: electron-tests-hash-url - Fix npm run test:electron: 5 specs expect the URL without the router's #/ (pre-existing on main)

Scope: base 05d2ce25865280d4dbef57652bc2f441c334fa53 .. HEAD d8a728227b582cf90b6ed2afdc83d2584343f63f
(task commit d8a7282; the parent named 2be44e9, which is the same change before the rebase:
`git diff 2be44e9 d8a7282` differs only in `tasks/electron-tests-hash-url.md`), plus the
uncommitted test-writer edit to `apps/desktop/test/app.electron.spec.ts` described below.
Changed files in the task: `apps/desktop/test/app.electron.spec.ts`, `dev.electron.spec.ts`,
`secrets.electron.spec.ts`, `helpers.ts` (new `startupOutput`), `tasks/electron-tests-hash-url.md`.
No production source changed.

Requirements:
- `tasks/electron-tests-hash-url.md` acceptance criterion and notes (incl. the recorded assumption)
- `docs/ARCHITECTURE.md` "Coverage", `docs/QUALITY.md`, `AGENTS.md`
- Production behaviour referenced by the specs: `apps/desktop/src/main/index.ts` (startup log
  `[main] secret storage: <level> (<backend>)`, window URL `thicket://app/index.html`)

## Test files changed

- `apps/desktop/test/app.electron.spec.ts`

## Tests added or updated

Count: 1 (updated: `profiles.secretStorage reports the real safeStorage backend`)

Assessment of the task's changes:
- `APP_URL = /^thicket:\/\/app\/(index\.html)?(#\/)?$/` is not too lax. Checked with node: it accepts
  `thicket://app/index.html`, `thicket://app/#/`, `thicket://app/index.html#/`, `thicket://app/`, and
  rejects `https://example.com/`, `thicket://evil/index.html`, `thicket://app/index.html?x=1`,
  `thicket://app/index.html#/x`, `thicket://app/frame.html`, `about:blank`. The navigation-blocking
  tests therefore still fail if a navigation to another origin or page succeeds. The bare
  `thicket://app/` form is still the same app document (`resolveAppFile` serves index.html for it).
- `dev.electron.spec.ts` accepts exactly `${devServer}/` or `${devServer}/#/`: strict.
- `secrets.electron.spec.ts` now creates a real profile via `profiles.save` and uses its id. It
  still checks that neither the secret nor the profile id appear in plain text in `secrets.bin`, and
  that the restart and clearSecret path works. The test is not weaker.
- Startup-log check: main logs the backend at startup, before Playwright attaches its stdout
  listeners. A separate direct start (`startupOutput`, fresh temp `THICKET_USER_DATA`) is a
  meaningful substitute: it checks that main really prints the line, with the same level the IPC
  reports. Weakness fixed by the test-writer: the wait pattern `/\[main\] secret storage: \S+/`
  could match a chunk that splits inside the level word (e.g. `we` of `weak`). The `toContain`
  would then fail at random. The pattern now waits for the whole line
  `/\[main\] secret storage: \S+ \([^)\n]*\)/`. The assertion is now
  `toContain('[main] secret storage: <level> (')`, so it also checks the word boundary of the level.
- `startupOutput` settles once (timeout, early exit and spawn error all reject with the output so
  far) and kills the child. After the run, `pgrep -fa agent-2/node_modules/electron` showed no
  leftover Electron processes.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| `npm run test:electron` (Linux, headless) -> all specs pass | all 26 tests in the 5 `apps/desktop/test/*.electron.spec.ts` files, including the 7 fixed ones (app: CSP/URL, secretStorage, window.open/navigation, will-frame-navigate; dev: loads from dev server; secrets: setSecret, restart) | `npm run test:electron` (repo root, no DISPLAY, so headless Ozone via `headlessArgs()`; no xvfb-run available) | Pass: 5 files, 26 passed |

## Focused test execution

Command:

`cd apps/desktop && npx vitest run --config vitest.electron.config.ts --reporter=verbose`

Result:

Pass: 26 passed (26), each test listed with a checkmark.

## Full test execution

Command:

`npm run test:electron` (renderer build, desktop build, Electron suite), then `npm run check`

Result:

Pass. test:electron: Test Files 5 passed, Tests 26 passed (started 20:53:47, 16.7 s).
check: lint (eslint --max-warnings 0 and prettier --check), typecheck, then root vitest
(37 files, 2317 tests passed) and renderer `ng test` (30 files, 511 tests passed). `check` chains
its steps with `&&`, so reaching the final renderer step means lint and typecheck passed too.
The edited file was also checked on its own with `npx prettier --check` and
`npx eslint --max-warnings 0 apps/desktop/test`: clean.

## .taskcheck

Result:

Pass (`.taskcheck` runs `npm run check`; result above).

## Bugs found

None. All 7 failures came from outdated test expectations: the hash-router URL, the startup log
line being emitted before Playwright attaches, and `setSecret` now rejecting unknown profile ids
with NOT_FOUND. None of them is a production defect.

## Coverage

Status: not applicable. The task changes no production source. Every changed file is Electron
integration-test code (`apps/desktop/test/*.electron.spec.ts`, `apps/desktop/test/helpers.ts`).

Metric: whole-file coverage of task-changed production files: N/A, the scope is empty.
Changed-line coverage: not measured (no production lines changed).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: electron-tests-hash-url;
  base 05d2ce25865280d4dbef57652bc2f441c334fa53; HEAD d8a728227b582cf90b6ed2afdc83d2584343f63f;
  task commit d8a7282 (`git diff --stat 05d2ce2..HEAD`), matches the task's `touches: [apps/desktop/test]`.
- Source/test snapshot identifier (including uncommitted inputs): HEAD d8a7282 plus the modified
  `apps/desktop/test/app.electron.spec.ts` (sha256 64628d6c378752a21b0a300861192f37c7b0ba51f5d69bc3a7fb7339834636b9).
- Exact included files; renamed/deleted/excluded files and reasons: no production files are
  included. Excluded: the 4 test/helper files, because they are tests. The unit coverage
  (`@vitest/coverage-v8`, `npm run coverage`) does not instrument them, and the Electron suite
  (`vitest.electron.config.ts`) has no coverage configured. Also excluded:
  `tasks/electron-tests-hash-url.md` (task metadata).
- Provider/version, command, working directory, and test selection: none run. No coverage
  measurement applies to an empty production scope.
- Run start/completion time and exit status: N/A.
- Generated report paths and report hashes/run identifier: N/A.
- Evidence outputs are fresh and inputs stayed unchanged: the test runs above used the snapshot
  listed above.
- Final run after latest test additions and production fixes: yes. `npm run test:electron` and
  `npm run check` ran after the test-writer edit, and there were no production fixes.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| (no production files in scope) | N/A | N/A | N/A | N/A |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `apps/desktop/test/helpers.ts` `startupOutput` timeout / early-exit / spawn-error branches | Diagnostics when the app fails to print the startup line | Not exercised in the passing run (only the match path runs). This is test-helper code, not measured. No test was added, because testing test helpers is not worth it here. |

## Unable to test

- xvfb-run (a real X display) path: not available here. Only the headless Ozone path was run.
  The criterion allows either ("headless or xvfb-run").
- Non-Linux platforms: not available. The secrets spec is `linuxOnly`.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. One small robustness
improvement was made to the startup-log wait pattern in `app.electron.spec.ts` (uncommitted, for
the parent to review and commit). `npm run test:electron` passes 26/26 and `npm run check` passes.

# Test Report

Date: 2026-11-16

Task: electron-tests-hash-url - Fix npm run test:electron: 5 specs expect the URL without the router's #/ (pre-existing on main)

Scope: round 2, final code. Base 05d2ce25865280d4dbef57652bc2f441c334fa53 .. HEAD
c307e38769642f6d4e196caa6dacab505131c008. Task commits: d8a7282 (spec fixes and new
`startupOutput` helper), 476778c (round-1 reports, plus the test-writer's full-line startup
pattern), c307e38 (fixer CR-1: `startupOutput` settles only after the child exits, with SIGKILL
after 5 s). Changed code files: `apps/desktop/test/app.electron.spec.ts`, `dev.electron.spec.ts`,
`secrets.electron.spec.ts`, `helpers.ts`. Other changed files: `tasks/electron-tests-hash-url.md`
and `reviews/electron-tests-hash-url/*`. No production source changed. The test-writer made no
code changes in round 2.

Requirements:
- `tasks/electron-tests-hash-url.md` acceptance criterion and notes (incl. the recorded assumption)
- `reviews/electron-tests-hash-url/review.md` CR-1/CR-2 and `fixes.md`
- `docs/ARCHITECTURE.md` "Coverage", `docs/QUALITY.md`, `AGENTS.md`
- Production behaviour referenced by the specs: `apps/desktop/src/main/index.ts` (startup log
  `[main] secret storage: <level> (<backend>)`, window URL `thicket://app/index.html`)

## Test files changed

- None in round 2. Round 1 changed `apps/desktop/test/app.electron.spec.ts` (startup-log wait
  pattern). That change is committed in 476778c.

## Tests added or updated

Count: 0 in round 2 (1 updated in round 1: `profiles.secretStorage reports the real safeStorage backend`)

Re-check of the changed behavior (`startupOutput`, `apps/desktop/test/helpers.ts:56-105`), by code
reading:
- Match path: `finish()` sets `settled`, clears the timeout, sends SIGTERM, and arms a 5 s SIGKILL
  timer. It resolves only on the child's `exit` event, and then clears the SIGKILL timer. The
  caller's `rm(userData)` in `finally` (`app.electron.spec.ts:103`) therefore runs after Electron
  is gone. This fixes CR-1.
- Early exit (before the match): the `exit` handler sets `exited = true`, so `finish` rejects at
  once with the "app exited" message and does not send a kill. Correct.
- Timeout: same as the match path, but it rejects after the exit. The `exit` handler's later
  `finish()` is a no-op because of `settled`. Correct.
- Spawn failure (`error` without a pid): it settles at once, so it does not wait for an `exit`
  that never comes. Correct.
- `error` with a pid (for example, a failed kill signal): it waits for `exit`. The
  SIGKILL fallback bounds the wait. Acceptable.
- Remaining limit (not a defect): if SIGKILL also fails to end the process, the promise never
  settles. Vitest's test timeout would then fail the test. There is no silent hang beyond the
  runner timeout.
- The resolve value, the error messages and the default timeout are unchanged.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| `npm run test:electron` (Linux, headless or xvfb-run) -> all specs pass | all 26 tests in the 5 `apps/desktop/test/*.electron.spec.ts` files, including the 7 fixed ones (app: CSP/URL, secretStorage, window.open/navigation, will-frame-navigate; dev: loads from dev server; secrets: setSecret, restart) | `npm run test:electron` (repo root, HEAD c307e38, no DISPLAY, so headless Ozone via `headlessArgs()`; no xvfb-run) | Pass: Test Files 5 passed, Tests 26 passed (start 20:58:41, 21.0 s) |

## Focused test execution

Command:

`npm run test:electron` (renderer build, desktop build, then `vitest run --config vitest.electron.config.ts`)

Result:

Pass: 5 files, 26 tests. Afterwards, `pgrep -af agent-2/node_modules/electron` matched only the
pgrep shell itself, so no Electron processes were left over.

## Full test execution

Command:

`npm run check`

Result:

Pass. Lint and typecheck passed (`check` chains its steps with `&&`, and the run reached the last
step). Root vitest: 37 files, 2317 tests passed. Renderer `ng test`: 30 files, 511 tests passed.

## .taskcheck

Result:

Pass (`.taskcheck` runs `npm run check`; result above).

## Bugs found

None. All 7 original failures came from outdated test expectations: the hash-router URL, the
startup line printed before Playwright attaches its listeners, and `setSecret` rejecting unknown
profile ids with NOT_FOUND. CR-1 was a test-helper robustness issue, now fixed. Neither is a
production defect.

## Coverage

Status: not applicable. The task changes no production source. Every changed code file is Electron
integration-test code (`apps/desktop/test/*.electron.spec.ts`, `apps/desktop/test/helpers.ts`).

Metric: whole-file coverage of task-changed production files: N/A, the scope is empty.
Changed-line coverage: not measured (no production lines changed).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: electron-tests-hash-url;
  base 05d2ce25865280d4dbef57652bc2f441c334fa53; HEAD c307e38769642f6d4e196caa6dacab505131c008;
  task commits d8a7282, 476778c, c307e38 (plus the TFP-metadata commit 0878900), from
  `git log`/`git diff --stat 05d2ce2..HEAD`. They match the task's `touches: [apps/desktop/test]`.
- Source/test snapshot identifier (including uncommitted inputs): HEAD c307e38. The test/helper
  files have no uncommitted changes (`helpers.ts` sha256
  2790f79ac9a1f786ebedb0bbf8ea874199f921eedc1f0d9e620d3091d8da1711, `app.electron.spec.ts` sha256
  64628d6c378752a21b0a300861192f37c7b0ba51f5d69bc3a7fb7339834636b9). The only uncommitted file
  at measurement time was `reviews/electron-tests-hash-url/review.md`, a report, not tested code.
- Exact included files; renamed/deleted/excluded files and reasons: no production files are
  included. Excluded: the 4 test/helper files, because they are tests. The unit coverage
  (`@vitest/coverage-v8`, `npm run coverage`) does not instrument them, and the Electron suite has
  no coverage configured. Also excluded: `tasks/` and `reviews/` files (metadata and reports).
- Provider/version, command, working directory, and test selection: none run. No coverage
  measurement applies to an empty production scope.
- Run start/completion time and exit status: N/A for coverage. The test runs above passed.
- Generated report paths and report hashes/run identifier: N/A.
- Evidence outputs are fresh and inputs stayed unchanged: both test runs used HEAD c307e38 with no
  code changes during or after the runs.
- Final run after latest test additions and production fixes: yes. The runs are after the CR-1 fix
  (c307e38). There were no production fixes.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| (no production files in scope) | N/A | N/A | N/A | N/A |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `apps/desktop/test/helpers.ts` `startupOutput` timeout / early-exit / spawn-error / SIGKILL-fallback branches | Diagnostics and cleanup when the app fails to print the startup line or does not quit on SIGTERM | Only the match + SIGTERM path runs in the passing suite. The other branches were checked by reading the code (see above). This is test-helper code and is not measured. No test was added: testing test helpers is not worth it here. |

## Unable to test

- xvfb-run (a real X display) path: not available here. Only the headless Ozone path was run.
  The criterion allows either ("headless or xvfb-run").
- Non-Linux platforms: not available. The secrets spec is `linuxOnly`.
- Leftover `thicket-electron-startup-*` temp folders after the run: not checked, because shell
  access to list `/tmp` was denied in this session. The code path (`rm` in `finally`, after child
  exit) was checked by reading the code.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. The CR-1 change to
`startupOutput` is correct. On the final revision c307e38, `npm run test:electron` passes 26/26
headless, `npm run check` passes, and no Electron processes were left over.

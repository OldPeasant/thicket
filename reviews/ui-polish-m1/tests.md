# Test Report

Date: 2026-11-17

Task: ui-polish-m1 - Round the Test connection latency; status bar shows the active tab's connection

Scope: base afc246447ca97f791328ed3b9b9f06f1e92ea347 (claim commit). The implementation was written as
cedbb43da527dc10a248387621856867c07e2ba6. During testing the parent's `git pull --rebase`
(2026-11-17 06:21:32 +0100) rebased it to 5ac43fd51855d435236e194b4461c51ba54733e8. Both have the same
`git patch-id --stable` (fbb0d61edf6a9dcd6193c5179194d19e8d1c9626), and
`git diff cedbb43d HEAD` is empty for all four production files. Measured HEAD:
e2c8a06bfdb30ceabcd7b004d6545315f56063f0. The only later task commit adds a task file.

Requirements:
- tasks/ui-polish-m1.md acceptance criteria 1 and 2
- docs/ARCHITECTURE.md "Coverage" (task-scoped renderer coverage command)
- Parent instructions (the e2e m1 suite was already run by the parent: `npm run test:e2e -- m1` -> 1 passed; not re-run here)

## Test files changed

- `packages/renderer/src/app/connections/connection-editor.spec.ts`
- `packages/renderer/src/app/layout/status-bar.spec.ts`
- `packages/renderer/src/app/layout/app-shell.spec.ts`

## Tests added or updated

Count: 16. All are new: 7 parameterized latency cases, 3 StatusBar input tests and 6 AppShell edge-case tests. No existing test was changed.

- connection-editor.spec.ts: `Test connection latency %s ms is shown as "%s ms"` (it.each). Cases: 0 -> "< 1",
  0.49 -> "< 1", 0.5 -> "1", 1.49 -> "1", 1.5 -> "2", 12 -> "12" and 1234.56 -> "1235". Each case also checks the
  whole sentence "Connected in X ms to MongoDB 8.2.1".
- status-bar.spec.ts `connection input`:
  - shows the input connection instead of the status service's (name, state, dot, flags, host classes);
  - shows the input connection when the status service has none;
  - falls back to the status service's connection when the input is cleared (flags and host classes reset, then "No connection").
- app-shell.spec.ts `active tab connection edge cases`:
  - a tab of an unknown profile shows the status service's connection;
  - a non-string profileId is not looked up;
  - the active tab's connection wins over the status service's;
  - a profile without a known connection state is shown as disconnected;
  - uses the profile's production flag when the tab has none, and the tab's (false) flag otherwise;
  - switching between tabs of two profiles follows the active one.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: Test connection shows the latency rounded (unit test) | `Test connection shows the latency rounded to whole milliseconds` (parent's test); `Test connection latency %s ms is shown as "%s ms"` (7 cases) | `cd packages/renderer && npx ng test --include='src/app/layout/status-bar.spec.ts' --include='src/app/layout/app-shell.spec.ts' --include='src/app/connections/connection-editor.spec.ts'` | Pass |
| AC2: an active collection tab of a connected profile shows that connection in the status bar (unit test) | `shows the active collection tab's connection and follows its state` (parent's test); the 6 `active tab connection edge cases`; the 3 StatusBar `connection input` tests | same command | Pass |
| AC2: the m1 e2e suite still passes | none added | `npm run test:e2e -- m1` (run by the parent, not by me) | Not run by test-writer: parent reports 1 passed |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/app/layout/status-bar.spec.ts' --include='src/app/layout/app-shell.spec.ts' --include='src/app/connections/connection-editor.spec.ts'`

Result:

Pass: 3 files, 191 tests.

## Full test execution

Command:

`cd packages/renderer && npx ng test --coverage --coverage-include='src/app/layout/app-shell.ts' --coverage-include='src/app/layout/status-bar.ts' --coverage-include='src/app/connections/connection-editor.ts'` (runs the whole renderer suite)

Result:

Pass: 102 files, 3373 tests.

## .taskcheck

Result:

Pass. `.taskcheck` runs `npm run check` (lint && typecheck && test). Root vitest: 84 files, 4417 tests passed. Renderer: 102 files, 3373 tests passed.

## Bugs found

None.

## Coverage

Status: verified

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: 15/15 executable lines on changed lines are covered (100%). Method: I intersected the lcov `DA` entries
with the added/modified lines in `git diff -U0 afc24644 cedbb43d`. The changed executable lines are connection-editor.ts
345-346, app-shell.ts 122, 124 and 173-179, and status-bar.ts 26, 174, 176 and 178. No `DA:<line>,0` entry falls in
any changed range. I did not measure changed-branch coverage.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: ui-polish-m1. Base afc246447ca97f791328ed3b9b9f06f1e92ea347. Measured HEAD e2c8a06bfdb30ceabcd7b004d6545315f56063f0. Task commit 5ac43fd5 (the rebased cedbb43d, same patch-id). The parent supplied the scope, and I checked it against `git show --stat cedbb43d`.
- Source/test snapshot identifier (including uncommitted inputs): HEAD e2c8a06b with production files unmodified. Uncommitted spec files (sha256):
  - app-shell.spec.ts 959af6d5a144d22f16e42adf7e83b980c726e816fc9ebc4d5c5bad170f6328a2;
  - status-bar.spec.ts 31e65db8eee49c440845e72228f580acd8c2360f2c2472ead0101298adc7dc95;
  - connection-editor.spec.ts 82f7a3adb64d6b2f1e04227ab5eab68ea2b7910c87f1a11bafe79170402c82e4.
- Exact included files; renamed/deleted/excluded files and reasons:
  - Included: `packages/renderer/src/app/connections/connection-editor.ts`, `packages/renderer/src/app/layout/app-shell.ts` and `packages/renderer/src/app/layout/status-bar.ts`.
  - Excluded: `packages/renderer/src/app/connections/connection-editor.html`. It is an Angular template, and V8 coverage does not instrument it. Its one changed binding (`latency(t.result.latencyMS)`) runs in the rendered DOM in the latency tests.
  - No renamed or deleted files.
- Provider/version, command, working directory, and test selection: Vitest v5.1.0 with v8 coverage, via `npx ng test --coverage --coverage-include=...` (above). Working directory: `packages/renderer`. Test selection: the whole renderer suite.
- Run start/completion time and exit status: started 2026-11-17 06:23:06 +0100, report written 06:24:14. All tests passed and the summary printed.
- Generated report paths and report hashes/run identifier:
  - `packages/renderer/coverage/renderer/coverage-summary.json`, sha256 4ce7ce13331ad277e548a10e9c99a3f09aae1c8cda7dcba0746f02130edbc47e;
  - `packages/renderer/coverage/renderer/lcov.info`, sha256 835ff0017cd34857f6b8226c8157915919cfe1151e0e9625945a0806ed503800.
- Evidence outputs are fresh and inputs stayed unchanged: yes. The report files are timestamped 06:24:14, after the run started. The rebase finished at 06:21:32, before the focused run, the coverage run and `.taskcheck`. The production files are identical between cedbb43d and HEAD, and the spec files were not edited after the coverage run.
- Final run after latest test additions and production fixes: yes. No production fixes were made.

Values below use covered/total (percentage).

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/connections/connection-editor.ts` | 506/513 (98.63%) | 262/286 (91.60%) | 154/154 (100%) | 417/419 (99.52%) |
| `packages/renderer/src/app/layout/app-shell.ts` | 131/132 (99.24%) | 86/86 (100%) | 26/27 (96.29%) | 98/98 (100%) |
| `packages/renderer/src/app/layout/status-bar.ts` | 55/55 (100%) | 25/26 (96.15%) | 5/5 (100%) | 33/33 (100%) |
| Aggregate (summed counters, the 3 files above; the .html template is excluded) | 692/700 (98.85%) | 373/398 (93.71%) | 185/186 (99.46%) | 548/550 (99.63%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `status-bar.ts:179` (falsy branch of `conn ? STATE_TEXT[conn.state] : ''`) | None. The template only reads `stateText()` inside `@if (shown(); as conn)`, so this branch never runs. The line itself is unchanged by the task. | Left uncovered: defensive and unreachable. |
| `app-shell.ts:137` (`anonymous_26`, `viewChild.required(TabBar)`) | Older code, outside the task | Left uncovered: not part of this task. |
| `connection-editor.ts:322, 499` and 24 branches (lines 226-851) | Older connection-editor code, outside the task. None is in the changed `latency()` method (lines 343-348). | Left uncovered: not part of this task. |

## Unable to test

- The m1 e2e suite (AC2's e2e part) was not run by the test-writer, as the parent asked. The parent reports `npm run test:e2e -- m1` -> 1 passed.
- Not tested: non-finite or negative latency values (NaN would show "NaN ms"). The backend contract supplies a measured duration, and the task does not define behavior for such values, so no follow-up is needed.

## Summary

Tests added and all validation passed. Task-scoped coverage is sufficient, and no production defects were found.

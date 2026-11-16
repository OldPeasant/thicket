# Test Report

Date: 2026-11-16

Task: app-settings - M0: Settings store in main (settings.json, app.* methods)

Scope: `git diff e46732c98118f1cae207337fdc22e418298430c0..HEAD` on branch `main`, HEAD
21f43f03461a44f196c162b31862f9341e283a0c (second pass, after the CR-1 fix). Task-owned commits:
3613a30 (settings store), 2e365ba (handlers, broadcast, Electron test), b21a38b (docs only),
6f8d535 (first-pass tests and review), 21f43f0 (CR-1 fix: an unreadable settings.json is moved to
`settings.json.unreadable-<time>` before the first write, and the write is refused if that move
fails). Uncommitted input: `apps/desktop/src/settings/store.spec.ts`, which has the 5 tests added in
this pass. No production file had uncommitted changes. `reviews/app-settings/review.md` was also
uncommitted. The code-reviewer changed it in parallel. This helper did not touch it.

Requirements:
- `tasks/app-settings.md` acceptance criteria 1-3 and the recorded assumptions (layout
  `{version:1, settings:{...}}`, invalid known values fall back to the default, unparseable or
  wrong-layout files count as corrupt, the event is sent only when a value changes,
  `THICKET_USER_DATA`)
- `reviews/app-settings/review.md` finding CR-1 and `reviews/app-settings/fixes.md` (the expected
  behavior of the fix)
- `docs/QUALITY.md` (report contract), `docs/ARCHITECTURE.md` "Coverage", `AGENTS.md`

## Test files changed

- `apps/desktop/src/settings/store.spec.ts` (first pass and second pass)
- `apps/desktop/src/main/handlers.spec.ts` (first pass)
- `apps/desktop/src/main/broadcast.spec.ts` (first pass)
- `packages/contract/src/index.spec.ts` (first pass)

## Tests added or updated

Count: 25 test cases across both passes. The first pass added 20, committed in 6f8d535. This pass
adds 5. The fixer also added 3 CR-1 regression tests in 21f43f0. No existing test was changed or
weakened.

This pass adds 5 tests to `describe('SettingsStore unreadable file')` in store.spec.ts. They cover
edge cases of the CR-1 fix:
- `a set that changes nothing or is invalid leaves the unreadable file in place; a real change still moves it`.
  A no-op set and a schema-refused set do not move the file aside and do not clear the flag. The
  next real change still makes the backup.
- `concurrent sets on an unreadable file make one backup and end with the last change`. Three sets
  queued together make exactly one `.unreadable-` backup, which holds the original content. The
  file ends with the last values, and the listener is called 3 times.
- `a write that fails after the move keeps the backup; the retry writes without a second backup`.
  The move succeeds, then the temp write fails (disk full). `set()` rejects and the settings stay
  the defaults. The backup holds the original, and settings.json is absent. The retry writes the
  file and makes no second backup. A clock that advances on each call proves that no second
  backup is attempted, not just that two backups shared the same name.
- `a read error without an error code is treated as unreadable: the first set moves the file aside`.
- `with the real fs, a settings.json that is a directory (EISDIR) is moved aside on the first set`.
  This runs end to end on the real file system with no injected fs. The directory and its content
  are kept under the backup name.

The fixer's 3 CR-1 tests were reviewed and are sound. They cover the backup on the first set (only
once), ENOENT on the move, and a failed move (EBUSY), with retry: the set is rejected, nothing is
written, nobody is notified, and the next set succeeds.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 unit: defaults | `SettingsStore defaults` (4) + `no stale temp file: nothing is logged` | `npx vitest run --project desktop --project contract` | Pass |
| AC1 unit: unknown keys dropped | `SettingsStore unknown keys` (4, incl. `__proto__`/`constructor`); handlers `extra` key refused | `npx vitest run --project desktop --project contract` | Pass |
| AC1 unit: corrupt file -> defaults + backup | `%s -> defaults, the bad file is kept as a backup` (6), `%s -> treated as corrupt` (6), `cannot be moved aside`, `without an injected clock...`, `read error without an error code`, `a file that cannot be read (not ENOENT)...` | `npx vitest run --project desktop --project contract` | Pass |
| AC1 / CR-1: an unreadable (non-ENOENT) file is not lost on the first write | fixer's 3 tests + this pass's 5 tests in `SettingsStore unreadable file` | `npx vitest run --project desktop --project contract` | Pass |
| AC2 atomic writes, crash between write and rename | `writes to a temp file and renames it`, `a crash between write and rename keeps the previous file`, `a crash before the first file existed`, `torn temp`, `queued behind a failed one`, `stale temp file that cannot be removed`, `a write that fails after the move keeps the backup...` | `npx vitest run --project desktop --project contract` | Pass |
| AC3 renderer gets app.settings.changed after a set (Electron harness) | `apps/desktop/test/settings.electron.spec.ts` `the renderer gets app.settings.changed after app.settings.set` (+4 others in that file) | `npm run test:electron` (repo root; builds renderer + desktop, runs Electron via Playwright `_electron`) | Pass (3 files, 17 tests) |
| AC3 supporting: handler + broadcast wiring, payload schema | handlers `a set over the port saves, answers and broadcasts one valid app.settings.changed`; contract `the app.settings.changed payload carries the full, valid settings`; broadcast tests | `npx vitest run --project desktop --project contract` | Pass |
| Assumption: event only when a value changes; invalid values change nothing | store `notifies listeners...`, `a set() with an invalid value is refused`, handlers integration test, Electron `invalid settings are refused` | both commands above | Pass |

## Focused test execution

Command:

`npx vitest run --project desktop apps/desktop/src/settings/store.spec.ts`, then
`npx vitest run --project desktop --project contract` (repo root)

Result:

Pass. store.spec.ts: 48 tests. Desktop + contract: 10 files, 761 tests. That is 756 at 21f43f0
plus the 5 added in this pass.

## Full test execution

Command:

`npm run check` (repo root: eslint + prettier, tsc in every workspace, vitest for all projects,
renderer `ng test`) and `npm run test:electron` (repo root)

Result:

Pass. `npm run check`: lint and typecheck passed (they are chained before the tests). Vitest ran 22
files / 1326 tests, and the renderer ran 5 files / 181 tests. `npm run test:electron`: 3 files, 17
tests.

## .taskcheck

Result:

Pass. `.taskcheck` runs `npm run check`, which passed on the final snapshot (see above). It was not
run as a separate command.

## Bugs found

None. Every new test passed against the unchanged production code at 21f43f0. CR-1 is fixed as
`fixes.md` describes, and no new defect was found in the fix.

Observation, not a defect: if the move succeeds and the following temp write fails, settings.json
is absent until the next successful set. A restart in that window starts with the defaults. The
user's data is kept in `settings.json.unreadable-<time>`, and on that start the file could not
have been read anyway. This matches the intent of CR-1 (do not destroy the file), so no fix is
requested. The test `a write that fails after the move keeps the backup...` pins this behavior.

## Coverage

Status: verified

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured. The configured reporters (text-summary, json-summary, lcov)
give no diff-aware result. All three files are new in this task and each is at 100%, so
changed-line coverage of these files can be no lower.

Evidence:
- Task id: app-settings. Immutable base: e46732c98118f1cae207337fdc22e418298430c0. Measured HEAD: 21f43f03461a44f196c162b31862f9341e283a0c. Task ownership comes from the parent-supplied base and commit list, checked against `git log e46732c..HEAD` and `git show --stat 21f43f0`.
- Source/test snapshot (sha256 prefix): store.ts ac2e6a02539e54c0, broadcast.ts 9bc5ab0641d63d6f, handlers.ts 37dedca5be05fb6a, store.spec.ts b0a46e7e2f6367e9 (uncommitted, includes this pass's tests), broadcast.spec.ts 226d5fecfac33d7e, handlers.spec.ts c79a2f266ef7a858, contract index.spec.ts f3f0eb81464cdf4b. The hashes were taken before the runs and checked again after `npm run check` and `npm run test:electron`. Nothing changed.
- Included: `apps/desktop/src/settings/store.ts`, `apps/desktop/src/main/broadcast.ts`, `apps/desktop/src/main/handlers.ts`. Excluded:
  - `apps/desktop/src/main/index.ts` and `window.ts`: Electron entry and window wiring. They import `electron`, so unit vitest cannot load them. The Electron harness (AC3) exercises them but collects no coverage.
  - `packages/contract/src/app.ts` and `envelope.ts`: declarative zod schema and constant additions. The contract spec tests them, but they were not instrumented.
  - Test files and docs.
  - No renamed or deleted files.
- Provider/version: vitest 5.1.0 with @vitest/coverage-v8 5.1.0. Command: `npx vitest run --coverage --coverage.include='src/settings/store.ts' --coverage.include='src/main/broadcast.ts' --coverage.include='src/main/handlers.ts'`. Working directory: `apps/desktop`. Test selection: all desktop unit specs (7 files, 135 tests).
- Run start 2026-11-16T19:55:55+01:00, completed 19:55:56+01:00. Exit status 0. All tests passed.
- Reports: `apps/desktop/coverage/coverage-summary.json` (sha256 d8a9f2e7cbb7e36db031de33f9d376f04007d35bc06e73200d3bca2b1191498c) and `apps/desktop/coverage/lcov.info` (sha256 5f45005355ff5136d455b4312a9fe2a7b1571be1d46e2b37582a1ef0c2d47233). Both have mtime 19:55:56, which is within the run.
- Freshness: the provider rewrote the coverage directory during this run. The counters reflect the CR-1 code (store.ts grew from 87 to 100 statements). The first-pass numbers (store.ts 87/87) are stale and replaced below.
- Final run after the latest test additions and production fixes: yes. It measured 21f43f0, which includes the CR-1 fix, plus this pass's tests.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `apps/desktop/src/settings/store.ts` | 100/100 (100%) | 48/48 (100%) | 25/25 (100%) | 87/87 (100%) |
| `apps/desktop/src/main/broadcast.ts` | 11/11 (100%) | 1/1 (100%) | 5/5 (100%) | 9/9 (100%) |
| `apps/desktop/src/main/handlers.ts` | 12/12 (100%) | 2/2 (100%) | 7/7 (100%) | 11/11 (100%) |
| Aggregate (summed counters, the 3 files above) | 123/123 (100%) | 51/51 (100%) | 37/37 (100%) | 107/107 (100%) |

The aggregate leaves out `main/index.ts` and `main/window.ts` (Electron-only; `npm run test:electron`
covers them behaviorally). It also leaves out `contract/src/app.ts` and `contract/src/envelope.ts`
(schema declarations, not instrumented).

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `apps/desktop/src/settings/store.ts` (CR-1 code: `backUpUnreadable`, `unreadable` flag) | An unreadable file must survive the first write | Fully covered by the fixer's 3 tests. This pass adds 5 behavioral edge-case tests (no-op/invalid set, concurrency, a write failure after the move, a code-less error, real EISDIR). These cover behavior, not lines that were missing. |
| First-pass gaps (`store.ts` code-less error, default clock; `broadcast.ts` default log) | See first pass | Covered since the first pass |
| `apps/desktop/src/main/index.ts`, `window.ts` (not instrumented) | Settings store opened in userData, onChange -> broadcaster, sink per window removed on detach | Covered by the Electron harness (AC3) and by the handlers integration test, which mirrors the index.ts wiring. Line coverage cannot be measured without Electron-side instrumentation. |

## Unable to test

- Line-level coverage of `apps/desktop/src/main/index.ts` and `window.ts`. Unit vitest cannot load
  `electron`, and the Electron harness collects no coverage. `npm run test:electron` tests their
  behavior end to end. No follow-up is needed for this task.
- A real process kill between `writeFile` and `rename`. It is simulated with an injected fs that
  rejects `rename`, or that writes half of the temp file and then rejects. AC2 asks for exactly this
  simulation.
- A real EACCES on settings.json. The tests inject EACCES through the fs wrapper, because chmod-based
  tests behave differently when they run as root. A real EISDIR is tested on the real file system.
- Removing a window's broadcast sink when it detaches (`window.ts`) is not tested directly. Low risk:
  the Broadcaster logs and swallows errors from closed ports.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. The CR-1 fix behaves as
`fixes.md` describes. This pass adds 5 edge-case tests, and all of them pass. The focused suites,
`npm run check` (.taskcheck) and `npm run test:electron` pass on the final snapshot. The three
measured task files are at 100% statement, branch, function and line coverage.

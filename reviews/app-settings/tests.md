# Test Report

Date: 2026-11-16

Task: app-settings - M0: Settings store in main (settings.json, app.* methods)

Scope: `git diff e46732c98118f1cae207337fdc22e418298430c0..HEAD` on branch `main`, HEAD
875b681671b946457b167b18fbab512416cd575d (third pass, after the CR-2 fix). Task-owned commits:
3613a30 (settings store), 2e365ba (handlers, broadcast, Electron test), b21a38b (docs only),
6f8d535 (first-pass tests and review), 21f43f0 (CR-1 fix: an unreadable settings.json is moved to
`settings.json.unreadable-<time>` before the first write, and the write is refused if that move
fails), 4a43fc8 (second-pass tests and review), 875b681 (CR-2 fix: a corrupt settings.json whose
`.corrupt-<time>` rename fails at load is kept and moved aside before the first write;
`pendingBackup: 'corrupt' | 'unreadable'`, `moveAsideBeforeWrite`). Uncommitted input:
`apps/desktop/src/settings/store.spec.ts`, which has the 5 tests added in this pass. No production
file had uncommitted changes. `reviews/app-settings/review.md` was also uncommitted. The
code-reviewer changed it in parallel. This helper did not touch it.

Requirements:
- `tasks/app-settings.md` acceptance criteria 1-3 and the recorded assumptions (layout
  `{version:1, settings:{...}}`, invalid known values fall back to the default, unparseable or
  wrong-layout files count as corrupt, the event is sent only when a value changes,
  `THICKET_USER_DATA`)
- `reviews/app-settings/review.md` findings CR-1 and CR-2 and `reviews/app-settings/fixes.md` (the
  expected behavior of both fixes)
- `docs/QUALITY.md` (report contract), `docs/ARCHITECTURE.md` "Coverage", `AGENTS.md`

## Test files changed

- `apps/desktop/src/settings/store.spec.ts` (first, second and third pass)
- `apps/desktop/src/main/handlers.spec.ts` (first pass)
- `apps/desktop/src/main/broadcast.spec.ts` (first pass)
- `packages/contract/src/index.spec.ts` (first pass)

## Tests added or updated

Count: 30 test cases across the three passes. The first pass added 20 (6f8d535), the second pass
5 (4a43fc8), and this pass adds 5. The fixer also added 3 CR-1 regression tests (21f43f0) and 3
CR-2 regression tests (875b681). No existing test was changed or weakened.

This pass adds 5 tests to `describe('SettingsStore corrupt file')` in store.spec.ts. They give the
CR-2 path (a corrupt file kept at load and moved aside before the first write) the same edge-case
coverage the second pass gave the unreadable path:
- `a pending corrupt file stays in place after a no-op or invalid set; a real change moves it`.
  A no-op set and a schema-refused set neither move the file nor clear the pending backup. The next
  real change makes the `.corrupt-` backup with the original content.
- `concurrent sets on a pending corrupt file make one backup and end with the last change`. Three
  queued sets make exactly one backup, which holds the original content. The file ends with the
  last values, and the listener is called 3 times.
- `a failed move at set time, queued with a second set, lets the second set retry and succeed`.
  The move fails once more inside the first set (a one-shot failure in the fs wrapper, no timing
  dependency). The first set rejects. The second set, queued behind it, retries the move, backs up
  the original content and writes.
- `a crash between write and rename after the corrupt file was moved aside keeps the backup; restart uses defaults`.
  The move succeeds at set time, then the temp-to-settings rename "crashes". The backup holds the
  original content and settings.json is absent. A restart (new store, real fs) gives the defaults,
  removes the stale temp file and makes no new backup. The original store's retry writes without a
  second backup. This combines AC1 (backup kept) with AC2 (crash between write and rename).
- `a load-time move failure without an error code is retried before the first set`. An error
  without `code` is not ENOENT, so the backup is retried. The success log names the kind
  (`moved the corrupt ...`).

The fixer's 3 CR-2 tests were reviewed and are sound. They cover the deferred backup on the first
set (only once), EBUSY at set time (the set rejects; file, temp file, backup, settings and listener
are unchanged; a later set retries), and ENOENT at load (no retry, normal write). The pre-existing
test `a corrupt file that cannot be moved aside still gives the defaults (logged)` is unchanged and
passes. By inspection, the pre-fix code (4a43fc8) never backed up a corrupt file after a load-time
rename failure, so it would fail the first two CR-2 tests and this pass's first, second, third and
fifth tests. The new tests were not run against the pre-fix code, because that needs swapping
production code.

The second pass's 5 tests (unreadable path: no-op/invalid set, concurrency, a write failure after
the move, a code-less read error, a real EISDIR) and the first pass's tests are unchanged and pass.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 unit: defaults | `SettingsStore defaults` (4) + `no stale temp file: nothing is logged` | `npx vitest run --project desktop --project contract` | Pass |
| AC1 unit: unknown keys dropped | `SettingsStore unknown keys` (4, incl. `__proto__`/`constructor`); handlers `extra` key refused | `npx vitest run --project desktop --project contract` | Pass |
| AC1 unit: corrupt file -> defaults + backup | `%s -> defaults, the bad file is kept as a backup` (6), `%s -> treated as corrupt` (6), `cannot be moved aside`, `without an injected clock...`, `read error without an error code`, `a file that cannot be read (not ENOENT)...` | `npx vitest run --project desktop --project contract` | Pass |
| AC1 / CR-1: an unreadable (non-ENOENT) file is not lost on the first write | fixer's 3 CR-1 tests + the second pass's 5 tests in `SettingsStore unreadable file` | `npx vitest run --project desktop --project contract` | Pass |
| AC1 / CR-2: a corrupt file that could not be moved aside at load is backed up before the first write | fixer's 3 CR-2 tests + this pass's 5 tests in `SettingsStore corrupt file` (`a pending corrupt file stays in place...`, `concurrent sets on a pending corrupt file...`, `a failed move at set time, queued...`, `a crash between write and rename after the corrupt file was moved aside...`, `a load-time move failure without an error code...`) | `npx vitest run --project desktop --project contract` | Pass |
| AC2 atomic writes, crash between write and rename | `writes to a temp file and renames it`, `a crash between write and rename keeps the previous file`, `a crash before the first file existed`, `torn temp`, `queued behind a failed one`, `stale temp file that cannot be removed`, `a write that fails after the move keeps the backup...`, `a crash between write and rename after the corrupt file was moved aside...` | `npx vitest run --project desktop --project contract` | Pass |
| AC3 renderer gets app.settings.changed after a set (Electron harness) | `apps/desktop/test/settings.electron.spec.ts` `the renderer gets app.settings.changed after app.settings.set` (+4 others in that file) | `npm run test:electron` (repo root; builds renderer + desktop, runs Electron via Playwright `_electron`) | Pass (3 files, 17 tests) |
| AC3 supporting: handler + broadcast wiring, payload schema | handlers `a set over the port saves, answers and broadcasts one valid app.settings.changed`; contract `the app.settings.changed payload carries the full, valid settings`; broadcast tests | `npx vitest run --project desktop --project contract` | Pass |
| Assumption: event only when a value changes; invalid values change nothing | store `notifies listeners...`, `a set() with an invalid value is refused`, handlers integration test, Electron `invalid settings are refused` | both commands above | Pass |

## Focused test execution

Command:

`npx vitest run --project desktop apps/desktop/src/settings/store.spec.ts`, then
`npx vitest run --project desktop --project contract` (repo root). Also `npx eslint` and
`npx prettier --check` on store.spec.ts.

Result:

Pass. store.spec.ts: 56 tests. Desktop + contract: 10 files, 769 tests (764 at 875b681 plus the 5
added in this pass). eslint and prettier pass on store.spec.ts. On the first run, one new test
failed because the test turned the failure off only after awaiting the first rejection. By then
the queued second set had already run. That was a timing error in the test, not a defect. It was
fixed by making the failure one-shot inside the fs wrapper.

## Full test execution

Command:

`npm run check` (repo root: eslint + prettier, tsc in every workspace, vitest for all projects,
renderer `ng test`) and `npm run test:electron` (repo root)

Result:

Pass. `npm run check` (2026-11-16 20:00:10-20:00:26 +01:00): lint and typecheck passed (they are
chained with `&&` before the tests). Vitest ran 22 files / 1334 tests, and the renderer `ng test`
ran 5 files, all passing. `npm run test:electron` (20:00:28-20:00:36): 3 files, 17 tests, including
`the renderer gets app.settings.changed after app.settings.set`.

## .taskcheck

Result:

Pass. `.taskcheck` runs `npm run check`, which passed on the final snapshot (see above). It was not
run as a separate command.

## Bugs found

None. Every new test passed against the unchanged production code at 875b681. CR-2 is fixed as
`fixes.md` describes, and no new defect was found in the fix.

Observation, not a defect: as on the unreadable path, if the corrupt file is moved aside at set
time and the following temp write or rename fails, settings.json is absent until the next
successful set. A restart in that window starts with the defaults, which it would do anyway
because the file was corrupt. The original content stays in `settings.json.corrupt-<time>`. The
test `a crash between write and rename after the corrupt file was moved aside...` pins this
behavior. Also by design: a deferred backup is named after the time of the set, not of the load.

## Coverage

Status: verified

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured. The configured reporters (text-summary, json-summary, lcov)
give no diff-aware result. All three files are new in this task and each is at 100%, so
changed-line coverage of these files can be no lower.

Evidence:
- Task id: app-settings. Immutable base: e46732c98118f1cae207337fdc22e418298430c0. Measured HEAD: 875b681671b946457b167b18fbab512416cd575d. Task ownership comes from the parent-supplied base and commit list, checked against `git log e46732c..HEAD` and `git show --stat 875b681`.
- Source/test snapshot (sha256 prefix): store.ts da5ef0f89f58ca15, broadcast.ts 9bc5ab0641d63d6f, handlers.ts 37dedca5be05fb6a, store.spec.ts 3c9f4d4095a0d647 (uncommitted, includes this pass's tests), broadcast.spec.ts 226d5fecfac33d7e, handlers.spec.ts c79a2f266ef7a858, contract index.spec.ts f3f0eb81464cdf4b. The hashes were taken at 20:00:10, before `npm run check`, `npm run test:electron` and the coverage run, and checked again after all three. Nothing changed.
- Included: `apps/desktop/src/settings/store.ts`, `apps/desktop/src/main/broadcast.ts`, `apps/desktop/src/main/handlers.ts`. Excluded:
  - `apps/desktop/src/main/index.ts` and `window.ts`: Electron entry and window wiring. They import `electron`, so unit vitest cannot load them. The Electron harness (AC3) exercises them but collects no coverage.
  - `packages/contract/src/app.ts` and `envelope.ts`: declarative zod schema and constant additions. The contract spec tests them, but they were not instrumented.
  - Test files and docs.
  - No renamed or deleted files.
- Provider/version: vitest 5.1.0 with @vitest/coverage-v8 5.1.0. Command: `npx vitest run --coverage --coverage.include='src/settings/store.ts' --coverage.include='src/main/broadcast.ts' --coverage.include='src/main/handlers.ts'`. Working directory: `apps/desktop`. Test selection: all desktop unit specs (7 files, 143 tests).
- Run start 2026-11-16T20:00:36+01:00, completed 20:00:37+01:00. Exit status 0: all tests passed and the summary was printed.
- Reports: `apps/desktop/coverage/coverage-summary.json` (sha256 90bf9ac00c12fda7b21b1ff75fe9ce6ebf9049bc3cbb8811ef4bc7d429ee8725) and `apps/desktop/coverage/lcov.info` (sha256 7f8c336b7b5459f203e6f8ad88237c3b5a6e12fa3f709698946c4d75d3cd07e4). Both have mtime 20:00:37.72, which is within the run.
- Freshness: the provider rewrote the coverage directory during this run. The hashes are new, and the store.ts counters changed from 100 statements / 48 branches at 21f43f0 to 101 / 50 at 875b681, which matches the CR-2 code. The second-pass numbers are stale and replaced below.
- Final run after the latest test additions and production fixes: yes. It measured 875b681, which includes the CR-2 fix, plus this pass's tests.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `apps/desktop/src/settings/store.ts` | 101/101 (100%) | 50/50 (100%) | 25/25 (100%) | 87/87 (100%) |
| `apps/desktop/src/main/broadcast.ts` | 11/11 (100%) | 1/1 (100%) | 5/5 (100%) | 9/9 (100%) |
| `apps/desktop/src/main/handlers.ts` | 12/12 (100%) | 2/2 (100%) | 7/7 (100%) | 11/11 (100%) |
| Aggregate (summed counters, the 3 files above) | 124/124 (100%) | 53/53 (100%) | 37/37 (100%) | 107/107 (100%) |

The aggregate leaves out `main/index.ts` and `main/window.ts` (Electron-only; `npm run test:electron`
covers them behaviorally). It also leaves out `contract/src/app.ts` and `contract/src/envelope.ts`
(schema declarations, not instrumented).

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `apps/desktop/src/settings/store.ts` (CR-2 code: `pendingBackup = 'corrupt'` in `backUpCorrupt`, `moveAsideBeforeWrite(kind)`) | A corrupt file must not be lost when its load-time backup fails | No uncovered lines or branches. The fixer's 3 CR-2 tests cover it fully. This pass adds 5 behavioral edge-case tests (no-op/invalid set, concurrency, a failed move with a queued retry, a crash after the move, a code-less error). |
| `apps/desktop/src/settings/store.ts` (CR-1 code) | An unreadable file must survive the first write | Covered since the second pass |
| First-pass gaps (`store.ts` code-less error, default clock; `broadcast.ts` default log) | See first pass | Covered since the first pass |
| `apps/desktop/src/main/index.ts`, `window.ts` (not instrumented) | Settings store opened in userData, onChange -> broadcaster, sink per window removed on detach | Covered by the Electron harness (AC3) and by the handlers integration test, which mirrors the index.ts wiring. Line coverage cannot be measured without Electron-side instrumentation. |

## Unable to test

- Line-level coverage of `apps/desktop/src/main/index.ts` and `window.ts`. Unit vitest cannot load
  `electron`, and the Electron harness collects no coverage. `npm run test:electron` tests their
  behavior end to end. No follow-up is needed for this task.
- A real process kill between `writeFile` and `rename`. It is simulated with an injected fs that
  rejects `rename`, or that writes half of the temp file and then rejects. AC2 asks for exactly this
  simulation.
- A real EACCES on settings.json, or a real lock (EBUSY) on the corrupt-file rename. The tests
  inject these errors through the fs wrapper, because chmod-based tests behave differently when they
  run as root and Linux has no mandatory file locks. A real EISDIR is tested on the real file system.
- Removing a window's broadcast sink when it detaches (`window.ts`) is not tested directly. Low risk:
  the Broadcaster logs and swallows errors from closed ports.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. The CR-2 fix behaves as
`fixes.md` describes. This pass adds 5 edge-case tests for the deferred corrupt-file backup, and all
of them pass. The focused suites, `npm run check` (.taskcheck) and `npm run test:electron` pass on
the final snapshot (HEAD 875b681 plus the uncommitted store.spec.ts). The three measured task files
are at 100% statement, branch, function and line coverage.

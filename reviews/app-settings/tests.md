# Test Report

Date: 2026-11-16

Task: app-settings - M0: Settings store in main (settings.json, app.* methods)

Scope: `git diff e46732c98118f1cae207337fdc22e418298430c0..HEAD` on branch `main`. Task-owned
commits 3613a30 (settings store) and 2e365ba (handlers, broadcast, Electron test). The parent named
them 38ac946 and 8b19fb3, the pre-rebase hashes, and they hold the same file set. Test measurements
ran at HEAD 2e365ba37bd3f54401b8d1aaf5cf19ef869238ad. During the run the parent added b21a38b
(`docs/ARCHITECTURE.md` only, 9 lines). That commit has no production or test code, so the
measurements still apply to HEAD b21a38b2ec9f51211411475d0d58e9f399c8faf8. Uncommitted inputs are
the four test files listed below. No production files had uncommitted changes.

Requirements:
- `tasks/app-settings.md` acceptance criteria 1-3 and its recorded assumptions (settings.json layout
  `{version:1, settings:{...}}`, invalid known values fall back to the default, unparseable or
  wrong-layout files count as corrupt, the event is sent only when a value changes,
  `THICKET_USER_DATA`)
- `docs/QUALITY.md` (report contract), `docs/ARCHITECTURE.md` "Coverage" (coverage command)
- `AGENTS.md`

## Test files changed

- `apps/desktop/src/settings/store.spec.ts`
- `apps/desktop/src/main/handlers.spec.ts`
- `apps/desktop/src/main/broadcast.spec.ts`
- `packages/contract/src/index.spec.ts`

## Tests added or updated

Count: 20 test cases added (18 `it` blocks, two of them `it.each` with 6 rows). No existing test was changed or weakened.

- store.spec.ts (16 cases):
  - corrupt layouts: version 0, a negative version, a fractional version, version as a string, settings as an array, settings as null. Each is treated as corrupt: defaults plus a backup.
  - a corrupt file that cannot be moved aside still gives the defaults and is logged.
  - without an injected clock, the backup is named after the current time.
  - a read error without an error code gives the defaults and is logged.
  - a version-1 file logs no warning.
  - `__proto__` and `constructor` keys in the file are dropped and pollute nothing.
  - a crash while the temp file is being written (torn temp) keeps settings.json. A restart cleans up.
  - a set queued behind a failed one starts from the saved settings, not from the failed change.
  - a stale temp file that cannot be removed is logged, and loading still works.
  - with no stale temp file, nothing is logged.
  - a set() with an invalid value is refused: nothing is written, nobody is notified, and the queue is not blocked.
- handlers.spec.ts (1): the real SettingsStore, Broadcaster and `serve` are wired as in index.ts. A set saves, answers, and broadcasts exactly one `app.settings.changed` that matches the `settingsChanged` schema. Setting the same value again sends no event. An invalid value gets INVALID_PARAMS and no event. A get returns the saved value.
- broadcast.spec.ts (2): without a log, a failing sink is swallowed and the other sinks still receive the event. Emitting with no renderers connected does nothing.
- contract index.spec.ts (1): the `settingsChanged` payload accepts full, valid settings. It rejects partial settings, invalid values, extra keys, and a missing `settings` field.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 unit: defaults | `SettingsStore defaults` (4 existing); `no stale temp file: nothing is logged` | `npx vitest run --project desktop --project contract` | Pass |
| AC1 unit: unknown keys dropped | `SettingsStore unknown keys` (3 existing) + `__proto__ and constructor keys in the file are dropped...`; handlers `extra` key refused (existing) | `npx vitest run --project desktop --project contract` | Pass |
| AC1 unit: corrupt file -> defaults + backup | `%s -> defaults, the bad file is kept as a backup` (6 existing) + `%s -> treated as corrupt` (6 new) + `cannot be moved aside` + `without an injected clock...` + `read error without an error code` + existing EISDIR test | `npx vitest run --project desktop --project contract` | Pass |
| AC2 atomic writes, crash between write and rename | `writes to a temp file and renames it` (existing), `a crash between write and rename keeps the previous file` (existing), `a crash before the first file existed` (existing), `torn temp` (new), `queued behind a failed one` (new), `stale temp file that cannot be removed` (new) | `npx vitest run --project desktop --project contract` | Pass |
| AC3 renderer gets app.settings.changed after a set (Electron harness) | `apps/desktop/test/settings.electron.spec.ts` `the renderer gets app.settings.changed after app.settings.set` (+4 others in that file) | `npm run test:electron` (repo root; builds renderer + desktop, runs Electron via Playwright `_electron`) | Pass (3 files, 17 tests) |
| AC3 supporting: handler + broadcast wiring, payload schema | handlers `a set over the port saves, answers and broadcasts one valid app.settings.changed`; contract `the app.settings.changed payload carries the full, valid settings`; broadcast tests | `npx vitest run --project desktop --project contract` | Pass |
| Assumption: event only when a value changes; invalid values change nothing | store `notifies listeners...` (existing), `a set() with an invalid value is refused` (new), handlers integration test (new), Electron `invalid settings are refused` (existing) | both commands above | Pass |

## Focused test execution

Command:

`npx vitest run --project desktop --project contract` (repo root)

Result:

Pass: 10 files, 753 tests. Before my additions the baseline was 733 tests.

## Full test execution

Command:

`npm run check` (repo root: eslint + prettier, tsc in every workspace, vitest for all projects, renderer `ng test`), and `npm run test:electron` (repo root)

Result:

Pass. `npm run check` passed: lint and typecheck passed, vitest ran 22 files / 1318 tests, and the renderer ran 5 files / 181 tests. `npm run test:electron` passed: 3 files, 17 tests.

## .taskcheck

Result:

Pass. `.taskcheck` runs `npm run check`, which passed on the final test snapshot (see above).

## Bugs found

None. No production defect was found. Every new test passed against the unchanged production code.

## Coverage

Status: verified

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured. The configured reporters (text-summary, json-summary, lcov) give no diff-aware result. All three measured files are new or mostly new in this task, and every one is at 100%, so changed-line coverage of those files can be no lower.

Evidence:
- Task id: app-settings. Immutable base: e46732c98118f1cae207337fdc22e418298430c0. Measured HEAD: 2e365ba37bd3f54401b8d1aaf5cf19ef869238ad (now b21a38b, which adds only docs). Task ownership comes from the parent-supplied commit list, checked against `git log e46732c..HEAD` and `git diff --stat e46732c..HEAD`.
- Source/test snapshot (sha256): store.ts 7fff0f36..., broadcast.ts 9bc5ab06..., handlers.ts 37dedca5..., store.spec.ts cd9ef75a..., broadcast.spec.ts 226d5fec..., handlers.spec.ts c79a2f26..., contract index.spec.ts f3f0eb81.... Hashes were taken before the final run and checked again after it; nothing changed.
- Included: `apps/desktop/src/settings/store.ts`, `apps/desktop/src/main/broadcast.ts`, `apps/desktop/src/main/handlers.ts`. Excluded:
  - `apps/desktop/src/main/index.ts` and `window.ts`: Electron entry and window wiring. They import `electron`, so they cannot run under unit vitest. The Electron harness test exercises them (AC3), but that harness has no coverage provider.
  - `packages/contract/src/app.ts` and `envelope.ts`: declarative zod schema and constant additions. They are tested by the contract spec but were not instrumented in this run.
  - Test files and docs.
  - No renamed or deleted files.
- Provider/version: vitest 5.1.0 with @vitest/coverage-v8 5.1.0. Command: `npx vitest run --coverage --coverage.include='src/settings/store.ts' --coverage.include='src/main/broadcast.ts' --coverage.include='src/main/handlers.ts'`. Working directory: `apps/desktop`. Test selection: all desktop unit specs (7 files, 127 tests).
- Run start 2026-11-16T19:52:04+01:00, completed 19:52:06+01:00. Exit status 0. All tests passed.
- Reports: `apps/desktop/coverage/coverage-summary.json` (sha256 bd1887e231bf9122...) and `apps/desktop/coverage/lcov.info` (sha256 d9a5943cdeaa67eb...). Both have mtime 19:52:06, which is within the run.
- Freshness: the provider rewrote the coverage directory during this run. An earlier run before the last test additions (19:51:18) measured 108/110 statements, 44/47 branches and 33/35 functions. Its gaps are listed below and are now covered.
- Final run after latest test additions and production fixes: yes. There were no production fixes.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `apps/desktop/src/settings/store.ts` | 87/87 (100%) | 44/44 (100%) | 23/23 (100%) | 75/75 (100%) |
| `apps/desktop/src/main/broadcast.ts` | 11/11 (100%) | 1/1 (100%) | 5/5 (100%) | 9/9 (100%) |
| `apps/desktop/src/main/handlers.ts` | 12/12 (100%) | 2/2 (100%) | 7/7 (100%) | 11/11 (100%) |
| Aggregate (summed counters, the 3 files above) | 110/110 (100%) | 47/47 (100%) | 35/35 (100%) | 95/95 (100%) |

The aggregate leaves out `main/index.ts`, `main/window.ts` (Electron-only, covered behaviorally by `npm run test:electron`), `contract/src/app.ts` and `contract/src/envelope.ts` (schema declarations, not instrumented in this run).

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `apps/desktop/src/settings/store.ts:44` (first run: branch where the error has no string `code`) | A read or unlink failure without an errno code must still fall back to the defaults | Added `a read error without an error code gives the defaults (logged)`. Covered now. |
| `apps/desktop/src/settings/store.ts:101` (first run: the default clock was never called) | The real backup name uses the current time | Added `without an injected clock the backup is named after the current time`. Covered now. |
| `apps/desktop/src/main/broadcast.ts:12` (first run: the default no-op log) | A broadcast to a closed port must not throw when no log is given | Added `without a log, a failing sink is swallowed...`. Covered now. |
| `apps/desktop/src/main/index.ts`, `window.ts` (not instrumented) | Settings store opened in userData, onChange -> broadcaster, sink per window removed on detach | Covered by the Electron harness (AC3) and by the new handlers integration test, which mirrors the index.ts wiring. Line coverage is not measurable without Electron-side instrumentation. |

## Unable to test

- Line-level coverage of `apps/desktop/src/main/index.ts` and `window.ts`. Unit vitest cannot load `electron`, and the Electron harness collects no coverage. Their behavior is tested end-to-end by `npm run test:electron`. No follow-up is needed for this task.
- A real process kill between `writeFile` and `rename`. The crash is simulated with an injected fs that rejects `rename`, or writes half of the content to the temp file and then rejects. AC2 asks for exactly this simulation.
- Removing a window's broadcast sink when it detaches (`window.ts`) is not tested directly. A test would need several windows or a renderer reload in the harness. This is low risk because the Broadcaster logs and swallows errors from closed ports.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. I added 20 test cases. The focused suites, `npm run check` (.taskcheck) and the Electron harness all pass, and the three measured task files are at 100% statement, branch, function and line coverage.

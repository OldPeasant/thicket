# Test Report

Date: 2026-11-16

Task: app-settings - M0: Settings store in main (settings.json, app.* methods)

Scope: fourth pass, after merging main (the secrets-store task) into the task branch. Revision
1a9c70ff049d91cbf3b12de548b65eba25267373 (merge commit). Task base:
`git merge-base HEAD origin/main` = c362008f454785d5c8cc940c9160539ed83a8165. Task diff:
`git diff c362008..1a9c70f -- apps packages` (13 files; secrets-store and other main changes are
not in it). Task-owned commits: 3613a30, 2e365ba, b21a38b, 6f8d535, 21f43f0, 4a43fc8, 875b681,
523e847, cbef273 and the merge 1a9c70f. This pass checked the merge resolution
(`git diff 523e847 1a9c70f -- apps/desktop/src/main packages/contract/src/no-secrets.spec.ts`):
- `handlers.ts`: `MainHandlerDeps` is now `{version, secrets, settings?}`. `mainHandlers` spreads
  `secretsHandlers(deps.secrets)` and adds the settings handlers when `settings` is given.
  `privilegedHandlers` takes `{secrets}`.
- `index.ts`: passes `secrets: secretsStore()` and `settings` to `mainHandlers`.
- `handlers.spec.ts`: the settings tests use `deps('1')`, which includes an empty `SecretsStore`.
- `no-secrets.spec.ts`: `settingsChanged` was added to the broadcast payload map.

While the runs were going on, HEAD moved to 8d600381e1c5a7bc332819dabcdff6e9ae691c09.
`git diff --stat 1a9c70f 8d60038` shows only `tasks/*.md` changes, so the measured code is the code
of 1a9c70f. Uncommitted input: `apps/desktop/src/main/handlers.spec.ts`, which has this pass's 2
tests. `reviews/app-settings/review.md` was also modified. The code-reviewer changed it in
parallel; this helper did not touch it. No production file had uncommitted changes.

Requirements:
- `tasks/app-settings.md` acceptance criteria 1-3 and the recorded assumptions
- `reviews/app-settings/review.md` / `fixes.md` (CR-1, CR-2), already covered in earlier passes
- `docs/QUALITY.md`, `docs/ARCHITECTURE.md` "Coverage", `AGENTS.md`

## Test files changed

- `apps/desktop/src/main/handlers.spec.ts` (first pass, and this pass)
- `apps/desktop/src/settings/store.spec.ts` (first, second and third pass)
- `apps/desktop/src/main/broadcast.spec.ts` (first pass)
- `packages/contract/src/index.spec.ts` (first pass)

The merge resolution itself changed `handlers.spec.ts` (`deps('1')`) and
`packages/contract/src/no-secrets.spec.ts` (`settingsChanged` in the broadcast map). Both were
reviewed. The settings assertions are unchanged; only the deps argument changed. No test was
weakened.

## Tests added or updated

Count: 32 test cases across the four passes. The first pass added 20, the second 5, the third 5,
and this pass adds 2. The fixer's 6 CR regression tests are separate.

This pass adds 2 tests to `describe('app.settings handlers')` in handlers.spec.ts. They close a gap
the merge opened: no test checked that the settings handlers and the secrets handlers now share
one handler map without clashing.
- `coexist with the secrets handlers: every name is a distinct main-routed renderer method`.
  Adding a settings store adds exactly `app.settings.get` and `app.settings.set` to the handler
  names. Nothing is replaced or lost. The secrets methods (`profiles.secretStorage`,
  `profiles.setSecret`, `profiles.clearSecret`) are present, and every name is a renderer
  contract method routed to `main`.
- `settings and secrets methods are both answered on one window port`. On one port served with
  the renderer contract, `profiles.secretStorage` answers with a contract-valid result, and
  `app.settings.get/set` answer through the settings store.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 unit: defaults | `SettingsStore defaults` (4) + `no stale temp file: nothing is logged` | `npx vitest run --project desktop --project contract` | Pass |
| AC1 unit: unknown keys dropped | `SettingsStore unknown keys` (4, incl. `__proto__`/`constructor`); handlers `extra` key refused | `npx vitest run --project desktop --project contract` | Pass |
| AC1 unit: corrupt file -> defaults + backup | `%s -> defaults, the bad file is kept as a backup` (6), `%s -> treated as corrupt` (6), `cannot be moved aside`, corrupt-file CR-2 tests (3 fixer + 5 third pass), unreadable-file CR-1 tests (3 fixer + 5 second pass) | `npx vitest run --project desktop --project contract` | Pass |
| AC2 atomic writes, crash between write and rename | `writes to a temp file and renames it`, `a crash between write and rename keeps the previous file`, `a crash before the first file existed`, `torn temp`, `queued behind a failed one`, `stale temp file that cannot be removed`, `a crash between write and rename after the corrupt file was moved aside...` | `npx vitest run --project desktop --project contract` | Pass |
| AC3 renderer gets app.settings.changed after a set (Electron harness) | `apps/desktop/test/settings.electron.spec.ts` `the renderer gets app.settings.changed after app.settings.set` (+4 others in that file) | `npm run test:electron` (repo root; builds and runs Electron via Playwright `_electron`) | Pass (4 files, 22 tests) |
| AC3 supporting: handler + broadcast wiring, payload schema | handlers `a set over the port saves, answers and broadcasts one valid app.settings.changed`; contract `the app.settings.changed payload carries the full, valid settings`; `no-secrets.spec.ts` `broadcast payloads carry no secret field` (now includes settingsChanged) | `npx vitest run --project desktop --project contract` | Pass |
| Merge: settings handlers coexist with secrets handlers | `coexist with the secrets handlers...`, `settings and secrets methods are both answered on one window port`, `main handlers and privileged handlers do not share a method name` | `npx vitest run --project desktop --project contract` | Pass |
| Assumption: event only when a value changes; invalid values change nothing | store `notifies listeners...`, `a set() with an invalid value is refused`, handlers integration test, Electron `invalid settings are refused` | both commands above | Pass |

## Focused test execution

Command:

`npx vitest run --project desktop apps/desktop/src/main/handlers.spec.ts`, then
`npx vitest run --project desktop --project contract` (repo root). Also
`npx prettier --write` and `npx eslint` on handlers.spec.ts. Prettier only reformatted the new
test code.

Result:

Pass. handlers.spec.ts: 12 tests. Desktop + contract (20:05:22): 14 files, 932 tests.

## Full test execution

Command:

`npm run check` (repo root: eslint + prettier, tsc in every workspace, vitest for all projects,
renderer `ng test`) and `npm run test:electron` (repo root)

Result:

Pass. `npm run check` (2026-11-16 20:05:26-20:05:42 +01:00): lint and typecheck passed (they are
chained with `&&` before the tests). Vitest ran 30 files / 1597 tests, and the renderer `ng test`
ran 5 files / 181 tests, all passing. `npm run test:electron` (20:05:44-20:05:55): 4 files, 22
tests, including `the renderer gets app.settings.changed after app.settings.set` and the secrets
Electron tests that the merge brought in.

## .taskcheck

Result:

Pass. `.taskcheck` runs `npm run check`, which passed on this snapshot (see above). It was not run
as a separate command.

## Bugs found

None. The merge resolution keeps the settings behavior intact, and the settings and secrets
handlers do not clash.

## Coverage

Status: verified

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured. The configured reporters (text-summary, json-summary, lcov)
give no diff-aware result. Each measured file is at 100% for every metric, so changed-line coverage
of these files can be no lower.

Evidence:
- Task id: app-settings. Base: c362008f454785d5c8cc940c9160539ed83a8165 (`git merge-base HEAD origin/main`, as the parent supplied). Measured code: 1a9c70ff049d91cbf3b12de548b65eba25267373. HEAD moved to 8d600381e1c5a7bc332819dabcdff6e9ae691c09 during the runs, with `tasks/` changes only. Task ownership comes from the parent-supplied commit list, checked against `git diff --stat c362008 HEAD -- apps packages`.
- Source/test snapshot (sha256 prefix): store.ts da5ef0f89f58ca15, broadcast.ts 9bc5ab0641d63d6f, handlers.ts 445f36b258f4e027, index.ts 862bdd1fdc9542d3, store.spec.ts 3c9f4d4095a0d647, broadcast.spec.ts 226d5fecfac33d7e, handlers.spec.ts 4741e2ca9428dc28 (uncommitted, includes this pass's tests), contract index.spec.ts e60c1db73c7a4cf8, no-secrets.spec.ts 3cab4364237af624. The hashes were taken at 20:05:20, before all runs, and checked again after the coverage run. Nothing changed.
- Included: `apps/desktop/src/settings/store.ts`, `apps/desktop/src/main/broadcast.ts`, `apps/desktop/src/main/handlers.ts`. Excluded:
  - `apps/desktop/src/main/index.ts` and `window.ts`: Electron entry and window wiring. Unit vitest cannot load `electron`. The Electron harness (AC3) exercises them but collects no coverage.
  - `packages/contract/src/app.ts` and `envelope.ts`: declarative zod schema and constant additions. Contract specs test them, but they were not instrumented.
  - Test files and docs. No renamed or deleted files.
- Provider/version: vitest 5.1.0 with @vitest/coverage-v8 5.1.0, node v24.21.0. Command: `npx vitest run --coverage --coverage.include='src/settings/store.ts' --coverage.include='src/main/broadcast.ts' --coverage.include='src/main/handlers.ts'`. Working directory: `apps/desktop`. Test selection: all desktop unit specs (10 files, 224 tests, including the secrets specs from main).
- Run start 2026-11-16T20:05:59+01:00, completed 20:06:00+01:00. Exit status 0: all tests passed and the summary was printed.
- Reports: `apps/desktop/coverage/coverage-summary.json` (sha256 ed63f9cc095b67ee147da99c9a7d6ea4aa7e3e3e6ccb0a0ed8d2e2e7ce87fc0a) and `apps/desktop/coverage/lcov.info` (sha256 b83d2d21530d79d2aa2a0387418366b97a1d769ea783ec233f0245be5627bec8). Both have mtime 20:06:00.6, which is within the run.
- Freshness: the provider rewrote the reports during this run. The hashes differ from the third pass, and the handlers.ts counters changed from 12 statements / 7 functions to 11 / 6. That matches the merge: the `secrets.get` stub lambda was replaced by `secretsGetHandler(...)`, and the `secretsHandlers` spread adds no function of its own. The third-pass numbers are stale and replaced below.
- Final run after the latest test additions and production changes: yes (1a9c70f code plus this pass's tests).

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `apps/desktop/src/settings/store.ts` | 101/101 (100%) | 50/50 (100%) | 25/25 (100%) | 87/87 (100%) |
| `apps/desktop/src/main/broadcast.ts` | 11/11 (100%) | 1/1 (100%) | 5/5 (100%) | 9/9 (100%) |
| `apps/desktop/src/main/handlers.ts` | 11/11 (100%) | 2/2 (100%) | 6/6 (100%) | 10/10 (100%) |
| Aggregate (summed counters, the 3 files above) | 123/123 (100%) | 53/53 (100%) | 36/36 (100%) | 106/106 (100%) |

The aggregate leaves out `main/index.ts` and `main/window.ts` (Electron-only; `npm run test:electron`
covers them behaviorally). It also leaves out `contract/src/app.ts` and `contract/src/envelope.ts`
(schema declarations, not instrumented).

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `apps/desktop/src/main/handlers.ts` (merged `mainHandlers` with `secretsHandlers` spread and optional settings) | Settings and secrets handlers must coexist without overriding each other | No uncovered lines or branches. This pass adds 2 coexistence tests. |
| `apps/desktop/src/settings/store.ts`, `broadcast.ts` | AC1, AC2, CR-1, CR-2 | No uncovered lines or branches; unchanged by the merge |
| `apps/desktop/src/main/index.ts`, `window.ts` (not instrumented) | Settings store opened in userData, onChange -> broadcaster, settings + secrets passed to `mainHandlers` | Covered behaviorally by the Electron harness (AC3: settings and secrets Electron tests pass) and by the handlers integration test, which mirrors the index.ts wiring. Line coverage cannot be measured without Electron-side instrumentation. |

## Unable to test

- Line-level coverage of `apps/desktop/src/main/index.ts` and `window.ts`. Unit vitest cannot load
  `electron`, and the Electron harness collects no coverage. `npm run test:electron` tests their
  behavior end to end. No follow-up is needed for this task.
- A real process kill between `writeFile` and `rename`. It is simulated with an injected fs, which
  is what AC2 asks for.
- A real EACCES on settings.json, or a real EBUSY on the corrupt-file rename. These errors are
  injected through the fs wrapper. A real EISDIR is tested on the real file system.
- Removing a window's broadcast sink when it detaches (`window.ts`) is not tested directly. Low risk.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. The merge with the
secrets-store task keeps every settings test intact. This pass adds 2 tests showing that the
settings and secrets handlers coexist on the main port. The focused suites, `npm run check`
(.taskcheck) and `npm run test:electron` pass on code identical to 1a9c70f plus the uncommitted
handlers.spec.ts. The three measured task files are at 100% statement, branch, function and line
coverage.

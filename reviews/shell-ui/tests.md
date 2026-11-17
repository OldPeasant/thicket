# Test Report

Date: 2026-11-17

Task: shell-ui (M4: mongosh console)

Scope: `git diff 17f4bd01fce62c1c2fe17dde7672d91aabb5b574..f9c972687f8bb69b797c37c94f07edd999a0675b`
(task commits 81c88fa "Add the mongosh console tab (shell-ui)" and f9c9726 "Add console specs and
the demo step 11 e2e"), plus the uncommitted test-only changes listed below. Branch `main`, HEAD
f9c972687f8bb69b797c37c94f07edd999a0675b.

Requirements:
- `tasks/shell-ui.md` acceptance criteria and recorded assumptions (history 500 entries in memory,
  one shell tab per connection `shell:<profileId>`, Enter/Shift+Enter/Ctrl+Enter, Ctrl+C or Stop
  interrupts, one plain-text toggle)
- `SPEC.md` M4 Shell and demo step 11; Safety section (read-only, production accent)
- `docs/ARCHITECTURE.md` "Coverage"; `docs/QUALITY.md`
- Parent worker's list of gaps to examine (sidebar "Open shell", Ctrl+C, Clear, transcript limit,
  late completion answer, open after destroy)

## Test files changed

- `packages/renderer/src/app/console/shell-console.spec.ts`
- `packages/renderer/src/app/console/console-input.spec.ts`
- `packages/renderer/src/app/sidebar/sidebar-tree.service.spec.ts`
- `packages/renderer/src/app/sidebar/sidebar-tree.spec.ts`

No production file was changed.

## Tests added or updated

Count: 44 added, 1 updated (the multi-line history test now also checks ArrowDown above the last
line).

- `shell-console.spec.ts` (24 added):
  - "stop, clear and the transcript": Ctrl+C stops a running input and leaves a copy with a
    selection alone; Ctrl+C does nothing while idle; output of a stopped run is ignored and the next
    input runs; no second run while one runs; Clear keeps the session and the running input; only
    the newest `TRANSCRIPT_LIMIT` runs are kept; the Run button (disabled for blank input); a
    non-NOT_FOUND stream error keeps the session; "Type it for more" note in the viewer.
  - "completion races and keys": an answer arriving after the input changed is dropped; a single
    completion arriving after the input ran is dropped; completion failure is shown; Ctrl+Space
    completes, ArrowUp wraps, Tab applies (with `aria-activedescendant`); a second Tab cancels the
    first request without an error note; other keys pass through while the popup is open; blur
    closes the popup.
  - "session lifecycle": an open answer arriving after destroy is closed; an older open overtaken
    by a newer one is closed; the failure of an older open is ignored; reopening closes the current
    session; destroy cancels a running eval and closes the session; no open after destroy; a tab
    without a database opens without `db`; production accent from the tab flag.
- `console-input.spec.ts` (11 added): empty history, `add` resets stepping and the draft,
  default `HISTORY_LIMIT` (500), 8 `isInputComplete` edge cases (escaped backtick, multi-line
  template, unterminated string ending at a newline, block comment, line comment hiding `)`, stray
  closing bracket).
- `sidebar-tree.service.spec.ts` (5 added, "shell tabs"): `openShell` opens `shell:<id>` with
  title/detail/production/data; no `db` when none given; an open shell tab is selected, not
  duplicated, and keeps its database; production profile flag; unknown profile falls back to the id.
- `sidebar-tree.spec.ts` (4 added, "open shell"): connection menu item disabled while not
  connected (click does nothing); opens the shell from the connection menu; the database menu
  starts the shell in that database; the item stays enabled on read-only profiles.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 e2e: demo step 11 (`db.orders.countDocuments()`) | `test/e2e/shell.e2e.ts` "demo step 11: run db.orders.countDocuments() in the mongosh console", "a read-only profile opens the shell with a warning" | `npm run test:e2e -- shell` (repo root; builds renderer + desktop, Playwright Electron) | Pass (2 passed) |
| AC2 component tests: history navigation | `ShellConsole > history` (3 existing, 1 extended), `ConsoleHistory` (2 existing + 3 new) | `cd packages/renderer && npx ng test --include='src/app/console/**/*.spec.ts'` | Pass |
| AC2 component tests: completion popup | `ShellConsole > completion` (4 existing), `completion races and keys` (7 new), `completion helpers` | same | Pass |
| AC2 component tests: read-only banner | `ShellConsole > safety` (3 existing), e2e read-only test | same; e2e as above | Pass |
| Goal: multi-line input (Enter runs finished input) | "continues an unfinished input…", `isInputComplete` tables (15 existing + 8 new) | same | Pass |
| Goal: document output in explorer with plain-text toggle | "shows documents in the viewer…", "notes Type it for more…" | same | Pass |
| Goal: production accent | "marks production profiles…", "takes the production accent from the tab as well" | same | Pass |
| Assumption: Ctrl+C or Stop interrupts | "stops a running input…", "Ctrl+C stops…", "Ctrl+C does nothing while no input runs", "ignores output of a stopped run…" | same | Pass |
| Assumption: one shell tab per connection, opened from the connection or database menu | `SidebarTreeService > shell tabs` (5), `SidebarTree > open shell` (4) | `npx ng test --include='src/app/sidebar/**/*.spec.ts'` | Pass |
| Session lifecycle (close on destroy, late/overtaken open answers) | `session lifecycle` (8 new), "closes the session when the tab goes away" | console command above | Pass |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/app/console/**/*.spec.ts' --include='src/app/sidebar/**/*.spec.ts'`

Result:

Pass (4 files, 263 tests; console files alone: 2 files, 74 tests).

## Full test execution

Command:

`npm run check` (repo root: eslint + prettier --check, tsc type checks of all workspaces, vitest
root projects, `ng test` renderer)

Result:

Pass (root vitest 69 files / 3866 tests; renderer 83 files / 2537 tests; lint and type check clean).

E2E: `npm run test:e2e -- shell` -> 2 passed.

## .taskcheck

Result:

Pass (`sh .taskcheck` runs `npm run check`; the first attempt flagged Prettier formatting in two of
the new spec files, which were formatted with `npx prettier --write`; the rerun passed).

## Bugs found

None. No test exposed behavior that contradicts the acceptance criteria, SPEC.md or the recorded
assumptions.

## Coverage

Status: verified (fresh run on the final test snapshot, exit status 0).

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured (the provider reports whole files only; no changed-line tool is
configured). By inspection, the task's added lines in `sidebar-tree.ts` (open-shell menu items,
lines 412-417 and 445-449) and in `sidebar-tree.service.ts` (`openShell`) are all executed; every
uncovered location listed below is outside those added lines or is listed explicitly.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: shell-ui; base
  17f4bd01fce62c1c2fe17dde7672d91aabb5b574 (given by the parent, = "assume: shell-ui" commit);
  HEAD f9c972687f8bb69b797c37c94f07edd999a0675b; task commits 81c88fa and f9c9726 given by the parent
  and confirmed with `git diff --stat 17f4bd0..HEAD` (12 files, all belonging to the console tab).
- Source/test snapshot identifier (including uncommitted inputs): HEAD f9c9726 plus uncommitted spec
  files with sha256 `console-input.spec.ts` 8937ccd3…5883, `shell-console.spec.ts` cd69c32c…0c50,
  `sidebar-tree.service.spec.ts` 2276356d…6441, `sidebar-tree.spec.ts` 19dbf6c5…5669. No uncommitted
  production changes.
- Exact included files; renamed/deleted/excluded files and reasons: included
  `src/app/console/shell-console.ts`, `console-input.ts`, `shell-result.ts`, `index.ts`,
  `src/app/sidebar/sidebar-tree.service.ts`, `sidebar-tree.ts`, `src/app/app.config.ts` (paths
  relative to `packages/renderer`). Excluded: `shell-console.html` / `shell-console.css` (template
  and styles, not instrumented as separate files; the template is exercised by the component
  specs), `test/e2e/shell.e2e.ts` and the spec files (tests). No renames or deletions.
- Provider/version, command, working directory, and test selection: Vitest v5.1.0 with v8
  coverage via the Angular builder; `npx ng test --coverage --include='src/app/console/**/*.spec.ts'
  --include='src/app/sidebar/**/*.spec.ts' --coverage-include=<each file above>` in
  `packages/renderer`.
- Run start/completion time and exit status: started 2026-11-17 04:33:24 +0100, report written
  04:33:30 +0100; exit 0, 4 files / 263 tests passed.
- Generated report paths and report hashes/run identifier: `packages/renderer/coverage/renderer/`
  `coverage-summary.json` sha256 c06d716c…c347, `lcov.info` sha256 66340e3c…6dae (Git-ignored).
- Evidence outputs are fresh and inputs stayed unchanged: the report files' mtimes (04:33:30) are
  after the run start and replace the earlier run's files (04:30:36); the spec hashes were taken
  directly before the run and no file was edited afterwards.
- Final run after latest test additions and production fixes: yes (no production fixes were made).

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `src/app/console/shell-console.ts` | 230/237 (97.0%) | 151/161 (93.8%) | 49/53 (92.5%) | 194/196 (99.0%) |
| `src/app/console/console-input.ts` | 82/82 (100%) | 63/65 (96.9%) | 12/12 (100%) | 67/67 (100%) |
| `src/app/console/shell-result.ts` | 9/9 (100%) | 10/10 (100%) | 2/2 (100%) | 5/5 (100%) |
| `src/app/console/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `src/app/sidebar/sidebar-tree.service.ts` | 235/235 (100%) | 101/101 (100%) | 67/67 (100%) | 188/188 (100%) |
| `src/app/sidebar/sidebar-tree.ts` | 400/409 (97.8%) | 236/272 (86.8%) | 92/92 (100%) | 342/343 (99.7%) |
| `src/app/app.config.ts` | 0/1 (0%) | N/A | N/A | 0/1 (0%) |
| Aggregate (summed counters, all 7 files) | 956/973 (98.3%) | 561/609 (92.1%) | 222/226 (98.2%) | 796/800 (99.5%) |

No scoped file is missing from the report. `sidebar-tree.ts` and `sidebar-tree.service.ts` are
pre-existing files with small task changes, so their whole-file numbers mostly reflect older code.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `app.config.ts:16` | registers `provideTabView('shell', ShellConsole)` | not reachable from unit specs (app bootstrap); exercised by the e2e test, which opens the shell tab |
| `shell-console.ts:126,128` | `target` computed fallback (`profileId ?? ''`) and its `equal` function | `equal` only runs when the tab input changes; tabs never change profile (comment in the code). Not material |
| `shell-console.ts:148` | `failure()` returning `null` when the session is not failed | the template reads `failure()` only inside the `failed` case, so the `null` arm never runs; not material |
| `shell-console.ts:177` | auto-scroll when the transcript element is missing | defensive; element always exists |
| `shell-console.ts:196` | `.catch` of a failing `shell.close` for a stale session | fire-and-forget error swallow; not material |
| `shell-console.ts:212` (function) | `.catch` of a failing `shell.close` on close | same as above |
| `shell-console.ts:255` | `stop()` with no running run | Stop is only shown while running; Ctrl+C is guarded by `running()`. Not material |
| `shell-console.ts:267` | `finishRun` on a run that already finished | defensive guard; not reachable in normal flow |
| `shell-console.ts:368` | `complete()` while the session is not open | the input is disabled then; not material |
| `shell-console.ts:404` | `choose()` with an out-of-range index | defensive |
| `shell-console.ts:434` | `setInput` without the textarea | defensive |
| `shell-console.ts:118` (function) | `viewChild` query arrow | Angular-generated, not material |
| `console-input.ts:113,120` | `?? null` fallbacks in `ConsoleHistory` | unreachable by construction (index always in range) |
| `sidebar-tree.ts` 36 branches, line 341 | pre-existing keyboard/menu/prompt branches outside the task's added lines | outside task scope; no test added |

Gaps closed in this pass (were uncovered in the first coverage run of 04:30): `console-input.ts:59-60`
(unterminated string ending at a newline), `shell-console.ts:203` (failure of an overtaken open),
`:319` (ArrowDown above the last line), `:342/357` (other keys while the popup is open), `:392`
(cancelled completion request shows no note).

## Unable to test

- IME composition (`KeyboardEvent.isComposing` with Enter) is not covered: the spec does not
  define it and jsdom key events do not model composition; no follow-up required unless a human
  wants that behavior specified.
- Visual direction (Business/Tron tokens, no hard-coded colors) is a styling property of
  `shell-console.css`; not unit-testable here and left to the code review.

## Summary

Tests added and all validation passed. Tests and task-scoped coverage are sufficient; no production
defects found.

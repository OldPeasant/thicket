# Test Report

Date: 2026-11-17

Task: shell-ui (M4: mongosh console), round 2 on the final code

Scope: `git diff 944f76ddb91c9c188a353bd9944070a1ddc4c99d..e962c42895d90d9ac1fa0b5a268643976ab0141e`
(task commits 977cdd1 "Add the mongosh console tab", edecbd7 "Add console specs and the demo step 11
e2e", 317fb7c round-1 tests and reports, e962c42 fixes CR-1..CR-5), branch `main`, HEAD e962c42,
plus the uncommitted test-only changes listed below. Focus of this round: what e962c42 changed
(completion anchored to the requested code/cursor and closed when the caret moves, regex literals in
`isInputComplete`, failure notice outside the transcript, live-region announcements, `aria-controls`
only while open, e2e opening the shell from the connection menu).

Requirements:
- `tasks/shell-ui.md` acceptance criteria and recorded assumptions
- `SPEC.md` M4 Shell and demo step 11; Safety section
- `reviews/shell-ui/review.md` findings CR-1..CR-5 and `reviews/shell-ui/fixes.md` (fixed behavior)
- `docs/ARCHITECTURE.md` "Coverage"; `docs/QUALITY.md`

## Test files changed

- `packages/renderer/src/app/console/shell-console.spec.ts`
- `packages/renderer/src/app/console/console-input.spec.ts`

No production file was changed. (`reviews/shell-ui/review.md` shows as modified in the working tree;
that is not a change of this helper.)

## Tests added or updated

Count: 20 added, 0 updated.

- `shell-console.spec.ts`, "completion races and keys" (4 added, CR-1/CR-4):
  - "closes the popup when a selection is made inside the input" (`select` event with a
    non-collapsed selection closes the list, `aria-expanded` false, input unchanged);
  - "a click on an option applies it at the requested caret, not a moved one" (mousedown on an
    option after the caret moved without a caret event: `db.or()` with caret 5 -> `db.orgs()`,
    caret after `db.orgs`, mousedown default prevented so the input keeps focus);
  - "closes the list without applying when the input text changed behind it" (the `choose()` guard
    for `el.value !== completionAt.code`: list closes, the text stays, nothing runs);
  - "Escape closes the list and drops aria-controls and the active option" (`aria-controls` equals
    the listbox id while open, both `aria-controls` and `aria-activedescendant` removed after
    Escape; a later click with no list is harmless).
- `shell-console.spec.ts`, top level (2 added, CR-3/CR-4):
  - "shows an open failure outside the transcript, without the starting note" (open failure:
    `role="alert"` notice not inside `shell-transcript`, "Starting mongosh…" gone, nothing announced);
  - "announces a run error that is not a lost session, and keeps the session".
- `shell-console.spec.ts`, new `describe('announce')` (4 added, CR-4): stopped wins over outputs;
  the first error is read even after a result; an error of exactly 200 characters is not cut, a
  longer one is cut at 200 with `…`; result type named when present, "Run finished" for no type,
  print-only or empty runs.
- `console-input.spec.ts`, `isInputComplete edge cases` (10 rows added, CR-2): escaped `]` inside a
  class keeps `/` and `(` inside the regex; flags consumed before a following open bracket; line
  comment after a regex; unterminated regex ending at its line (next line's `(` counts) and at the
  end of input (runs); whitespace/newlines and a block comment before a regex do not count as the
  last character; a regex right after `[`; `/` after an identifier divides (across a newline);
  division followed by a line comment.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 e2e: demo step 11 (`db.orders.countDocuments()`), opened from the connection menu (CR-5) | `test/e2e/shell.e2e.ts` "demo step 11: run db.orders.countDocuments() in the mongosh console", "a read-only profile opens the shell with a warning" (database menu) | `npm run test:e2e -- shell` (repo root; builds renderer + desktop, Playwright Electron against the Mongo fixture) | Pass (2 passed) |
| AC2 component tests: history navigation | `ShellConsole > history`, `ConsoleHistory` | `cd packages/renderer && npx ng test --include='src/app/console/**/*.spec.ts' --include='src/app/sidebar/**/*.spec.ts'` | Pass |
| AC2 component tests: completion popup (incl. CR-1 caret anchoring, CR-4 ARIA) | `ShellConsole > completion`, `completion races and keys` (incl. 3 CR-1 specs from e962c42 and the 4 added here), `completion helpers` | same | Pass |
| AC2 component tests: read-only banner | `ShellConsole > safety`, e2e read-only test | same; e2e as above | Pass |
| CR-2 regex literals in multi-line input | `isInputComplete edge cases` (7 rows from e962c42 + 10 added) | same | Pass |
| CR-3 failure notice outside the scrolling transcript | "offers a new session when the backend lost this one", "shows an open failure outside the transcript…" | same | Pass |
| CR-4 live-region summary, `aria-controls` only while open | "announces a short summary of each run…", "announces a run error that is not a lost session…", `announce` (4), "Escape closes the list and drops aria-controls…" | same | Pass |
| Opening from connection and database menus | `SidebarTreeService > shell tabs`, `SidebarTree > open shell`, e2e (both menus) | focused command and e2e above | Pass |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/app/console/**/*.spec.ts' --include='src/app/sidebar/**/*.spec.ts'`

Result:

Pass (4 files, 296 tests, before the last added row; the final snapshot ran in the full renderer
suite below: 86 files / 2774 tests).

## Full test execution

Command:

`npm run check` (repo root: eslint + prettier --check, type checks of all workspaces, root vitest,
renderer `ng test`)

Result:

Pass (root vitest 73 files / 4038 tests; renderer 86 files / 2774 tests; lint, format and type
checks clean), on the final test snapshot.

E2E: `npm run test:e2e -- shell` -> Pass, 2 passed (demo step 11 from the connection menu 2.7 s,
read-only from the database menu 1.5 s).

## .taskcheck

Result:

Pass (`.taskcheck` runs `npm run check` when `package.json` exists; that command was run directly
above on the final snapshot).

## Bugs found

None. No test exposed behavior that contradicts the acceptance criteria, SPEC.md, the recorded
assumptions or the fixes described for CR-1..CR-5.

Observation (not a defect, no test fails): the regex heuristic decides by the previous character
only, so `/` after a keyword (`return /(/`) is treated as a division and `/` after `a++` as a regex
start. This is the same heuristic as the backend splitter (`packages/backend/src/shell/split.ts`,
`regexMayStart`), so the console and the backend agree; the worst case is Enter adding a line
instead of running (or the reverse, with mongosh reporting the syntax error).

## Coverage

Status: verified (fresh run on the final test snapshot, exit status 0, round 2).

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: measured by hand from the fresh `lcov.info` (provider source-mapped `DA`
records intersected with the added lines of `git diff 944f76d..e962c42`): new files
`shell-console.ts`, `console-input.ts`, `shell-result.ts`, `index.ts` are entirely added, so their
changed-line coverage equals whole-file line coverage (316/318); `sidebar-tree.service.ts`
`openShell` (executable lines 408-412, 414, 415) 7/7; `sidebar-tree.ts` open-shell menu items
(executable lines 416, 448) 2/2; `app.config.ts` changes (import line 11, line 26 inside the
`appConfig` statement) have no own `DA` record, the enclosing statement (line 17) is hit. Total
325/327 (99.4%) changed executable lines. Changed-branch coverage not measured.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: shell-ui; base
  944f76ddb91c9c188a353bd9944070a1ddc4c99d (given by the parent); HEAD
  e962c42895d90d9ac1fa0b5a268643976ab0141e; task commits 977cdd1, edecbd7, 317fb7c, e962c42 given by
  the parent and confirmed with `git log` / `git diff --stat 944f76d..HEAD`.
- Source/test snapshot identifier (including uncommitted inputs): HEAD e962c42 plus uncommitted spec
  files with sha256 `console-input.spec.ts`
  58fd890efb95075f6023d9e5ce6cfc3c56bd0f423b4849cefe7bc0ef2d7987aa, `shell-console.spec.ts`
  a084e2cedb782d7d7f3a68fe925209aa99db6eb3c2902664cbfda9f2140ae524. No uncommitted production
  changes (`git status --short`: only those two specs and `reviews/shell-ui/review.md`).
- Exact included files; renamed/deleted/excluded files and reasons: included (relative to
  `packages/renderer`) `src/app/console/shell-console.ts`, `console-input.ts`, `shell-result.ts`,
  `index.ts`, `src/app/sidebar/sidebar-tree.service.ts`, `sidebar-tree.ts`, `src/app/app.config.ts`.
  Excluded: `shell-console.html` / `shell-console.css` (template and styles, compiled into the
  component; the template is exercised by the component specs and e2e), `test/e2e/shell.e2e.ts`,
  spec files, `reviews/`. No renames or deletions.
- Provider/version, command, working directory, and test selection: Vitest v5.1.0 with v8 coverage
  via the Angular builder; `npx ng test --coverage --coverage-include='src/app/console/console-input.ts'
  --coverage-include='src/app/console/shell-console.ts' --coverage-include='src/app/console/shell-result.ts'
  --coverage-include='src/app/console/index.ts' --coverage-include='src/app/sidebar/sidebar-tree.ts'
  --coverage-include='src/app/sidebar/sidebar-tree.service.ts' --coverage-include='src/app/app.config.ts'`
  in `packages/renderer`; test selection: the whole renderer suite (86 files, 2774 tests).
- Run start/completion time and exit status: started 2026-11-17 04:44:09 +0100, reports written
  04:44:33 +0100; exit 0, 2774 tests passed.
- Generated report paths and report hashes/run identifier: `packages/renderer/coverage/renderer/`
  `coverage-summary.json` sha256 ee39056335eb795e330c31b0e3113d19e54704e058a1f6937122a8c78a2b6b6a,
  `lcov.info` sha256 8c7baf2dbef6d87c5761dcd695d5ba6cd20163a1f74aac967d523961ad0b1f6a (Git-ignored).
- Evidence outputs are fresh and inputs stayed unchanged: the report mtimes (04:44:33) follow the
  run start and replace the previous run (04:43:30); the spec hashes above were taken after the run
  and no test or production file was edited after it.
- Final run after latest test additions and production fixes: yes (covers e962c42 and all tests
  added in this round; no production change since).

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `src/app/console/shell-console.ts` | 258/266 (97.0%) | 173/183 (94.5%) | 53/57 (93.0%) | 217/219 (99.1%) |
| `src/app/console/console-input.ts` | 114/114 (100%) | 89/91 (97.8%) | 14/14 (100%) | 94/94 (100%) |
| `src/app/console/shell-result.ts` | 9/9 (100%) | 10/10 (100%) | 2/2 (100%) | 5/5 (100%) |
| `src/app/console/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `src/app/sidebar/sidebar-tree.service.ts` | 235/235 (100%) | 102/102 (100%) | 67/67 (100%) | 188/188 (100%) |
| `src/app/sidebar/sidebar-tree.ts` | 400/409 (97.8%) | 238/272 (87.5%) | 92/92 (100%) | 342/343 (99.7%) |
| `src/app/app.config.ts` | 1/1 (100%) | N/A | N/A | 1/1 (100%) |
| Aggregate (summed counters, all 7 files) | 1017/1034 (98.4%) | 612/658 (93.0%) | 228/232 (98.3%) | 847/850 (99.6%) |

No scoped file is missing from the report. `sidebar-tree.ts` and `sidebar-tree.service.ts` are
pre-existing files with small task changes, so their whole-file numbers mostly reflect older code.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `shell-console.ts:145` (branch), `:147` (line, `equal` function) | `target` fallback `profileId ?? ''` and its `equal` comparator | `equal` only runs when the tab input changes; a tab never changes profile. Not material |
| `shell-console.ts:200` (branch) | auto-scroll when the transcript element is missing | defensive; the element always exists |
| `shell-console.ts:219` (line) and the `.catch` callbacks (2 functions) | swallowing a failing `shell.close` | fire-and-forget error swallow; not material |
| `shell-console.ts:278` (branch) | `stop()` with no running run | Stop is only shown while running; Ctrl+C is guarded by `running()`. Not material |
| `shell-console.ts:291`, `:296` (branches) | `finishRun` on a run that already finished | defensive guard; a stopped run's stream is unsubscribed first |
| `shell-console.ts:393` (branch) | `complete()` while the session is not open | the input is disabled then; not material |
| `shell-console.ts:434` (branch) | `choose()` guard for no completion / no stored position / no textarea | defensive; the reachable part of the CR-1 guard (input text changed, line 435) is now covered by "closes the list without applying when the input text changed behind it" |
| `shell-console.ts:482` (branch) | `setInput` without the textarea | defensive |
| `shell-console.ts` 1 further uncovered function | Angular-generated `viewChild` query arrow | not material |
| `console-input.ts:162,169` (branches) | `?? null` fallbacks in `ConsoleHistory` | unreachable by construction (index always in range) |
| `sidebar-tree.ts` line 341 and 34 branches | pre-existing keyboard/menu/prompt branches outside the task's added lines | outside task scope; the task's added lines (416, 448) are covered |

Gap closed in this round: `console-input.ts:96` (`regexEnd` reaching the end of input with an
unterminated regex), covered by the row `'x = /a([{' -> true`. The fixed CR-1 `onCaret` branches
(line 450) are fully covered.

## Unable to test

- IME composition (`KeyboardEvent.isComposing` with Enter): the spec does not define it and jsdom key
  events do not model composition; no follow-up required unless a human wants it specified.
- Screen-reader output of the live region: the specs check the `role="status"` / `aria-live` element
  and its text; what an actual screen reader reads is not testable here.
- Visual direction (Business/Tron tokens, the `--danger-*` tokens of the moved failure notice) is a
  styling property of `shell-console.css`; left to the code review.

## Summary

Tests added and all validation passed. Tests and task-scoped coverage are sufficient; no production
defects found.

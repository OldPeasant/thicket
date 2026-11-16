# Test Report

Date: 2026-11-16

Task: sidebar-tree - M1: Sidebar tree of connections, databases, collections (round 4, final code)

Scope: task base `fc84d7a400ffc80511c5e7337fabf160126c7369` .. final code HEAD
`55112cc788616a5217e51493da6bc10523fe7f00` (branch `main`, clean before this run). Focus of this
round: the round-3 CR-1 fix in commit 55112cc (`connect()` in `sidebar-tree.service.ts` ignores a
`conn.open` answer made stale by a disconnect, a newer connect, a `disconnected`/`error` status
broadcast or `backend.restarted`; generation key `conn:<profileId>`). Earlier rounds:
`reviews/sidebar-tree/round1..round3/`.

Requirements:
- `tasks/sidebar-tree.md` acceptance criteria and its recorded assumptions
- `reviews/sidebar-tree/round3/review.md` CR-1 and `reviews/sidebar-tree/fixes.md` (the fix intent)
- `docs/ARCHITECTURE.md` "Coverage", existing spec conventions (`FakeThicketBridge`, deferred answers)

## Test files changed

- `packages/renderer/src/app/sidebar/sidebar-tree.service.spec.ts`
- `packages/renderer/src/app/sidebar/sidebar-tree.spec.ts`

## Tests added or updated

Count: 7 added, 0 changed.

Service spec, `SidebarTreeService > connections`:
- `a conn.open answering after backend.restarted is ignored (success and failure)` (two profiles
  connecting; one late success, one late failure; both stay `disconnected`, no database list)
- `a connect started after backend.restarted is current again` (the restart does not leave the
  generation permanently stale)
- `a disconnected broadcast while connecting keeps a late CANCELLED from showing an error`
- `an error broadcast while connecting wins over the late conn.open rejection` (the caller, e.g. the
  password prompt, still gets an `error` view, with the broadcast's message)
- `a connected broadcast while connecting does not make the attempt stale` (databases still load)
- `disconnecting a profile whose id is a prefix keeps another profile connect current` (`p1` vs
  `p10`: the `forgetProfile` matcher does not over-match)

Component spec, `SidebarTree > tree details`:
- `Disconnect while connecting shows the node not connected, without an error` (context menu
  Disconnect while `conn.open` is pending, then `CANCELLED`: node `data-state="disconnected"`, no
  "cancelled" text, no `db.listDatabases`)

### The fix's tests fail without the fix

The two `if (!this.current(key, gen)) return this.conn(profileId);` lines in `connect()` were
removed temporarily (Edit), and `npx ng test --include='src/app/sidebar/*.spec.ts'` was run:
8 failed / 165 passed. Failing: the 4 tests added by the fixer (`a conn.open cancelled by Disconnect
while connecting leaves the profile not connected`, `a late success of a conn.open made stale by
Disconnect is ignored`, `a late failure of an older conn.open does not mark a reconnected profile
failed`, `a newer connect makes the older attempt stale without a disconnect`) and 4 of this round's
new tests (backend.restarted, disconnected broadcast, error broadcast, component Disconnect while
connecting). The other 3 new tests pass with and without the fix on purpose: they guard against the
fix invalidating too much (connected broadcast, connect after restart, id prefix). The two lines were
then restored; `git diff` shows no production change and `sidebar-tree.service.ts` hashes to the
HEAD blob (sha256 `23b3ffe3...`) again.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: component tests with the fake API for lazy load, errors, context actions | `sidebar-tree.spec.ts` "lazy loading", "errors", "context actions", "tree details" (incl. the new Disconnect-while-connecting test) and `sidebar-tree.service.spec.ts` | `cd packages/renderer && npx ng test --include='src/app/sidebar/*.spec.ts'` | Pass (2 files, 173 tests) |
| AC2: e2e against a fixture: create db+collection, rename, drop with typed name | `create a database and collection, rename, and drop with the typed name` | `npm run test:e2e -- test/e2e/sidebar.e2e.ts` (repo root) | Pass (2 passed) |
| AC3: read-only profile hides/disables write actions | `a read-only profile disables the write actions` (e2e); "read-only profiles" (component) | both commands above | Pass |
| Round-3 CR-1: a stale `conn.open` answer never overwrites the state after Disconnect / reconnect | 4 fixer tests + 7 new tests listed above | focused command above; also run with the fix reverted (8 fail) | Pass (fail without the fix) |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/app/sidebar/*.spec.ts'`

Result:

Pass: 2 test files, 173 tests (166 before this round + 7 new).

## Full test execution

Command:

`npm run check` (repo root: eslint `--max-warnings 0`, prettier `--check`, type check, root vitest,
renderer unit tests)

Result:

Pass. Prettier: all files formatted. Root vitest: 46 files, 2829 tests passed. Renderer: 46 files,
1011 tests passed.

`npm run test:e2e -- test/e2e/sidebar.e2e.ts` (repo root; builds renderer and desktop, Playwright
against the Electron app and its fixture): Pass, 2 passed (7.8s).

## .taskcheck

Result:

Pass (it runs `npm run check`, see above).

## Bugs found

None.

Observation, not a defect: the backend does not currently emit `conn.status` broadcasts (no emitter
in `packages/backend/src`), so the broadcast-while-connecting cases are covered only at the
service/fake level. Their behaviour matches the backend's own semantics (a close while connecting
ends `conn.open` with `CANCELLED`).

## Coverage

Status: verified (fresh run on the final code HEAD 55112cc plus this round's uncommitted tests,
exit 0).

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured as an aggregate (no changed-line mode is configured). The fix
lines were checked individually in `coverage-final.json` (`sidebar-tree.service.ts`): the stale guard
after a successful answer (line 223) has branch counts [2, 92] and the stale guard in `catch`
(line 226) has [7, 3]; both branches of each guard ran.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `sidebar-tree`;
  base `fc84d7a400ffc80511c5e7337fabf160126c7369` (supplied by the parent); HEAD
  `55112cc788616a5217e51493da6bc10523fe7f00`; task commits `git log fc84d7a..HEAD` (da631c2 ..
  55112cc, all `sidebar-tree:`); file list from `git diff --stat fc84d7a..HEAD`.
- Source/test snapshot identifier (including uncommitted inputs): HEAD 55112cc plus the two
  uncommitted spec files. sha256 before and after the run: `sidebar-tree.spec.ts`
  dcfc66b14b5beca4a028c29f9572cbd3ec07ac59376d1cd4d7e1a3d820a6be3d, `sidebar-tree.service.spec.ts`
  5e93f737c74e0bdab636f0a6efeee2fe75adb4909f94037150689ecc9460d2de, `app-shell.spec.ts` (= HEAD)
  f79d5ff59af9fc6f71a7f8ef382df7d54a1c676dabb368f1a3e4b84e33f5f9a7. Production (= HEAD):
  `sidebar-tree.service.ts` 23b3ffe30493a45a6bc2fde94f9bcd4dd35f8467c7d9eee0ddfff885996eee0d,
  `sidebar-tree.ts` 2c52897f7f33b48b5e7b249d8e96a0606b1f1f9c376ee2b007b2698d9f84f7f5,
  `sidebar-tree.html` f718351526a31722ee6d88c55bc92b4d81e24fa3f4c5a87e699e83ebbca58974,
  `sidebar-format.ts` 103a560abcc1db0a632802b9067066e0ebcb43fe2a2ee17dc84f501c31419b51,
  `app-shell.ts` c426d0fa58bec745f692191bdaff87c8d1018765ad436cea914a590a75565022.
- Exact included files; renamed/deleted/excluded files and reasons: included
  `src/app/sidebar/sidebar-tree.service.ts`, `src/app/sidebar/sidebar-tree.ts` (template
  `sidebar-tree.html` compiled into it), `src/app/sidebar/sidebar-format.ts`,
  `src/app/layout/app-shell.ts`. Excluded: `src/app/sidebar/index.ts` (re-exports only),
  `sidebar-tree.css`, `app-shell.css` (styles), `docs/ARCHITECTURE.md` and `reviews/` (docs),
  spec/e2e files (tests). No renames or deletions.
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8` 5.1.0
  through `@angular/build` 22.2.7 (unit-test builder), in `packages/renderer`:
  `npx ng test --include src/app/sidebar --include src/app/layout/app-shell.spec.ts --coverage --coverage-include='src/app/sidebar/sidebar-tree.service.ts' --coverage-include='src/app/sidebar/sidebar-tree.ts' --coverage-include='src/app/sidebar/sidebar-format.ts' --coverage-include='src/app/layout/app-shell.ts' --coverage-reporters json --coverage-reporters json-summary --coverage-reporters text`
- Run start/completion time and exit status: started 23:03:29, report written 23:03:35; 3 files /
  226 tests passed, exit 0.
- Generated report paths and report hashes/run identifier (git-ignored):
  `packages/renderer/coverage/renderer/coverage-summary.json` sha256
  57a0c73d2eb29055d75621367b8fa49943d104b16fb32b22180383112ed7f6d4,
  `packages/renderer/coverage/renderer/coverage-final.json` sha256
  187ff6edbb35e7cc29e023d35733667ff12e31651f3f7116411e3d73cca3ce51.
- Evidence outputs are fresh and inputs stayed unchanged: yes; both report files have mtime
  23:03:35 from this run, and the input hashes taken before the run matched after it.
- Final run after latest test additions and production fixes: yes (final production code 55112cc,
  all 7 new tests included; production restored to HEAD before the run).

Values below use covered/total (percentage).

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/sidebar/sidebar-tree.service.ts` | 227/227 (100%) | 94/94 (100%) | 65/65 (100%) | 181/181 (100%) |
| `packages/renderer/src/app/sidebar/sidebar-tree.ts` | 396/405 (97.78%) | 238/272 (87.5%) | 89/89 (100%) | 338/339 (99.71%) |
| `packages/renderer/src/app/sidebar/sidebar-format.ts` | 9/9 (100%) | 8/8 (100%) | 2/2 (100%) | 9/9 (100%) |
| `packages/renderer/src/app/layout/app-shell.ts` | 120/121 (99.17%) | 76/76 (100%) | 25/26 (96.15%) | 87/87 (100%) |
| Aggregate (summed counters of the 4 files; excluded: index.ts, CSS; none unmeasured) | 752/762 (98.69%) | 416/450 (92.44%) | 181/182 (99.45%) | 615/616 (99.84%) |

`sidebar-tree.ts` is unchanged since round 3 (same hash), so its uncovered locations are the ones
round 3 analysed; they are repeated here.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `sidebar-tree.service.ts` | `connect()` stale guards (CR-1 fix) | Fully covered; both branches of both guards ran, and the tests fail without the guards |
| `sidebar-tree.ts:306` (coll stats `loading` text) | placeholder while coll.stats loads | Same placeholder for db stats is tested; service spec covers the loading state. Low risk |
| `sidebar-tree.ts:334, 336-340` (`toggle` on a collection row; no-op when already in the requested state) | defensive guards | Not reachable through the UI for collections; main expand/collapse paths tested |
| `sidebar-tree.ts:346-347` (connected connection whose list is already loaded / connecting) | expand-edge combinations | Main paths tested; low risk |
| `sidebar-tree.ts:547, 553, 596` (closeMenu with no menu, disabled item chosen, mousedown with no menu) | defensive guards | Disabled items tested through the DOM |
| `sidebar-tree.ts:564` (menu element or window missing) | defensive | Not reachable while a menu renders |
| `sidebar-tree.ts:637` (prompt replaced while its submit fails) | race | Not reachable: the prompt is modal while its submit runs |
| `sidebar-tree.ts:684` (`move` with no target) | empty node list | Not reachable: keydown comes from an existing node |
| `sidebar-tree.ts` branch-only locations 163, 229, 240, 282, 364, 369-370, 499, 509, 533, 538-539, 589, 616, 635, 705, 712, 754, 765 | `??` fallbacks, optional chaining, menu position fallbacks | Defensive; no acceptance criterion depends on them |
| `app-shell.ts` (1 statement / 1 function: the `viewChild.required` initializer) | pre-existing code | Outside task scope |

## Unable to test

- `conn.status` broadcasts while connecting against the real backend: the backend emits no such
  broadcast today, so these paths are tested with the fake API only. No follow-up needed for this
  task.
- Visual appearance (CSS) is not asserted, as in earlier rounds; not required by the criteria.

## Summary

Tests added and all validation passed. The round-3 CR-1 fix is confirmed: its 4 tests (and 4 of the
7 new ones) fail when the two stale guards are removed and pass with them; the 3 other new tests show
the fix does not invalidate too much. No production defects found. Test changes and this report are
uncommitted for the parent worker.

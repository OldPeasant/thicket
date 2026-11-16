# Test Report

Date: 2026-11-16

Task: sidebar-tree - M1: Sidebar tree of connections, databases, collections (round 3, final code)

Scope: task commits `add6545e8ae22053fd562cc7544640b14abdd408..d21e62c0939a8985db1371202e0027831b35660d`
(10 commits, c60306a..d21e62c, base and HEAD supplied by the parent and confirmed with
`git log --oneline add6545..HEAD` / `git diff --stat add6545..HEAD`), branch `main`, focus on the
round-2 CR-1 fix d21e62c. Uncommitted at measurement time: only this round's additions to
`packages/renderer/src/app/sidebar/sidebar-tree.spec.ts` (+105 lines, tests only).

Requirements:
- tasks/sidebar-tree.md (acceptance criteria and recorded assumptions)
- SPEC.md / docs/ARCHITECTURE.md "Sidebar tree" and "Coverage"
- docs/QUALITY.md (report contract)
- reviews/sidebar-tree/round2/review.md (CR-1) and reviews/sidebar-tree/fixes.md (its fix)
- Parent instructions (final round; add tests only for real gaps)

## Test files changed

- `packages/renderer/src/app/sidebar/sidebar-tree.spec.ts`

## Tests added or updated

Count: 4 (new `describe('create prompts on lists not loaded yet (round 3)')`)

- `does not request the collections again while the list from the prompt still loads` - the
  "loading" half of the new guard: opening Create collection… twice on a collapsed database while
  the first `coll.list` is still pending sends one request; after it answers the list replaces the
  "Loading collections…" line.
- `keeps the created collection when the list started by the prompt answers last` - ordering: the
  `coll.list` started when the prompt opened is held back, the user creates `fresh`, the reload
  after `coll.create` answers first; the older list (without `fresh`) answering last must not
  replace it.
- `keeps the created database when the list started by the prompt answers last` - the same race
  for Create database… on a connection that `conn.status` reports as connected but was never
  listed (no `conn.open`, 2 `db.listDatabases`, `newdb` stays).
- `a failed list started by the prompt shows the error with a retry after cancelling` - error path
  of the new load: cancelled prompt, failing `coll.list` shows the error, no stuck loading line.

All four pass on the final code. Existing tests were not changed.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 Component tests with the fake API: lazy load | `sidebar-tree.spec.ts` "lazy loading" (11 tests), service spec "lists"/"profiles" | `cd packages/renderer && npx ng test --include='src/app/sidebar/*.spec.ts'` | Pass |
| AC1 errors | "errors" (5), "shows a failed database list with a retry", stats failures, service spec error/out-of-order tests, new "a failed list started by the prompt…" | same | Pass |
| AC1 context actions (create/rename/drop with typed name, stats, disconnect, refresh, open) | "context actions" (9), "menu details" (12), "prompt details" (9) | same | Pass |
| Round-2 CR-1 fix: create prompts load never-loaded lists | "cancelling Create collection… on a collapsed database…", "cancelling Create database… on an open connection never listed…", the 4 round-3 tests above | same | Pass |
| AC2 e2e against a fixture: create db+collection, rename, drop with typed name | `test/e2e/sidebar.e2e.ts` "create a database and collection, rename, and drop with the typed name" | `npm run test:e2e -- test/e2e/sidebar.e2e.ts` (repo root; Electron app built by the script, MongoDB fixture `mongo8` = `docker.io/library/mongo:8.2` via testcontainers) | Pass (ran, not skipped) |
| AC3 Read-only profile hides/disables write actions | component "read-only profiles" (3), service "writes on a read-only profile are refused without a request"; e2e "a read-only profile disables the write actions" | both commands above | Pass |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/app/sidebar/*.spec.ts'`

Result:

Pass - 2 files, 162 tests (158 before this round + 4 new).

## Full test execution

Command:

`npm run check` (repo root: eslint, prettier, tsc for every workspace, root vitest, renderer `ng test`)

Result:

Pass (exit 0) - root vitest 44 files / 2684 tests; renderer 46 files / 1000 tests. A first run
failed at `prettier --check` on the new spec lines; fixed with `npx prettier --write` on the spec
file, then the run above passed.

E2E command:

`npm run test:e2e -- test/e2e/sidebar.e2e.ts` (repo root)

Result:

Pass - 2 passed (7.6s): `sidebar.e2e.ts:66` create/rename/drop with typed name (4.1s),
`sidebar.e2e.ts:147` read-only profile disables the write actions (973ms).

## .taskcheck

Result:

Pass - `.taskcheck` runs `npm run check`, which passed (above). `.taskcheck` itself was not invoked
separately.

## Bugs found

None. No production defect was found in this round.

## Coverage

Status: verified (fresh run on the final code plus this round's tests, exit 0).

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured as an aggregate (no changed-line mode is configured). The
round-3 fix lines were checked individually in `coverage-final.json`: the guard at
`sidebar-tree.ts:477` has branch counts [2, 2] and the guard at `:496` has [14, 3]. Both branches
of each guard ran.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `sidebar-tree`;
  base `add6545e8ae22053fd562cc7544640b14abdd408`; HEAD `d21e62c0939a8985db1371202e0027831b35660d`;
  commits base..HEAD as supplied by the parent, file list from `git diff --stat add6545..HEAD`.
- Source/test snapshot identifier (including uncommitted inputs): HEAD d21e62c plus the uncommitted
  spec, sha256 before and after the run: `sidebar-tree.spec.ts`
  6aee2448edb9267439c10772ceba15fc00720775b9a69a5ff1761069f90bc294, `sidebar-tree.service.spec.ts`
  3fe6784ba5bfbe2a91b7225849b9a22421aeac8d9c905f578c360b328c376154, `app-shell.spec.ts`
  f79d5ff59af9fc6f71a7f8ef382df7d54a1c676dabb368f1a3e4b84e33f5f9a7. Production (= HEAD):
  `sidebar-tree.ts` 2c52897f7f33b48b5e7b249d8e96a0606b1f1f9c376ee2b007b2698d9f84f7f5,
  `sidebar-tree.service.ts` b261db2d1d3829e057a8b0777d2abcd981ff68806b11d0cbd3f885d4f959c6bb,
  `sidebar-tree.html` f718351526a31722ee6d88c55bc92b4d81e24fa3f4c5a87e699e83ebbca58974,
  `sidebar-format.ts` 103a560abcc1db0a632802b9067066e0ebcb43fe2a2ee17dc84f501c31419b51,
  `app-shell.ts` c426d0fa58bec745f692191bdaff87c8d1018765ad436cea914a590a75565022.
- Exact included files; renamed/deleted/excluded files and reasons: included
  `src/app/sidebar/sidebar-tree.service.ts`, `src/app/sidebar/sidebar-tree.ts` (template
  `sidebar-tree.html` is compiled into it), `src/app/sidebar/sidebar-format.ts`,
  `src/app/layout/app-shell.ts`. Excluded: `src/app/sidebar/index.ts` (re-exports only),
  `sidebar-tree.css`, `app-shell.css` (styles), `docs/ARCHITECTURE.md` and `reviews/` (docs),
  spec/e2e files (tests). No renames or deletions.
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8` 5.1.0
  through `@angular/build` 22.2.7 (unit-test builder), in `packages/renderer`:
  `npx ng test --include src/app/sidebar --include src/app/layout/app-shell.spec.ts --coverage --coverage-include='src/app/sidebar/sidebar-tree.service.ts' --coverage-include='src/app/sidebar/sidebar-tree.ts' --coverage-include='src/app/sidebar/sidebar-format.ts' --coverage-include='src/app/layout/app-shell.ts' --coverage-reporters json --coverage-reporters json-summary --coverage-reporters text`
- Run start/completion time and exit status: started 22:54:07, report written 22:54:12, 3 files /
  215 tests passed, exit 0.
- Generated report paths and report hashes/run identifier (git-ignored):
  `packages/renderer/coverage/renderer/coverage-summary.json` sha256
  8c710727cf208b12df925f1a456147c159e7503a69312e8b2e0bbecae90762fd,
  `packages/renderer/coverage/renderer/coverage-final.json` sha256
  600df9d2a9d97b95459239e4bde909922e5125466ab4a57930e1c0dc4c445516.
- Evidence outputs are fresh and inputs stayed unchanged: yes; both report files have mtime
  22:54:12 from this run, and the input hashes taken at 22:53:58 matched after the run.
- Final run after latest test additions and production fixes: yes (final production code d21e62c,
  all 4 new tests included).

Values below use covered/total (percentage).

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/sidebar/sidebar-tree.service.ts` | 221/221 (100%) | 90/90 (100%) | 65/65 (100%) | 177/177 (100%) |
| `packages/renderer/src/app/sidebar/sidebar-tree.ts` | 396/405 (97.77%) | 238/272 (87.5%) | 89/89 (100%) | 338/339 (99.7%) |
| `packages/renderer/src/app/sidebar/sidebar-format.ts` | 9/9 (100%) | 8/8 (100%) | 2/2 (100%) | 9/9 (100%) |
| `packages/renderer/src/app/layout/app-shell.ts` | 120/121 (99.17%) | 76/76 (100%) | 25/26 (96.15%) | 87/87 (100%) |
| Aggregate (summed counters of the 4 files; excluded: index.ts, CSS; none unmeasured) | 746/756 (98.67%) | 412/446 (92.37%) | 181/182 (99.45%) | 611/612 (99.83%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `sidebar-tree.ts:306` (coll stats `loading` text `…`) | placeholder while coll.stats loads | Same placeholder for db stats is tested ("shows a placeholder while stats load"); service spec covers coll.stats loading state. Low risk, no test added |
| `sidebar-tree.ts:334, 336-340` (`toggle` on a collection row; no-op when already in the requested state) | defensive guards; `activate`/keys never toggle collections | Not reachable through the UI for collections; main expand/collapse paths are tested |
| `sidebar-tree.ts:346-347` (connected connection whose list is already loaded/connecting) | expand-edge combinations | Main paths tested (collapse/re-expand without reload, already-open connection); low risk |
| `sidebar-tree.ts:547, 553, 596` (closeMenu with no menu, disabled item chosen, mousedown with no menu) | defensive guards | Read-only disabled items are tested through the DOM (disabled buttons cannot be clicked) |
| `sidebar-tree.ts:564` (menu element or window missing) | defensive | Not reachable while a menu renders |
| `sidebar-tree.ts:637` (prompt replaced while its submit fails) | race | Not reachable: the prompt is modal while its submit runs |
| `sidebar-tree.ts:684` (`move` with no target) | empty node list | Not reachable: keydown comes from an existing node |
| `sidebar-tree.ts` branch-only locations 163, 229, 240, 282, 364, 369-370, 499, 509, 533, 538-539, 589, 616, 635, 705, 712, 754, 765 | `??` fallbacks for unknown profiles/messages, optional chaining on missing elements, menu position fallbacks | Defensive fallbacks; no acceptance criterion depends on them |
| `app-shell.ts` (1 statement / 1 function: the `viewChild.required` initializer) | pre-existing code | Outside task scope (also noted in round 1) |

## Unable to test

- Visual appearance (connection colour guide line, CSS) is not asserted; the e2e writes a
  screenshot that nothing compares. Not required by the acceptance criteria; no follow-up needed.

## Summary

Tests added and all validation passed. The four new tests cover the "already loading" guard, the
older-list-answers-last race and the error path of the round-2 CR-1 fix; no production defects were
found. The test changes and this report are uncommitted: the parent worker commits them.

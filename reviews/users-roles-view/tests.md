# Test Report

Date: 2026-11-17

Task: users-roles-view — M6 (Should): Users and roles viewer

Scope: `git diff 62aa9cda12109876a24c3621abdc10c0dca3b22a..096eefe401fe144cb7b1abfa3db58ac361988233` on branch `main`. This is a re-run after the task was rebased onto main, which added an `indexes` tab kind. Task commits (from the parent): a170ecd (backend `admin.users`/`admin.roles` + integration test), 559520d (renderer users/roles tab), 8337d70 (tests), 83938a6 (CR-1/CR-2 fixes), 53cebf5 (extra test), 096dab4 (ARCHITECTURE.md), 096eefe (reviews only). The rebase merged two files by taking both sides: `packages/renderer/src/app/layout/workspace.service.ts` (`TabKind` = `'collection' | 'aggregation' | 'indexes' | 'shell' | 'admin' | 'users'`) and `packages/renderer/src/app/app.config.ts` (registers both `IndexesView` and `UsersRolesView`). I checked both against the diff. Apart from those two files, the task code is the same as the previously reviewed revision 056aec3. This report describes 096eefe plus one uncommitted test added in this pass. It replaces the report for 056aec3.

Requirements:
- `tasks/users-roles-view.md` acceptance criteria and recorded assumptions (tab kind `users`, id `users:<profile>:<db>`, sidebar db context-menu item; `usersInfo:1` then exact-match `usersInfo` with `showPrivileges`; credentials never sent; sorted by name; plain mongo8 fixture without `--auth`)
- `reviews/users-roles-view/review.md` findings CR-1 (reopening a tab must not reload it or drop the selection) and CR-2 (authentication restrictions must reach the view)
- `SPEC.md` M6 (Should): users and roles viewer, read-only
- `docs/ARCHITECTURE.md` (Coverage, Conventions), `AGENTS.md`
- Parent instructions (rebase re-run)

## Test files changed

Earlier passes (committed in 8337d70, 83938a6, 53cebf5):
- `packages/renderer/src/app/admin/users/users-roles.model.spec.ts` (new)
- `packages/renderer/src/app/admin/users/users-roles-view.spec.ts`
- `packages/renderer/src/app/sidebar/sidebar-tree.service.spec.ts`
- `packages/renderer/src/app/sidebar/sidebar-tree.spec.ts`
- `packages/backend/src/admin/users/handlers.spec.ts`
- `test/integration/users-roles.int.spec.ts`

This pass (uncommitted):
- `packages/renderer/src/app/app.spec.ts`

## Tests added or updated

Count: 1 in this pass. Earlier passes added 43 test-writer tests and 2 fixer tests, and those are unchanged.

This pass:
- `App › registers exactly one view per tab kind, including indexes and users`: injects `TAB_VIEWS` from the real `appConfig.providers`. It checks that no kind is registered twice, that `indexes` maps to `IndexesView` and that `users` maps to `UsersRolesView`. Before this test, nothing checked the `appConfig` registrations. If a later conflict resolution dropped either `provideTabView` line, the tab would silently fall back to "no view", and no test would fail.

Earlier tests (all still passing on 096eefe): model (16), view (26 incl. CR-1 equal/other-db/other-profile), sidebar (`openUsers` shape, reopen, unknown profile, context-menu item, read-only profile), backend handlers (16), integration (10 incl. CR-2 authentication restrictions). See the requirement table.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: Integration test against a fixture with custom roles | `test/integration/users-roles.int.spec.ts` (10 tests) | `npm run test:int -- users-roles` (mongo8 fixture, containers via Podman) | Pass (10/10) |
| AC2: Component tests for the views | `users-roles-view.spec.ts` (26), `users-roles.model.spec.ts` (16) | `cd packages/renderer && npx ng test --include='src/app/admin/**/*.spec.ts'` | Pass (42/42) |
| CR-1: reopening an equal tab keeps state; another db/profile reloads | `reopening the same tab (a new, equal tab object) ...`, `a tab pointing at another database ...`, `a tab pointing at the same database of another profile loads it again` | same as AC2 | Pass |
| CR-2: authentication restrictions are requested and shown | backend `admin.users asks for names, then exact-match details ...`, integration `includes authentication restrictions together with the privileges`, view `shows the number of authentication restrictions` | `cd packages/backend && npx vitest run src/admin/users`; `npm run test:int -- users-roles`; AC2 command | Pass |
| Assumption: tab from the db context menu, kind `users`, id `users:<profile>:<db>` | `opens the users and roles tab of a database from its context menu`, `openUsers ...` (3), read-only menu assertion | `cd packages/renderer && npx ng test --include='src/app/sidebar/**/*.spec.ts'` | Pass (187/187, including main's new indexes tests) |
| Rebase union: `users` tab view registered next to `indexes` | `registers exactly one view per tab kind, including indexes and users` (new) | `cd packages/renderer && npx ng test --include='src/app/app.spec.ts' --include='src/app/admin/**/*.spec.ts' --include='src/app/sidebar/**/*.spec.ts'` | Pass (5 files, 234/234) |
| Assumption: `usersInfo:1` then exact match with privileges; credentials dropped; sorted; errors → SERVER_ERROR; cancel → CANCELLED | `handlers.spec.ts` (16 tests) | `cd packages/backend && npx vitest run src/admin/users` | Pass (16/16) |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/app/app.spec.ts' --include='src/app/admin/**/*.spec.ts' --include='src/app/sidebar/**/*.spec.ts'` -> 5 files, 234 passed
`cd packages/renderer && npx ng test --include='src/app/admin/**/*.spec.ts'` -> 42 passed
`cd packages/renderer && npx ng test --include='src/app/sidebar/**/*.spec.ts'` -> 187 passed
`cd packages/backend && npx vitest run src/admin/users` -> 1 file, 16 passed
`npm run test:int -- users-roles` -> 1 file, 10 passed

Result:

Pass

## Full test execution

Command:

`npm run check` (lint && typecheck && test), run from the repository root on 096eefe plus the uncommitted `app.spec.ts`

Result:

Pass. ESLint (`--max-warnings 0`) and Prettier are clean. `tsc` is clean for root, desktop, contract, core and backend, and `ngc`+`tsc` are clean for renderer. Root Vitest: 74 files / 4054 tests passed. Renderer: 89 files / 2794 tests passed.

## .taskcheck

Result:

Pass. `.taskcheck` runs `npm run check`, which passed above on the same snapshot.

## Bugs found

None. The rebase resolution is correct: both `indexes` and `users` are in `TabKind`, each one has exactly one registered view, and the full check passes.

Informational only, carried over and not a requirement violation: `listUsers` (`packages/backend/src/admin/users/users.ts:47`) throws `TypeError` if a `usersInfo` answer contains a `null` entry. A real server never sends one.

## Coverage

Status: verified (whole-file, task-scoped) on revision 096eefe plus the one uncommitted test. Vitest v5.1.0 with `@vitest/coverage-v8`.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured (no changed-line tooling is configured). I checked the uncovered locations against the task diff by hand (table below).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `users-roles-view`. Base `62aa9cda12109876a24c3621abdc10c0dca3b22a` (merge-base after the rebase, supplied by the parent). HEAD `096eefe401fe144cb7b1abfa3db58ac361988233`. Commits a170ecd, 559520d, 8337d70, 83938a6, 53cebf5, 096dab4 and 096eefe came from the parent. Scope = `git diff --stat 62aa9cd..HEAD` production `.ts` files, without spec files. The diff contains no commits from other tasks.
- Source/test snapshot identifier (including uncommitted inputs): production = HEAD 096eefe, with no uncommitted production changes. The one uncommitted test file is `packages/renderer/src/app/app.spec.ts`, sha256 24ec24f24b019a999aeb7dedd6c537e1dea946b7277b71b7691fafd5241c5d8e (same hash before and after the runs). `reviews/users-roles-view/review.md` also had uncommitted changes from another helper. It is not a source or test input, and I did not touch it.
- Exact included files: backend `src/admin/users/handlers.ts`, `src/admin/users/users.ts`, `src/admin/users/index.ts`, `src/server/backend.ts`, `src/index.ts`. Renderer `src/app/admin/users/users-roles-view.ts`, `src/app/admin/users/users-roles.model.ts`, `src/app/admin/users/index.ts`, `src/app/app.config.ts`, `src/app/layout/workspace.service.ts`, `src/app/sidebar/sidebar-tree.service.ts`, `src/app/sidebar/sidebar-tree.ts`. Excluded: `users-roles-view.html`, `users-roles-view.css` and `layout/tab-bar.css`, because V8 coverage does not instrument templates or styles (the component tests exercise the template). No files were renamed or deleted.
- Provider/version, command, working directory, and test selection:
  - backend, full backend suite (37 files / 1605 tests passed): `cd packages/backend && npx vitest run --coverage --coverage.include=<5 files above> --coverage.reportsDirectory=coverage/users-roles-view-096eefe --coverage.reporter=text --coverage.reporter=json-summary`
  - renderer, full renderer suite (89 files / 2794 tests passed): `cd packages/renderer && npx ng test --coverage --coverage-include=<7 files above> --coverage-reporters=text --coverage-reporters=json-summary`
- Run start/completion time and exit status: backend 2026-11-17T03:52:34Z to about 03:52:48Z, all tests passed. Renderer, final run: 03:53:56Z to about 03:54:14Z, all tests passed. I accidentally started a narrower renderer coverage run (a single include) at about 03:53:30Z. It overwrote the renderer output directory, so I re-ran the full renderer coverage afterwards. The renderer numbers and hash come from that final run.
- Generated report paths and report hashes/run identifier: `packages/backend/coverage/users-roles-view-096eefe/coverage-summary.json` sha256 0d21eed8ac02cac148ff2195fc2a4e9ff4bfe9a7a90345c538381841daa44727 (new directory). `packages/renderer/coverage/renderer/coverage-summary.json` sha256 a0373cef8678322322b6d0c4df9a5f174d6e80703cb5e83105a717242ab8d7ac (the provider cleans this directory on each run). Both directories are git-ignored.
- Evidence outputs are fresh and inputs stayed unchanged: yes. The source and test hashes were the same before and after the runs.
- Final run after latest test additions and production fixes: yes (after the rebase and after the test added in this pass).

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/admin/users/users.ts` | 24/24 (100%) | 14/15 (93.33%) | 9/9 (100%) | 22/22 (100%) |
| `packages/backend/src/admin/users/handlers.ts` | 3/3 (100%) | N/A (0/0) | 3/3 (100%) | 3/3 (100%) |
| `packages/backend/src/admin/users/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/backend/src/index.ts` | 1/1 (100%) | N/A | N/A | 1/1 (100%) |
| `packages/backend/src/server/backend.ts` | 58/62 (93.55%) | 16/18 (88.89%) | 19/23 (82.61%) | 55/57 (96.49%) |
| `packages/renderer/src/app/admin/users/users-roles-view.ts` | 97/101 (96.04%) | 51/57 (89.47%) | 28/28 (100%) | 81/81 (100%) |
| `packages/renderer/src/app/admin/users/users-roles.model.ts` | 43/43 (100%) | 45/45 (100%) | 21/21 (100%) | 37/37 (100%) |
| `packages/renderer/src/app/admin/users/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/renderer/src/app/app.config.ts` | 1/1 (100%) | N/A | N/A | 1/1 (100%) |
| `packages/renderer/src/app/layout/workspace.service.ts` | 55/55 (100%) | 37/38 (97.37%) | 16/16 (100%) | 38/38 (100%) |
| `packages/renderer/src/app/sidebar/sidebar-tree.service.ts` | 230/230 (100%) | 98/98 (100%) | 66/66 (100%) | 184/184 (100%) |
| `packages/renderer/src/app/sidebar/sidebar-tree.ts` | 399/408 (97.79%) | 238/272 (87.5%) | 91/91 (100%) | 341/342 (99.71%) |

Aggregates (summed counters):
- Backend: 86/90 statements (95.56%), 30/33 branches (90.91%), 31/35 functions (88.57%), 81/83 lines (97.59%). Compared with 056aec3, `backend.ts` grew because of main's own changes (OIDC/shell wiring), not because of this task.
- Renderer: 825/838 statements (98.45%), 469/510 branches (91.96%), 222/222 functions (100%), 682/683 lines (99.85%).
- Not instrumented: the `.html`/`.css` files named above. Every scoped `.ts` file appears in the reports.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/renderer/src/app/app.config.ts` (`provideTabView('users', ...)` next to `'indexes'`) | The rebase union must keep both tab views registered | New test `registers exactly one view per tab kind, including indexes and users`. |
| `packages/backend/src/admin/users/users.ts:29` (`?? ''` for the second compared entry) | Sorting entries that have no name | Justified gap: only one side of the nullish fallback runs. Sorting nameless entries is tested, and which side V8's sort compares first depends on the engine. |
| `packages/renderer/src/app/admin/users/users-roles-view.ts:188, 208` (`if (request.signal.aborted) return;` after a successful answer) | Stale answers must not overwrite newer state | Justified gap: `ApiService` rejects an aborted request with `CANCELLED` immediately, so a success after an abort cannot arrive. The two "older answer arriving last" tests cover stale-answer handling. |
| `packages/renderer/src/app/admin/users/users-roles-view.ts:98-108` (`?? null` branches of `user`/`role`) | Showing details when a loaded list is empty | Justified gap: with an empty list the template shows the empty state and never reads `user()`/`role()`. The empty states are tested. |
| `packages/backend/src/server/backend.ts:79, 85` (OIDC and shell `log` callbacks), `packages/renderer/src/app/sidebar/sidebar-tree.ts:341`, `packages/renderer/src/app/layout/workspace.service.ts:85` | Pre-existing or main-owned code outside the task's changed lines | Not task code. The task's own lines (handler registration, `TabKind` union, `users` menu item) are covered. |

## Unable to test

- An unauthorized caller (missing `viewUser`/`viewRole`) against a real server: the fixture runs without `--auth` (a recorded task assumption). Unit tests cover the `SERVER_ERROR` mapping and the view's alerts instead. Follow-up only if an auth-enabled fixture becomes available.
- Visual rendering and CSS of the tab: unit tests don't cover them, and the task has no e2e criterion.

## Summary

Tests added and all validation passed. On revision 096eefe plus one added regression test for the rebase's tab-view registration, the focused tests, the integration test (10/10), `npm run check` and task-scoped coverage all pass. No production defects were found.

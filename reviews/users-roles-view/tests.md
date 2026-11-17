# Test Report

Date: 2026-11-17

Task: users-roles-view — M6 (Should): Users and roles viewer

Scope: `git diff origin/main HEAD` on branch `main`, where HEAD = `fded3890c2a0317a7e1fc8f1524f4c39ca984dc9` and the base = `git merge-base HEAD origin/main` = `dedda46bd91a53436def437df17145b5482d4509`. This is a re-run after HEAD merged origin/main into the task. That merge brought in a `shell` tab kind (`ShellConsole`, `SidebarTreeService.openShell`, and an 'Open shell' item in the db context menu). The parent resolved the conflicts as unions, and I checked each one against the diff:
- `packages/renderer/src/app/app.config.ts` registers `users` (`UsersRolesView`) and `shell` (`ShellConsole`).
- `packages/renderer/src/app/sidebar/sidebar-tree.service.ts` has both `openUsers` and `openShell`.
- The db context menu in `packages/renderer/src/app/sidebar/sidebar-tree.ts` lists 'Open shell' and then 'Users and roles'.

Apart from these three files, the task-owned code is the same as the earlier reviewed revisions 096eefe/4b9c7b7. This report covers fded389 plus two uncommitted test edits from this pass, and it replaces the report for 096eefe.

Requirements:
- `tasks/users-roles-view.md` acceptance criteria and recorded assumptions:
  - tab kind `users`, id `users:<profile>:<db>`, opened from the sidebar db context menu;
  - backend calls `usersInfo:1`, then an exact-match `usersInfo` with `showPrivileges`;
  - credentials are never sent;
  - results are sorted by name;
  - the fixture is a plain mongo8 without `--auth`.
- `reviews/users-roles-view/review.md` findings CR-1 and CR-2.
- `SPEC.md` M6 (Should): a read-only users and roles viewer.
- `docs/ARCHITECTURE.md` (Coverage, Conventions) and `AGENTS.md`.
- Parent instructions for this merge re-run.

## Test files changed

Test files from earlier passes, all already committed:
- `packages/renderer/src/app/admin/users/users-roles.model.spec.ts`
- `packages/renderer/src/app/admin/users/users-roles-view.spec.ts`
- `packages/renderer/src/app/sidebar/sidebar-tree.service.spec.ts`
- `packages/renderer/src/app/sidebar/sidebar-tree.spec.ts`
- `packages/renderer/src/app/app.spec.ts`
- `packages/backend/src/admin/users/handlers.spec.ts`
- `test/integration/users-roles.int.spec.ts`

Edited in this pass, not committed:
- `packages/renderer/src/app/app.spec.ts`
- `packages/renderer/src/app/sidebar/sidebar-tree.spec.ts`

## Tests added or updated

Count: 2 in this pass: 1 added and 1 strengthened. The tests from earlier passes are unchanged.

- New: `SidebarTree › offers both Open shell and Users and roles on a database; each opens its own tab`. It opens the real context menu on db `shop` and checks three things:
  - `menu-open-shell` and `menu-users` each appear exactly once;
  - 'Open shell' comes before 'Users and roles', as the merge resolved them;
  - choosing both items opens two tabs side by side, `shell:p1` (kind `shell`) and `users:p1:shop` (kind `users`), with the users tab active.

  Before this test, no test checked that the two items coexist. Each item was only tested on its own, so a conflict resolution that dropped or duplicated one of them would not have been caught.
- Strengthened: `App › registers exactly one view per tab kind, including indexes, users and shell` (previously only `indexes and users`). It now also checks that `shell` maps to `ShellConsole` in the real `appConfig.providers`. The existing check that no kind is registered twice now also covers the `users`/`shell` union.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: Integration test against a fixture with custom roles | `test/integration/users-roles.int.spec.ts` (10 tests) | `npm run test:int -- users-roles` (mongo8 fixture) | Pass (10/10) |
| AC2: Component tests for the views | `users-roles-view.spec.ts`, `users-roles.model.spec.ts` | `cd packages/renderer && npx ng test --include='src/app/app.spec.ts' --include='src/app/admin/**/*.spec.ts' --include='src/app/sidebar/**/*.spec.ts'` | Pass |
| CR-1: reopening an equal tab keeps its state; a tab for another db or profile reloads | the 3 CR-1 tests in `users-roles-view.spec.ts` | same as AC2 | Pass |
| CR-2: authentication restrictions are requested and shown | backend `admin.users asks for names, then exact-match details ...`, integration `includes authentication restrictions together with the privileges`, view `shows the number of authentication restrictions` | `cd packages/backend && npx vitest run src/admin/users`; `npm run test:int -- users-roles`; AC2 command | Pass |
| Assumption: the tab opens from the db context menu, with kind `users` and id `users:<profile>:<db>` | `opens the users and roles tab of a database from its context menu`, the 3 `openUsers ...` tests, the read-only menu assertion | AC2 command | Pass |
| Merge union: 'Open shell' and 'Users and roles' coexist in the db menu, and each opens its own tab | `offers both Open shell and Users and roles on a database; each opens its own tab` (new) | AC2 command | Pass |
| Merge union: `users` and `shell` tab views are both registered, once each | `registers exactly one view per tab kind, including indexes, users and shell` (strengthened) | AC2 command | Pass |
| Assumption: `usersInfo:1` then an exact match with privileges; credentials dropped; results sorted; errors map to SERVER_ERROR; cancel maps to CANCELLED | `handlers.spec.ts` (16 tests) | `cd packages/backend && npx vitest run src/admin/users` | Pass (16/16) |

## Focused test execution

Commands and results:

- `cd packages/renderer && npx ng test --include='src/app/app.spec.ts' --include='src/app/admin/**/*.spec.ts' --include='src/app/sidebar/**/*.spec.ts'` -> 5 files, 244 passed
- `cd packages/backend && npx vitest run src/admin/users` -> 1 file, 16 passed
- `npm run test:int -- users-roles` -> 1 file, 10 passed

Result: Pass.

## Full test execution

Command: `npm run check` (`lint && typecheck && test`), run from the repository root on fded389 plus the two uncommitted spec edits.

Result: Pass. ESLint (`--max-warnings 0`) and `prettier --check` were clean, and the type checks passed (the test stage only runs after both succeed).
- Root Vitest: 74 files / 4054 tests passed.
- Renderer: 91 files / 2915 tests passed. That is 2914 plus the 1 new test.

## .taskcheck

Result: Pass. `.taskcheck` runs `npm run check`, and that passed on the same snapshot.

## Bugs found

None. The merge resolution is correct:
- `users` and `shell` each have exactly one registered view.
- Both db-menu items are present, each appears once, and each opens its own tab kind.
- The full check passes.

One informational note carried over from earlier reports, not a requirement violation: `listUsers` (`packages/backend/src/admin/users/users.ts:47`) throws a `TypeError` if a `usersInfo` answer contains a `null` entry. A real server never sends one.

## Coverage

Status: verified (whole-file, task-scoped) on revision fded389 plus the two uncommitted spec edits. Provider: Vitest v5.1.0 with `@vitest/coverage-v8`.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured, because no changed-line tooling is configured. I checked the uncovered locations against the task diff by hand (table below).

Evidence:
- **Task id, immutable base, measured HEAD, and task-owned commits/file-scope source:** task `users-roles-view`. Base `dedda46bd91a53436def437df17145b5482d4509` (`git merge-base HEAD origin/main`, which equals origin/main; supplied by the parent). HEAD `fded3890c2a0317a7e1fc8f1524f4c39ca984dc9`. The scope is the production `.ts` files in `git diff --stat origin/main HEAD`, excluding spec files. Because HEAD merged origin/main, that diff contains only task-owned changes.
- **Source/test snapshot identifier (including uncommitted inputs):** production code is HEAD fded389, with no uncommitted production changes. The uncommitted test files are:
  - `packages/renderer/src/app/app.spec.ts`, sha256 fd886408f7735b041f231d9d1d3d45c175ec9dc7c9182b783b29b2b339840e20
  - `packages/renderer/src/app/sidebar/sidebar-tree.spec.ts`, sha256 918d982eb14c2085f872cda121948737d84977d85032b3ad1f5c758b2c86bc2f

  Both hashes were identical before (03:59:42Z) and after the runs.
- **Exact included files:**
  - backend: `src/admin/users/handlers.ts`, `src/admin/users/users.ts`, `src/admin/users/index.ts`, `src/server/backend.ts`, `src/index.ts`
  - renderer: `src/app/admin/users/users-roles-view.ts`, `src/app/admin/users/users-roles.model.ts`, `src/app/admin/users/index.ts`, `src/app/app.config.ts`, `src/app/layout/workspace.service.ts`, `src/app/sidebar/sidebar-tree.service.ts`, `src/app/sidebar/sidebar-tree.ts`

  Excluded: `users-roles-view.html`, `users-roles-view.css` and `layout/tab-bar.css`, because V8 does not instrument templates or styles. The component tests exercise the template. No files were renamed or deleted.
- **Provider/version, command, working directory, and test selection:**
  - Backend, run on the full backend suite (37 files / 1605 tests passed): `cd packages/backend && npx vitest run --coverage --coverage.include=<5 backend files above> --coverage.reportsDirectory=coverage/users-roles-view-fded389 --coverage.reporter=text --coverage.reporter=json-summary`
  - Renderer, run on the full renderer suite (91 files / 2915 tests passed): `cd packages/renderer && npx ng test --coverage --coverage-include=<7 renderer files above> --coverage-reporters=text --coverage-reporters=json-summary`
- **Run start/completion time and exit status:**
  - backend: 2026-11-17T03:59:46Z to about 03:59:59Z, all tests passed;
  - renderer: 2026-11-17T04:00:11Z to about 04:00:34Z, all tests passed.
- **Generated report paths and report hashes/run identifier:**
  - `packages/backend/coverage/users-roles-view-fded389/coverage-summary.json`, sha256 0d21eed8ac02cac148ff2195fc2a4e9ff4bfe9a7a90345c538381841daa44727. This is a new directory. The hash is identical to the 096eefe run because the backend code and tests did not change.
  - `packages/renderer/coverage/renderer/coverage-summary.json`, sha256 877dede569f99921d4099530c3f87dbdae225b28ee4bd9928e8a418d9a8fb0a2. The provider cleans this directory on each run.

  Both directories are git-ignored.
- **Evidence outputs are fresh and inputs stayed unchanged:** yes.
- **Final run after latest test additions and production fixes:** yes. It ran after the merge and after this pass's test edits.

Values below use covered/total (percentage). Metrics with a zero denominator are N/A.

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
| `packages/renderer/src/app/sidebar/sidebar-tree.service.ts` | 238/238 (100%) | 104/104 (100%) | 68/68 (100%) | 191/191 (100%) |
| `packages/renderer/src/app/sidebar/sidebar-tree.ts` | 401/410 (97.80%) | 238/272 (87.5%) | 93/93 (100%) | 343/344 (99.71%) |

Aggregates (summed counters):
- Backend: 86/90 statements (95.56%), 30/33 branches (90.91%), 31/35 functions (88.57%), 81/83 lines (97.59%).
- Renderer: 835/848 statements (98.47%), 475/516 branches (92.05%), 226/226 functions (100%), 691/692 lines (99.86%). These totals are higher than in the 096eefe report because the merge added `openShell` and main's shell code in `sidebar-tree.service.ts` and `sidebar-tree.ts`, not because of this task.
- Not instrumented: the `.html` and `.css` files listed above. Every `.ts` file in scope appears in the reports.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/renderer/src/app/sidebar/sidebar-tree.ts` (db menu: 'Open shell' and 'Users and roles') | The merge union must keep both items, each once and in the resolved order | New test `offers both Open shell and Users and roles on a database; each opens its own tab`. |
| `packages/renderer/src/app/app.config.ts` (`provideTabView('users', ...)` and `provideTabView('shell', ...)`) | The merge union must keep both tab views registered, once each | Strengthened test `registers exactly one view per tab kind, including indexes, users and shell`. |
| `packages/backend/src/admin/users/users.ts:29` (`?? ''` for the second compared entry) | Sorting entries that have no name | Justified gap: only one side of the nullish fallback runs. Sorting nameless entries is tested, but which side V8's sort compares first depends on the engine. |
| `packages/renderer/src/app/admin/users/users-roles-view.ts:188, 208` (`if (request.signal.aborted) return;` after a successful answer) | Stale answers must not overwrite newer state | Justified gap: `ApiService` rejects an aborted request with `CANCELLED` immediately, so a success cannot arrive after an abort. The two "older answer arriving last" tests cover stale-answer handling. |
| `packages/renderer/src/app/admin/users/users-roles-view.ts:98-108` (`?? null` branches of `user`/`role`) | Showing details when a loaded list is empty | Justified gap: when the list is empty, the template shows the empty state and never reads `user()`/`role()`. The empty states are tested. |
| `packages/backend/src/server/backend.ts:79, 85`, `packages/renderer/src/app/sidebar/sidebar-tree.ts:341`, `packages/renderer/src/app/layout/workspace.service.ts:85` | Pre-existing or main-owned code outside the lines this task changed | Not task code. The task's own lines (handler registration, the `TabKind` union, the `users` menu item, `openUsers`) are covered. |

## Unable to test

- An unauthorized caller (missing `viewUser`/`viewRole`) against a real server. The fixture runs without `--auth`, which is a recorded task assumption. Unit tests cover the `SERVER_ERROR` mapping and the view's alerts instead. Follow-up is needed only if an auth-enabled fixture becomes available.
- Visual rendering and CSS of the tab. Unit tests don't cover them, and the task has no e2e criterion.

## Summary

Tests added and all validation passed. On fded389 (the merge of origin/main with its `shell` tab), this pass added one test and strengthened one test for the merge unions: the db menu offers both items and the tab-view registrations are correct. The focused tests, the integration test (10/10), `npm run check` and the task-scoped coverage all pass. No production defects were found.

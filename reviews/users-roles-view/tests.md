# Test Report

Date: 2026-11-17

Task: users-roles-view — M6 (Should): Users and roles viewer

Scope: `git diff origin/main HEAD` on branch `main`, where HEAD = `88c6823c8396528f1b26e744b7b67f8afa70576e` and the base = `git merge-base HEAD origin/main` = origin/main = `44fd007c7b65db6629a6a69885662ffc10ae49d1`. HEAD merges origin/main, which added the `validator` tab kind and `ValidatorView`, into the task revision 8cf069d that the previous report covered. I checked the merge against the diff:
- The only conflict was the `TabKind` union in `packages/renderer/src/app/layout/workspace.service.ts`. It now reads `'collection' | 'aggregation' | 'indexes' | 'validator' | 'shell' | 'admin' | 'users'`, wrapped by prettier. Nothing was lost on either side. If `'validator'` or `'users'` were missing, the type check of `provideTabView(...)` in `app.config.ts` would fail, and it passes.
- `packages/renderer/src/app/app.config.ts` merged cleanly. It registers `users` (`UsersRolesView`), `shell` and `validator` (`ValidatorView`).
- Since 8cf069d, the only change to a task-touched file under `admin/`, `sidebar/`, backend `src/admin` or the integration spec is main's own validator change in `sidebar-tree.service.ts`: `validator` tabs now close together with their database or collection. That is not task code, and the validator task's tests cover it.

The task-owned code and tests are unchanged from 8cf069d. This pass did not edit any test file. The working tree held only `reviews/users-roles-view/review.md`, which the parallel code-reviewer modified. That file is not a test or source input.

Requirements:
- `tasks/users-roles-view.md` acceptance criteria and recorded assumptions:
  - tab kind `users`, id `users:<profile>:<db>`, opened from the sidebar db context menu;
  - backend calls `usersInfo:1`, then an exact-match `usersInfo` with `showPrivileges`;
  - credentials are never sent;
  - results are sorted by name;
  - the fixture is a plain mongo8 without `--auth`.
- `reviews/users-roles-view/review.md` findings CR-1 and CR-2 from earlier passes.
- `SPEC.md` M6 (Should): a read-only users and roles viewer.
- `docs/ARCHITECTURE.md` (Coverage, Conventions) and `AGENTS.md`.
- Parent instructions for this merge re-run.

## Test files changed

None in this pass. These task test files are already committed and unchanged since 8cf069d:
- `packages/renderer/src/app/admin/users/users-roles.model.spec.ts`
- `packages/renderer/src/app/admin/users/users-roles-view.spec.ts`
- `packages/renderer/src/app/sidebar/sidebar-tree.service.spec.ts`
- `packages/renderer/src/app/sidebar/sidebar-tree.spec.ts`
- `packages/renderer/src/app/app.spec.ts`
- `packages/backend/src/admin/users/handlers.spec.ts`
- `test/integration/users-roles.int.spec.ts`

## Tests added or updated

Count: 0. The merge changed no task behavior, and its one conflict (a type union) is checked by the type check and by the existing test `registers exactly one view per tab kind, including indexes, users and shell`, which still passes on the merged config. That test does not check that `validator` maps to `ValidatorView`. That registration belongs to main's validator task and merged without a conflict, so I did not add a test for it. See "Unable to test" for an optional follow-up.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: Integration test against a fixture with custom roles | `test/integration/users-roles.int.spec.ts` (10 tests) | `npm run test:int -- users-roles` (mongo8 fixture) | Pass (10/10) |
| AC2: Component tests for the views | `users-roles-view.spec.ts`, `users-roles.model.spec.ts` | `cd packages/renderer && npx ng test --include='src/app/app.spec.ts' --include='src/app/admin/**/*.spec.ts' --include='src/app/sidebar/**/*.spec.ts'` | Pass |
| CR-1: reopening an equal tab keeps its state; a tab for another db or profile reloads | the 3 CR-1 tests in `users-roles-view.spec.ts` | same as AC2 | Pass |
| CR-2: authentication restrictions are requested and shown | backend `admin.users asks for names, then exact-match details ...`, integration `includes authentication restrictions together with the privileges`, view `shows the number of authentication restrictions` | `cd packages/backend && npx vitest run src/admin/users`; `npm run test:int -- users-roles`; AC2 command | Pass |
| Assumption: the tab opens from the db context menu, with kind `users` and id `users:<profile>:<db>` | `opens the users and roles tab of a database from its context menu`, the 3 `openUsers ...` tests, `offers both Open shell and Users and roles on a database; each opens its own tab` | AC2 command | Pass |
| Merge union: `TabKind` keeps `validator` and `users`; each kind is registered once | type check in `npm run check`; `registers exactly one view per tab kind, including indexes, users and shell` | `npm run check`; AC2 command | Pass |
| Assumption: `usersInfo:1` then an exact match with privileges; credentials dropped; results sorted; errors map to SERVER_ERROR; cancel maps to CANCELLED | `handlers.spec.ts` (16 tests) | `cd packages/backend && npx vitest run src/admin/users` | Pass (16/16) |

## Focused test execution

Commands and results:

- `cd packages/renderer && npx ng test --include='src/app/app.spec.ts' --include='src/app/admin/**/*.spec.ts' --include='src/app/sidebar/**/*.spec.ts'` -> 5 files, 244 passed
- `cd packages/backend && npx vitest run src/admin/users` -> 1 file, 16 passed
- `npm run test:int -- users-roles` -> 1 file, 10 passed

Result: Pass.

## Full test execution

Command: `npm run check` (`lint && typecheck && test`), run from the repository root on 88c6823.

Result: Pass. ESLint (`--max-warnings 0`) and `prettier --check` were clean, and the type checks passed (the test stage only runs after both succeed).
- Root Vitest: 76 files / 4116 tests passed.
- Renderer: 94 files / 3015 tests passed.

## .taskcheck

Result: Pass. `.taskcheck` runs `npm run check`, and that passed on the same snapshot.

## Bugs found

None. The merge resolution is correct, and every task test passes on the merged code.

One informational note carried over from earlier reports, not a requirement violation: `listUsers` (`packages/backend/src/admin/users/users.ts:47`) throws a `TypeError` if a `usersInfo` answer contains a `null` entry. A real server never sends one.

## Coverage

Status: verified (whole-file, task-scoped) on revision 88c6823. Provider: Vitest v5.1.0 with `@vitest/coverage-v8`.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured, because no changed-line tooling is configured. I checked the uncovered locations against the task diff by hand (table below).

Evidence:
- **Task id, immutable base, measured HEAD, and task-owned commits/file-scope source:** task `users-roles-view`. Base `44fd007c7b65db6629a6a69885662ffc10ae49d1` (`git merge-base HEAD origin/main`, which equals origin/main; supplied by the parent). HEAD `88c6823c8396528f1b26e744b7b67f8afa70576e`. The scope is the production `.ts` files in `git diff --stat origin/main HEAD`, excluding spec files. Because HEAD merged origin/main, that diff contains only task-owned changes.
- **Source/test snapshot identifier (including uncommitted inputs):** HEAD 88c6823. There were no uncommitted source or test changes before or after the runs. The only working-tree change was `reviews/users-roles-view/review.md`, edited by the parallel code-reviewer. It is not a measurement input.
- **Exact included files:**
  - backend: `src/admin/users/handlers.ts`, `src/admin/users/users.ts`, `src/admin/users/index.ts`, `src/server/backend.ts`, `src/index.ts`
  - renderer: `src/app/admin/users/users-roles-view.ts`, `src/app/admin/users/users-roles.model.ts`, `src/app/admin/users/index.ts`, `src/app/app.config.ts`, `src/app/layout/workspace.service.ts`, `src/app/sidebar/sidebar-tree.service.ts`, `src/app/sidebar/sidebar-tree.ts`

  Excluded: `users-roles-view.html`, `users-roles-view.css` and `layout/tab-bar.css`, because V8 does not instrument templates or styles. The component tests exercise the template. No files were renamed or deleted.
- **Provider/version, command, working directory, and test selection:**
  - Backend, run on the full backend suite (39 files / 1659 tests passed): `cd packages/backend && npx vitest run --coverage --coverage.include=<5 backend files above> --coverage.reportsDirectory=coverage/users-roles-view-88c6823 --coverage.reporter=text --coverage.reporter=json-summary`
  - Renderer, run on the full renderer suite (94 files / 3015 tests passed): `cd packages/renderer && npx ng test --coverage --coverage-include=<7 renderer files above> --coverage-reporters=text --coverage-reporters=json-summary`
- **Run start/completion time and exit status:** all tests passed in both runs.
  - Backend: started 2026-11-17 05:06:31 local time, took 12.5 s. I then re-ran it with the json-summary reporter only, to read the test counts.
  - Renderer: started 05:07:11 local time, took 20.0 s.
- **Generated report paths and report hashes/run identifier:**
  - `packages/backend/coverage/users-roles-view-88c6823/coverage-summary.json`, sha256 0d21eed8ac02cac148ff2195fc2a4e9ff4bfe9a7a90345c538381841daa44727. This is a new directory. The hash is identical to the earlier runs because the counters of the scoped backend files did not change.
  - `packages/renderer/coverage/renderer/coverage-summary.json`, sha256 aea8f110bec73529c2ac8e97c1462d937c3f2d232d3a5a95803a50d9b553b55b. The provider cleans this directory on each run.

  Both directories are git-ignored.
- **Evidence outputs are fresh and inputs stayed unchanged:** yes.
- **Final run after latest test additions and production fixes:** yes. It ran on the merged HEAD, and there were no test edits in this pass.

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
| `packages/renderer/src/app/sidebar/sidebar-tree.service.ts` | 238/238 (100%) | 105/105 (100%) | 68/68 (100%) | 191/191 (100%) |
| `packages/renderer/src/app/sidebar/sidebar-tree.ts` | 401/410 (97.80%) | 238/272 (87.5%) | 93/93 (100%) | 343/344 (99.71%) |

Aggregates (summed counters):
- Backend: 86/90 statements (95.56%), 30/33 branches (90.91%), 31/35 functions (88.57%), 81/83 lines (97.59%).
- Renderer: 835/848 statements (98.47%), 476/517 branches (92.07%), 226/226 functions (100%), 691/692 lines (99.86%). The one extra branch compared with 8cf069d is main's `tab.kind === 'validator'` check in `sidebar-tree.service.ts`. It is covered, and it is not task code.
- Not instrumented: the `.html` and `.css` files listed above. Every `.ts` file in scope appears in the reports.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/backend/src/admin/users/users.ts:29` (`?? ''` for the second compared entry) | Sorting entries that have no name | Justified gap: only one side of the nullish fallback runs. Sorting nameless entries is tested, but which side V8's sort compares first depends on the engine. |
| `packages/renderer/src/app/admin/users/users-roles-view.ts:188, 208` (`if (request.signal.aborted) return;` after a successful answer) | Stale answers must not overwrite newer state | Justified gap: `ApiService` rejects an aborted request with `CANCELLED` immediately, so a success cannot arrive after an abort. The two "older answer arriving last" tests cover stale-answer handling. |
| `packages/renderer/src/app/admin/users/users-roles-view.ts:98-108` (`?? null` branches of `user`/`role`) | Showing details when a loaded list is empty | Justified gap: when the list is empty, the template shows the empty state and never reads `user()`/`role()`. The empty states are tested. |
| `packages/backend/src/server/backend.ts:79, 85`, `packages/renderer/src/app/sidebar/sidebar-tree.ts:341`, `packages/renderer/src/app/layout/workspace.service.ts:86` (line 85 before the prettier wrap) | Pre-existing or main-owned code outside the lines this task changed | Not task code. The task's own lines (handler registration, the `TabKind` union, the `users` menu item, `openUsers`) are covered. |

## Unable to test

- An unauthorized caller (missing `viewUser`/`viewRole`) against a real server. The fixture runs without `--auth`, which is a recorded task assumption. Unit tests cover the `SERVER_ERROR` mapping and the view's alerts instead. Follow-up is needed only if an auth-enabled fixture becomes available.
- Visual rendering and CSS of the tab. Unit tests don't cover them, and the task has no e2e criterion.
- No test checks that `validator` maps to `ValidatorView` in `appConfig`. This is optional and not this task's responsibility: the registration came from main without a conflict, and the type check covers the `TabKind` union. If wanted, one `expect(... 'validator' ...).toBe(ValidatorView)` line could be added to `app.spec.ts` in a later task.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. On 88c6823 (the merge of origin/main with its `validator` tab), the focused tests (244 renderer, 16 backend), the integration test (10/10), `npm run check` and the task-scoped coverage all pass. The `TabKind` conflict resolution is correct. No test files were changed in this pass.

# Test Report

Date: 2026-11-17

Task: users-roles-view — M6 (Should): Users and roles viewer

Scope: `git diff 8020ba9e644ea2da3c9d47835f542da1213e48ba..056aec3913df7958e7c0f18e90bc9ef70a9a4289` on branch `main`. Task commits: 70f9f9c (backend `admin.users`/`admin.roles` + integration test), 38e0fd9 (renderer users/roles tab), cbfbca2 (first test-writer tests and report), 056aec3 (fixer: CR-1 value-equal tab target in `users-roles-view.ts`, CR-2 `showAuthenticationRestrictions` in backend `users.ts`, with tests; see `reviews/users-roles-view/fixes.md`). Base and commits supplied by the parent worker and matched against the task's `touches` (`packages/backend/src/admin/users`, `packages/renderer/src/app/admin/users`) plus the wiring files the diff shows. This report describes revision 056aec3 plus one uncommitted test added in this pass (below). It replaces the earlier report for 38e0fd9.

Requirements:
- `tasks/users-roles-view.md` acceptance criteria and recorded assumptions (tab kind `users`, id `users:<profile>:<db>`, sidebar db context-menu item; `usersInfo:1` then exact-match `usersInfo` with `showPrivileges`; credentials never sent; sorted by name; plain mongo8 fixture without `--auth`)
- `reviews/users-roles-view/review.md` findings CR-1 (reopening a tab must not reload or drop the selection) and CR-2 (authentication restrictions must reach the view), as fixed in 056aec3
- `SPEC.md` M6 (Should) users and roles viewer, read-only
- `docs/ARCHITECTURE.md` (Coverage, Conventions), `AGENTS.md`
- Parent instructions

## Test files changed

First pass (committed in cbfbca2):
- `packages/renderer/src/app/admin/users/users-roles.model.spec.ts` (new)
- `packages/renderer/src/app/admin/users/users-roles-view.spec.ts`
- `packages/renderer/src/app/sidebar/sidebar-tree.service.spec.ts`
- `packages/renderer/src/app/sidebar/sidebar-tree.spec.ts`
- `packages/backend/src/admin/users/handlers.spec.ts`
- `test/integration/users-roles.int.spec.ts`

This pass (uncommitted):
- `packages/renderer/src/app/admin/users/users-roles-view.spec.ts`

## Tests added or updated

Count: 43 by the test-writer (first pass 41 added + 1 strengthened; this pass 1 added). The fixer's 056aec3 adds 2 tests (view: reopening an equal tab keeps state; integration: authentication restrictions) and updates 2 backend expectations. I reviewed those and they are sound.

This pass:
- `a tab pointing at the same database of another profile loads it again`: the CR-1 value comparator compares `profileId` and `db`. The fixer's test covers an equal target and the earlier test covers a changed `db`. Nothing covered a changed profile with the same `db`, so a comparator that checked only `db` would have passed. This test closes that gap.

First pass (unchanged, all still passing):
- Model (16): `resourceLabel` (cluster, any resource, only `true` flags, `db.coll`/`db.*`/`*.coll`/`*.*`, `system_buckets`, malformed input), `roleKey`, `toUserEntry` / `toRoleEntry` (full reduction, missing fields, malformed list entries, non-object and non-JSON text, EJSON custom data, invalid custom data).
- View (11): roles failure alert, Refresh after failure, restrictions count, older answers arriving last (success and failure, deferred promises), built-in toggle off/no-op, `openRole` of another db, link to a listed role, vanished selection, re-targeted db, tab without target.
- Sidebar (3 service + 1 component + 1 strengthened): `openUsers` tab shape, reopen/second db, unknown profile; db context-menu "Users and roles" opens the tab; enabled on a read-only profile.
- Backend (7): string user names only, malformed answers, nameless roles sort, canonical EJSON types, detail query refusal, `admin.users` cancel.
- Integration (3): other db has no custom roles; `INVALID_PARAMS` without `db` for both methods.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: Integration test against a fixture with custom roles | `test/integration/users-roles.int.spec.ts` (10 tests, incl. the fixer's `includes authentication restrictions together with the privileges`) | `npm run test:int -- users-roles` (mongo8 fixture via Podman) | Pass (10/10) |
| AC2: Component tests for the views | `users-roles-view.spec.ts` (26 tests), `users-roles.model.spec.ts` (16 tests) | `cd packages/renderer && npx ng test --include='src/app/admin/**/*.spec.ts'` | Pass (42/42) |
| CR-1: reopening the tab keeps state; another target reloads | `reopening the same tab (a new, equal tab object) ...` (fixer), `a tab pointing at another database ...`, `a tab pointing at the same database of another profile loads it again` (new) | same as AC2 | Pass |
| CR-2: authentication restrictions are requested and shown | backend `admin.users asks for names, then exact-match details ...` (`showAuthenticationRestrictions: true`), integration `includes authentication restrictions ...`, view `shows the number of authentication restrictions` | `cd packages/backend && npx vitest run src/admin/users`; `npm run test:int -- users-roles`; AC2 command | Pass |
| Assumption: tab from the db context menu, kind `users`, id `users:<profile>:<db>` | `opens the users and roles tab of a database from its context menu`, `openUsers ...` (3), read-only menu assertion | `cd packages/renderer && npx ng test --include='src/app/sidebar/**/*.spec.ts'` | Pass (184/184) |
| Assumption: `usersInfo:1` then exact match with privileges; credentials dropped; sorted; errors → SERVER_ERROR; cancel → CANCELLED | `handlers.spec.ts` (16 tests) | `cd packages/backend && npx vitest run src/admin/users` | Pass (16/16) |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/app/admin/**/*.spec.ts'` -> 2 files, 42 passed
`cd packages/renderer && npx ng test --include='src/app/sidebar/**/*.spec.ts'` -> 2 files, 184 passed
`cd packages/backend && npx vitest run src/admin/users` -> 16 passed
`npm run test:int -- users-roles` -> 10 passed

Result:

Pass

## Full test execution

Command:

`npm --prefix <repo> run check` (lint && typecheck && test), after the parent's `npm install`

Result:

Pass: ESLint + Prettier clean; `tsc` for root, desktop, contract, core, backend and renderer clean; root Vitest 70 files / 3882 tests passed; renderer 83 files / 2499 tests passed.

## .taskcheck

Result:

Pass (`.taskcheck` runs `npm run check`, which passed above on 056aec3 plus the uncommitted test).

## Bugs found

None that violate a requirement. CR-1 and CR-2 from the review were fixed in 056aec3, and the tests above confirm the fixes.

Informational (no test kept, not a requirement violation): `listUsers` (`packages/backend/src/admin/users/users.ts:47`) throws `TypeError` if a `usersInfo` answer contains a `null` entry. A real server never answers that.

## Coverage

Status: verified (whole-file, task-scoped) on revision 056aec3 plus the one uncommitted test. Vitest v5.1.0 with `@vitest/coverage-v8`.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured (no changed-line tooling configured). The uncovered locations below were checked against the task diff by hand.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `users-roles-view`; base `8020ba9e644ea2da3c9d47835f542da1213e48ba`; HEAD `056aec3913df7958e7c0f18e90bc9ef70a9a4289`. Commits 70f9f9c, 38e0fd9, cbfbca2 and 056aec3 came from the parent. Scope = `git diff --name-only 8020ba9..HEAD -- '*.ts'` minus spec files.
- Source/test snapshot identifier (including uncommitted inputs): production = HEAD 056aec3 (no uncommitted production changes). One uncommitted file: `packages/renderer/src/app/admin/users/users-roles-view.spec.ts`, sha256 7f286b62a3ae9dcd4629c6caf731b9beac5d0c7bb04c8ce70a6aa2dde5bf230e. All other test files are as committed at 056aec3.
- Exact included files: backend `src/admin/users/handlers.ts`, `src/admin/users/users.ts`, `src/admin/users/index.ts`, `src/server/backend.ts`, `src/index.ts`; renderer `src/app/admin/users/users-roles-view.ts`, `src/app/admin/users/users-roles.model.ts`, `src/app/admin/users/index.ts`, `src/app/app.config.ts`, `src/app/layout/workspace.service.ts`, `src/app/sidebar/sidebar-tree.service.ts`, `src/app/sidebar/sidebar-tree.ts`. Excluded: `users-roles-view.html` / `.css` and `layout/tab-bar.css`, because V8 coverage does not instrument templates or styles (the component tests exercise the template). No renamed or deleted files.
- Provider/version, command, working directory, and test selection:
  - backend (full backend suite, 34 files / 1460 tests passed): `cd packages/backend && npx vitest run --coverage --coverage.include=<5 files above> --coverage.reportsDirectory=coverage/users-roles-view-056aec3 --coverage.reporter=text --coverage.reporter=json-summary`
  - renderer (full renderer suite, 83 files / 2499 tests passed): `cd packages/renderer && npx ng test --coverage --coverage-include=<7 files above> --coverage-reporters=text --coverage-reporters=json-summary`
- Run start/completion time and exit status: backend 2026-11-17T03:41:47Z–03:42:00Z, all tests passed. Renderer 03:42:16Z–03:42:35Z, all tests passed.
- Generated report paths and report hashes/run identifier: `packages/backend/coverage/users-roles-view-056aec3/coverage-summary.json` sha256 fe43037a73e4ecffae7d4106538e6304fefbea5a7104cf128b204c6afc87f370. This is a new directory, and its content matches the 38e0fd9 run byte for byte because the CR-2 change only adds an object property, which has no new counters. `packages/renderer/coverage/renderer/coverage-summary.json` sha256 1ae7f0ba24f5ff49ea2c519badb74056d648d2a104ffc06b3b79b5fd11f37fcd, regenerated in this run.
- Evidence outputs are fresh and inputs stayed unchanged: yes. No source or test edits happened after the runs started.
- Final run after latest test additions and production fixes: yes (after 056aec3 and the test added in this pass).

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/admin/users/users.ts` | 24/24 (100%) | 14/15 (93.33%) | 9/9 (100%) | 22/22 (100%) |
| `packages/backend/src/admin/users/handlers.ts` | 3/3 (100%) | N/A (0/0) | 3/3 (100%) | 3/3 (100%) |
| `packages/backend/src/admin/users/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/backend/src/index.ts` | 1/1 (100%) | N/A | N/A | 1/1 (100%) |
| `packages/backend/src/server/backend.ts` | 53/56 (94.64%) | 16/18 (88.89%) | 16/19 (84.21%) | 50/51 (98.04%) |
| `packages/renderer/src/app/admin/users/users-roles-view.ts` | 97/101 (96.04%) | 51/57 (89.47%) | 28/28 (100%) | 81/81 (100%) |
| `packages/renderer/src/app/admin/users/users-roles.model.ts` | 43/43 (100%) | 45/45 (100%) | 21/21 (100%) | 37/37 (100%) |
| `packages/renderer/src/app/admin/users/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/renderer/src/app/app.config.ts` | 1/1 (100%) | N/A | N/A | 1/1 (100%) |
| `packages/renderer/src/app/layout/workspace.service.ts` | 55/55 (100%) | 37/38 (97.37%) | 16/16 (100%) | 38/38 (100%) |
| `packages/renderer/src/app/sidebar/sidebar-tree.service.ts` | 230/230 (100%) | 97/97 (100%) | 66/66 (100%) | 184/184 (100%) |
| `packages/renderer/src/app/sidebar/sidebar-tree.ts` | 399/408 (97.79%) | 238/272 (87.5%) | 91/91 (100%) | 341/342 (99.71%) |

Aggregates (summed counters):
- Backend: 81/84 statements (96.42%), 30/33 branches (90.9%), 28/31 functions (90.32%), 76/77 lines (98.7%).
- Renderer: 825/838 statements (98.45%), 468/509 branches (91.94%), 222/222 functions (100%), 682/683 lines (99.85%).
- Not instrumented: the `.html`/`.css` files named above. Every scoped `.ts` file is in the reports.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/renderer/src/app/admin/users/users-roles-view.ts` CR-1 comparator (`equal`) | Reopening must keep state; another profile or db must reload | Both `profileId` and `db` legs are now exercised: equal target (fixer's test), changed db, changed profile (new test). Fully covered. |
| `packages/backend/src/admin/users/users.ts:29` (`?? ''` for the second compared entry) | Sort of nameless entries | Justified gap: one side of the nullish fallback. Nameless sorting is tested, and which side V8's sort compares first is engine-defined. |
| `packages/renderer/src/app/admin/users/users-roles-view.ts:188, 208` (`if (request.signal.aborted) return;` after a successful answer) | Stale answers must not overwrite newer state | Justified gap: `ApiService` rejects an aborted request with `CANCELLED` at once, so a success after an abort cannot arrive. Stale-answer behavior is covered by the two "older answer arriving last" tests. |
| `packages/renderer/src/app/admin/users/users-roles-view.ts:98-108` (`?? null` branches of `user`/`role`) | Detail when a loaded list is empty | Justified gap: with an empty list the template shows the empty state and never reads `user()`/`role()`. Empty states are tested. |
| `packages/backend/src/server/backend.ts:69`, `packages/renderer/src/app/sidebar/sidebar-tree.ts:341`, `packages/renderer/src/app/layout/workspace.service.ts:85` | Pre-existing code outside the task's changed lines | Not task code. The task's lines (handler registration, `TabKind` union, `users` menu item) are covered. |

## Unable to test

- Unauthorized caller (missing `viewUser`/`viewRole`) against a real server: the fixture runs without `--auth` (recorded task assumption). This is covered by unit tests of the `SERVER_ERROR` mapping and the view's alert tests. Follow-up only if an auth-enabled fixture becomes available.
- Visual rendering/CSS of the tab: not covered by unit tests, and the task has no e2e criterion.

## Summary

Tests added and all validation passed. On revision 056aec3 plus one added test: the focused tests, the integration test (10/10), `npm run check` and task-scoped coverage all pass. No production defects were found, and CR-1/CR-2 are covered by tests.

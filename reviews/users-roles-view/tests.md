# Test Report

Date: 2026-11-17

Task: users-roles-view — M6 (Should): Users and roles viewer

Scope: `git diff 8020ba9e644ea2da3c9d47835f542da1213e48ba..38e0fd91d1fdecac5dc8ab88d2c4a373f2879cf2` on branch `main` (task commits 70f9f9c backend `admin.users`/`admin.roles` with integration test, 38e0fd9 renderer users/roles tab). Base and commits supplied by the parent worker and matched against the task's `touches` (`packages/backend/src/admin/users`, `packages/renderer/src/app/admin/users`) plus the wiring files the diff shows. No uncommitted production changes; uncommitted inputs are only the test files listed below.

Requirements:
- `tasks/users-roles-view.md` acceptance criteria and recorded assumptions (tab kind `users`, id `users:<profile>:<db>`, sidebar db context-menu item; `usersInfo:1` then exact-match `usersInfo` with `showPrivileges`; credentials never sent; sorted by name; plain mongo8 fixture without `--auth`)
- `SPEC.md` M6 (Should) users and roles viewer, read-only
- `docs/ARCHITECTURE.md` (Coverage, Conventions), `AGENTS.md`
- Parent instructions (model spec, sidebar spec, backend handler gaps)

## Test files changed

- `packages/renderer/src/app/admin/users/users-roles.model.spec.ts` (new)
- `packages/renderer/src/app/admin/users/users-roles-view.spec.ts`
- `packages/renderer/src/app/sidebar/sidebar-tree.service.spec.ts`
- `packages/renderer/src/app/sidebar/sidebar-tree.spec.ts`
- `packages/backend/src/admin/users/handlers.spec.ts`
- `test/integration/users-roles.int.spec.ts`

## Tests added or updated

Count: 42 (41 added, 1 existing test strengthened with an extra assertion: the read-only profile test now also checks that "Users and roles" stays enabled)

- Model (16): `resourceLabel` cluster / any resource / only `true` flags count / `db.coll`, `db.*`, `*.coll`, `*.*` / `system_buckets` (named, empty, any db) / malformed input (null, undefined, string, number, `{}`, wrong field types); `roleKey`; `toUserEntry` full reduction (sorted roles, inherited-only roles, privilege order cluster → any resource → others, sorted actions, mechanisms, custom data, restrictions), missing fields, malformed list entries, non-object JSON, non-JSON text throws, EJSON custom data in shell syntax, invalid EJSON custom data → null; `toRoleEntry` full reduction incl. `system_buckets`, `isBuiltin` only when `true`, missing fields.
- View (11): roles failure alert while users stay listed; Refresh after failure clears the alert and the loading state; authentication-restriction count without mechanisms; older roles answer arriving last (reverse order, controlled with deferred promises) does not replace the newer one; older failing answer arriving last shows no error; built-in toggle off again reloads and same value sends nothing; `openRole` ignores a role of another database; link to a listed custom role does not reload; a vanished selection falls back to the first entry; a re-targeted tab loads the new database and resets the selection; a tab without profile/db sends nothing.
- Sidebar service (3): `openUsers` tab shape and production flag; twice selects the existing tab, another db gets its own; unknown profile falls back to its id.
- Sidebar component (1 + 1 strengthened): db context menu "Users and roles" opens the `users:p1:shop` tab and closes the menu; enabled on a read-only profile.
- Backend handlers (7): details asked only for string user names; malformed answers (`users`/`roles` not a list) read as empty for both methods; nameless roles sort first and fields are passed through; canonical EJSON preserves types (`$numberInt`, `$date`); refusal of the detail query → `SERVER_ERROR`; `admin.users` cancel → `CANCELLED` at once.
- Integration (3): no custom roles of another database are listed; `admin.users` and `admin.roles` without `db` → `INVALID_PARAMS` through the contract-validating server.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: Integration test against a fixture with custom roles | `test/integration/users-roles.int.spec.ts` (9 tests: users with roles/inherited roles/privileges, no credentials, empty db, custom roles with privileges and inheritance, built-in roles on request, NOT_CONNECTED, other db has no roles, INVALID_PARAMS x2) | `npm run test:int -- users-roles` (mongo8 fixture via Podman) | Pass (9/9) |
| AC2: Component tests for the views | `users-roles-view.spec.ts` (24 tests), `users-roles.model.spec.ts` (16 tests) | `cd packages/renderer && npx ng test --include='src/app/admin/**/*.spec.ts'` | Pass (40/40) |
| Assumption: tab opened from the db context menu, kind `users`, id `users:<profile>:<db>` | `opens the users and roles tab of a database from its context menu`, `openUsers ...` (3), read-only menu assertion | `cd packages/renderer && npx ng test --include='src/app/sidebar/**/*.spec.ts'` | Pass (184/184) |
| Assumption: `usersInfo:1` then exact match with `showPrivileges`; credentials dropped; sorted by name; server errors → SERVER_ERROR; cancel → CANCELLED | `handlers.spec.ts` (16 tests) | `cd packages/backend && npx vitest run src/admin/users` | Pass (16/16) |
| Read-only: no write action in the view; menu item is a read | read-only menu assertion in `sidebar-tree.spec.ts` | as above | Pass |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/app/admin/**/*.spec.ts'` -> 2 files, 40 passed
`cd packages/renderer && npx ng test --include='src/app/sidebar/**/*.spec.ts'` -> 2 files, 184 passed
`cd packages/backend && npx vitest run src/admin/users` -> 16 passed
`npm run test:int -- users-roles` -> 9 passed

Result:

Pass

## Full test execution

Command:

`npm run check` (lint && typecheck && test)

Result:

Fail, for an environment reason outside the task: `npm run lint` passes (after `prettier --write` on the two new/changed renderer spec files), but the backend `typecheck` step fails with `TS2307 Cannot find module '@mongosh/...'` in `packages/backend/src/shell/runtime.ts` because `node_modules/@mongosh` is not installed in this clone (pre-existing; installing dependencies is outside the test-writer's authority). The remaining steps were run separately: `npm run lint` -> pass; `npm run typecheck -w packages/renderer` -> pass; `npx tsc -p packages/backend/tsconfig.json` -> only the four `src/shell/runtime.ts` missing-module errors, none in task files; `npm run test` -> Pass (root Vitest 70 files / 3882 tests; renderer 83 files / 2497 tests). The parent should run `npm install` and re-run `npm run check` / `.taskcheck`.

## .taskcheck

Result:

Not run as such (it runs `npm run check`; see above: fails only on the missing `@mongosh` modules in this clone's `node_modules`).

## Bugs found

None that violate a requirement.

Informational (no test kept, not a requirement violation): `listUsers` (`packages/backend/src/admin/users/users.ts:47`) throws `TypeError` if a `usersInfo` answer contains a `null` entry. A real server never answers that, so the test case was reduced to realistic malformed entries (non-string `user`, missing `user`).

## Coverage

Status: verified (whole-file, task-scoped), Vitest `@vitest/coverage-v8` (Vitest v5.1.0).

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured (no changed-line tooling configured); the uncovered locations below were checked against the task diff by hand.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `users-roles-view`; base `8020ba9e644ea2da3c9d47835f542da1213e48ba`; HEAD `38e0fd91d1fdecac5dc8ab88d2c4a373f2879cf2`; commits 70f9f9c, 38e0fd9 from the parent, scope = `git diff --name-only 8020ba9..HEAD -- '*.ts'` minus spec files.
- Source/test snapshot identifier (including uncommitted inputs): production = HEAD 38e0fd9 (no uncommitted production changes). Uncommitted test files (sha256): `handlers.spec.ts` 03030963…6d3e094; `users-roles-view.spec.ts` acdba59a…f09b2; `users-roles.model.spec.ts` 73446d79…9c01; `sidebar-tree.service.spec.ts` 5e325926…981e; `sidebar-tree.spec.ts` b6343299…15be1; `users-roles.int.spec.ts` bda2a371…8303. Taken after the runs; no file changed between the runs and these hashes.
- Exact included files: backend `src/admin/users/handlers.ts`, `src/admin/users/users.ts`, `src/admin/users/index.ts`, `src/server/backend.ts`, `src/index.ts`; renderer `src/app/admin/users/users-roles-view.ts`, `src/app/admin/users/users-roles.model.ts`, `src/app/admin/users/index.ts`, `src/app/app.config.ts`, `src/app/layout/workspace.service.ts`, `src/app/sidebar/sidebar-tree.service.ts`, `src/app/sidebar/sidebar-tree.ts`. Excluded: `users-roles-view.html` / `.css`, `layout/tab-bar.css` (templates and styles are not instrumented by V8 coverage; the template is exercised by the component tests). No renamed or deleted files.
- Provider/version, command, working directory, and test selection:
  - backend (full backend suite): `cd packages/backend && npx vitest run --coverage --coverage.include=<5 files above> --coverage.reportsDirectory=coverage/users-roles-view-all --coverage.reporter=text --coverage.reporter=json-summary` (34 files, 1460 tests passed)
  - backend (focused, for reference): same with `src/admin/users` selection and `coverage/users-roles-view`
  - renderer (full renderer suite): `cd packages/renderer && npx ng test --coverage --coverage-include=<7 files above> --coverage-reporters=text --coverage-reporters=json-summary` (83 files, 2497 tests passed)
- Run start/completion time and exit status: backend full 2026-11-17T03:31:09Z–03:31:21Z, all tests passed; backend focused 03:30:58Z; renderer 03:31:29Z–03:31:50Z, all tests passed.
- Generated report paths and report hashes/run identifier: `packages/backend/coverage/users-roles-view-all/coverage-summary.json` sha256 fe43037a…c87f370; `packages/backend/coverage/users-roles-view/coverage-summary.json` sha256 1eb992e0…39bf0; `packages/renderer/coverage/renderer/coverage-summary.json` sha256 8b28023d…cd737 (written 04:31:50 local, inside the run window).
- Evidence outputs are fresh and inputs stayed unchanged: yes (new backend report directories; renderer report directory created during the run; no test or source edits after the runs).
- Final run after latest test additions and production fixes: yes (no production fixes were made).

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/admin/users/users.ts` | 24/24 (100%) | 14/15 (93.33%) | 9/9 (100%) | 22/22 (100%) |
| `packages/backend/src/admin/users/handlers.ts` | 3/3 (100%) | N/A (0/0) | 3/3 (100%) | 3/3 (100%) |
| `packages/backend/src/admin/users/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/backend/src/index.ts` | 1/1 (100%) | N/A | N/A | 1/1 (100%) |
| `packages/backend/src/server/backend.ts` | 53/56 (94.64%) | 16/18 (88.88%) | 16/19 (84.21%) | 50/51 (98.03%) |
| `packages/renderer/src/app/admin/users/users-roles-view.ts` | 96/100 (96%) | 48/54 (88.89%) | 27/27 (100%) | 80/80 (100%) |
| `packages/renderer/src/app/admin/users/users-roles.model.ts` | 43/43 (100%) | 45/45 (100%) | 21/21 (100%) | 37/37 (100%) |
| `packages/renderer/src/app/admin/users/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/renderer/src/app/app.config.ts` | 1/1 (100%) | N/A | N/A | 1/1 (100%) |
| `packages/renderer/src/app/layout/workspace.service.ts` | 55/55 (100%) | 37/38 (97.37%) | 16/16 (100%) | 38/38 (100%) |
| `packages/renderer/src/app/sidebar/sidebar-tree.service.ts` | 230/230 (100%) | 97/97 (100%) | 66/66 (100%) | 184/184 (100%) |
| `packages/renderer/src/app/sidebar/sidebar-tree.ts` | 399/408 (97.79%) | 238/272 (87.5%) | 91/91 (100%) | 341/342 (99.71%) |

Aggregates (summed counters): backend 81/84 statements (96.42%), 30/33 branches (90.9%), 28/31 functions (90.32%), 76/77 lines (98.7%); renderer 824/837 statements (98.44%), 465/506 branches (91.89%), 221/221 functions (100%), 681/682 lines (99.85%). Excluded and not instrumented: the `.html`/`.css` files named above. No scoped `.ts` file is missing from the reports.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/backend/src/admin/users/users.ts:29` (`?? ''` for the second compared entry) | sort of nameless entries | Justified gap: one side of the nullish fallback; nameless sorting is tested (`admin.roles sorts entries without a name first`), which order V8 compares in is engine-defined. |
| `packages/renderer/src/app/admin/users/users-roles-view.ts:181, 201` (`if (request.signal.aborted) return;` after a successful answer) | stale answers must not overwrite newer state | Justified gap: `ApiService` rejects an aborted request with `CANCELLED` at once, so a success after an abort cannot arrive; the stale-answer behavior is covered by `an older roles answer arriving last ...` and `an older failing answer arriving last ...`. |
| `packages/renderer/src/app/admin/users/users-roles-view.ts:91-101` (`?? null` branches of `user`/`role`) | detail when a loaded list is empty | Justified gap: with an empty list the template shows the empty state and never reads `user()`/`role()`; empty states are tested. |
| `packages/backend/src/server/backend.ts:69`, `packages/renderer/src/app/sidebar/sidebar-tree.ts:341`, `packages/renderer/src/app/layout/workspace.service.ts:85` | pre-existing code outside the task's changed lines | Not task code; the task's lines (handler registration, `TabKind` union, `users` menu item) are covered. |

## Unable to test

- Unauthorized caller (missing `viewUser`/`viewRole`) against a real server: the fixture runs without `--auth` (recorded task assumption). Covered by unit tests of the `SERVER_ERROR` mapping in `handlers.spec.ts` and the view's alert test. Follow-up only if an auth-enabled fixture becomes available.
- Visual rendering/CSS of the tab (`users-roles-view.css`, `tab-bar.css`): not covered by unit tests; no e2e criterion in this task.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. `npm run check` could not complete in this clone only because `@mongosh/*` packages are missing from `node_modules` (backend typecheck); lint, renderer typecheck and all unit tests pass when run separately. The parent should `npm install` and re-run `.taskcheck`.

# Test Report

Date: 2026-11-17

Task: users-roles-edit - M6 (Could): Edit users and roles (create/edit/drop users and roles, grant/revoke, through the write guard)

Scope: task commits on top of main. The branch was rebased by the parent twice while this run was in progress; the task's own code diff did not change (same 31 files, +3955/-21, per-file identical stats). Final measured state: base `a02c41b2b71143a9e921e8d76696b81144605651` (merge-base with origin/main), HEAD `2a3fb1c251dabd137bf44386352890544d4a4053`, task commits f4697191, e83464b1, 09cdcd26, 1fcd2050, 90186564, 2a3fb1c2 (the fixer's CR-2..CR-4 commit; originally 77bdb590..2b0b7e60 on base 27adc3ab). Plus the uncommitted test changes listed below. Task ownership: commit subjects prefixed `users-roles-edit:` and the parent's stated range; between the two bases main only changed `tasks/*.md` files and the gridfs task (whose `gridfs.*` lines in `operation.ts` / `write-guard.service.ts` are therefore not task lines).

Requirements:
- `tasks/users-roles-edit.md` acceptance criteria and recorded assumptions (8 `admin.*` write methods; passwords hidden in the confirm dialog; drops always confirm, other changes confirm on production only; only changed fields sent by updateUser)
- `reviews/users-roles-edit/review.md` and `reviews/users-roles-edit/fixes.md` (CR-2 role suggestions for custom roles, CR-3 grant field kept until the grant worked, CR-4 no stale notice after the tab switched database)
- `SPEC.md` M6 / M1 "Safety", `docs/ARCHITECTURE.md` "Coverage" and conventions
- Existing test conventions in `users-roles-view.spec.ts` and `principal-editor.spec.ts` (TestBed, zoneless change detection, `FakeThicketBridge`, `data-testid` queries)

## Test files changed

- `packages/renderer/src/app/admin/users/edit/role-input.spec.ts` (new; `RoleInput` had no spec of its own)
- `packages/renderer/src/app/admin/users/users-roles-view.spec.ts` (5 tests added in `changes`, no existing test changed)

## Tests added or updated

Count: 15 (10 new in `role-input.spec.ts`, 5 new in `users-roles-view.spec.ts`)

`role-input.spec.ts` (`RoleInput`, the component the fixer changed for CR-2 and CR-3):
- emits the typed role of its database and empties the field by default
- Enter picks the role like the button, name@db names another database
- with clearOnPick off the role stays in the field until clear() is called (CR-3)
- a malformed role shows an alert, marks the field invalid and emits nothing
- clear() also ends a shown error (CR-3)
- typing again ends the error
- while disabled, Enter emits nothing and keeps the text
- suggests admin roles as name@admin outside admin, none when the roles go to a role there (CR-2)
- in admin a role still gets the admin roles, by their plain names (CR-2)
- two fields get their own suggestion lists

`users-roles-view.spec.ts` (`UsersRolesView`, describe `changes`):
- a grant cancelled in the confirm dialog keeps the typed role; confirming empties it (CR-3, production confirm path; fails against the pre-fix code, which emptied the field on pick)
- a change answered after the tab moved reads nothing again and keeps the new lists (CR-4 "skips the reload"; fails against the pre-fix code, which read users/roles of the new database a second time)
- a save reported after the form was closed shows nothing and reads nothing again (CR-4, `saved()` with no open editor)
- choosing the mode already shown keeps an open form
- with nothing selected, grant, revoke and drop send nothing (users and roles mode, also `edit()`)

Earlier tests of this task (commits 90186564 and before, not changed here): `edit.spec.ts`, `handlers.spec.ts`, `backend.spec.ts` (backend); `index.spec.ts`, `methods.spec.ts` (contract); `users-edit.model.spec.ts`, `principal-editor.spec.ts`, `users-roles-view.spec.ts`, `users-roles.model.spec.ts`, `operation.spec.ts` "user and role changes" (renderer); `test/integration/users-edit.int.spec.ts`; `test/e2e/users-edit.e2e.ts`.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: Integration tests for each operation (createUser, updateUser, dropUser, createRole, updateRole, dropRole, grantRoles, revokeRoles; guard read-only / production) | `test/integration/users-edit.int.spec.ts`: 16 tests in `roles`, `users`, `admin.dropRole`, `the write guard` | `npm run test:int` | Not run: the parent runs it (instructed; needs the container fixtures) |
| AC2: e2e create user, grant role, connect as that user | `test/e2e/users-edit.e2e.ts` "users and roles: create a user, grant it a role, connect as that user" | `npm run test:e2e` | Not run: the parent runs it (instructed; needs Electron and the MongoDB auth fixture) |
| Backend: each write validates params, checks read-only, sends the right command, never echoes passwords | `edit.spec.ts`, `handlers.spec.ts`, `backend.spec.ts` | `npm run check` (root vitest) | Pass |
| Contract: 8 write methods, roles as role/db objects | `packages/contract/src/index.spec.ts`, `methods.spec.ts` | `npm run check` (root vitest) | Pass |
| Confirm dialog shows the operation, password hidden; drops/revoke destructive | `operation.spec.ts` "user and role changes" | `npm run check` (renderer `ng test`) | Pass |
| Drops always confirm; grant confirms on a production connection; a cancelled change sends nothing | view: "drops a user only after the confirm dialog", "drops a role only after the confirm dialog, also on a non-production connection", "a cancelled drop sends nothing...", "a grant cancelled in the confirm dialog keeps the typed role; confirming empties it" | `npx ng test --include='src/app/admin/users/**/*.spec.ts'` (packages/renderer) | Pass |
| Read-only connection turns every change off | view: "turns every change off on a read-only connection" | same | Pass |
| updateUser sends only changed fields; roles diffed; empty custom data sends an empty document | `principal-editor.spec.ts`, view "changing a user selects it after the save..." | same | Pass |
| CR-2: no admin-database role suggestions for a custom role outside admin | `users-edit.model.spec.ts` forRole cases, `principal-editor.spec.ts` "suggests admin roles for a user; a role outside admin gets only its own database roles", view "suggests admin roles when granting to a user, not when granting to a role of shop", RoleInput "suggests admin roles as name@admin outside admin...", "in admin a role still gets the admin roles..." | same | Pass |
| CR-3: the typed role stays until the grant worked | view "a refused grant keeps the typed role; a grant that worked empties the field", "a grant cancelled in the confirm dialog keeps the typed role; confirming empties it", RoleInput "with clearOnPick off...", "clear() also ends a shown error" | same | Pass |
| CR-4: no notice (and no second reload) when a change ends after the tab switched database | view "a change answered after the tab moved to another database shows no notice", "a failure answered after the tab moved to another database shows no error", "a change answered after the tab moved reads nothing again and keeps the new lists", "a save reported after the form was closed shows nothing and reads nothing again" | same | Pass |
| Only one change at a time | view "a second change while one is pending is ignored" | same | Pass |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/app/admin/users/**/*.spec.ts'`

Result:

Pass (5 files, 152 tests; 137 before this run)

## Full test execution

Command:

`npm run check` (lint with `--max-warnings 0`, Prettier check, typecheck, root `vitest run`, renderer `ng test`), repository root, at HEAD 2a3fb1c2 plus the test changes

Result:

Pass (root vitest 96 files / 5137 tests; renderer 116 files / 3931 tests). An earlier attempt failed on lint/Prettier in the new spec files (non-null assertions, formatting); both were fixed in the tests and the rerun passed.

Integration (`npm run test:int`) and e2e (`npm run test:e2e`): not run by the test-writer, as instructed by the parent.

## .taskcheck

Result:

Pass (`.taskcheck` runs `npm run check`, run above on the final test snapshot)

## Bugs found

None. No test exposed a production defect; no production file was changed.

## Coverage

Status: verified (fresh runs at the final snapshot; all commands exited successfully with all tests passing)

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: measured separately: lcov `DA` executable lines intersected with lines added in `git diff -U0 a02c41b2..2a3fb1c2` per file. Renderer 286/286, backend 56/56, contract 4/4, total 346/346 (100%). Changed-branch coverage is not inferred from it; uncovered branches on changed lines are listed below.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: users-roles-edit; base a02c41b2b71143a9e921e8d76696b81144605651; HEAD 2a3fb1c251dabd137bf44386352890544d4a4053; task commits f4697191..2a3fb1c2 (6 commits, `users-roles-edit:` prefix, range given by the parent and re-pinned after the parent's rebases)
- Source/test snapshot identifier (including uncommitted inputs): HEAD 2a3fb1c2 with production files unchanged versus HEAD; `role-input.spec.ts` sha256 e1e63057ae72a511d6cbd7fb0cf433fb909162a11374195767f37eb45b2b53cc; `users-roles-view.spec.ts` sha256 dd4414040c49a74e85e3342bff6c46958cb53e3bd0e439681f38528b2024ef30 (same hashes before and after the coverage runs). `reviews/users-roles-edit/review.md` was modified in the working tree by another helper during the run; it holds no code.
- Exact included files; renamed/deleted/excluded files and reasons: included renderer `src/app/admin/users/users-roles-view.ts`, `users-roles.model.ts`, `edit/principal-editor.ts`, `edit/role-input.ts`, `edit/users-edit.model.ts`, `edit/index.ts`, `src/app/safety/operation.ts`, `src/app/safety/write-guard.service.ts`; backend `src/admin/users/edit/edit.ts`, `edit/handlers.ts`, `edit/index.ts`, `src/admin/users/index.ts`, `src/server/backend.ts`; contract `src/admin.ts`. Excluded: `.html`/`.css` templates and styles (not instrumented by v8; the templates are exercised through the component specs), spec/integration/e2e files, `docs/ARCHITECTURE.md`. No renamed or deleted files. No scoped file is missing from the reports.
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8` 5.1.0 with vitest 5.1.0 (node v24.21.0). Renderer: in `packages/renderer`, `npx ng test --coverage --coverage-include=` for each of the 8 renderer files above, all renderer specs. Backend: in `packages/backend`, `npx vitest run --coverage --coverage.include=` for each of the 5 backend files, all backend specs. Contract: in `packages/contract`, `npx vitest run --coverage --coverage.include='src/admin.ts'`, all contract specs.
- Run start/completion time and exit status: renderer final run 08:23:46 to 08:24:04 (+0100), 116 files / 3931 tests passed; backend 08:24:17 to 08:24:30, 2277 tests passed; contract run right after, passed; all exited successfully.
- Generated report paths and report hashes/run identifier: `packages/renderer/coverage/renderer/coverage-summary.json` sha256 6cecc5ade04d602c6806993650296ef88f427b3cabffd982653a52b1067096b8, `lcov.info` sha256 b61a6f77b751a6f607a999368abef3e694d9839cc872532fc2e10f0bd9b46411 (written 08:24:04); `packages/backend/coverage/coverage-summary.json` sha256 95573db0e7b0b6fdfc7f5b684af2fb5bea1c814ff5873c29d74b9fdfa2dbad0d, `lcov.info` sha256 7118c7529f2546486d03f2d01a6d15656110bef5a9545c392b4c3409ba4d152f (written 08:24:30); `packages/contract/coverage/coverage-summary.json` sha256 3f4e9f472af34a637b2d7ed1007d9262bcdfb167c73afab20b6d05d61c1c1ac0. The stale `packages/renderer/coverage/coverage-summary.json` (dated 2026-11-16) is not this run's output and was not used.
- Evidence outputs are fresh and inputs stayed unchanged: yes; report files are timestamped by these runs and the spec hashes match before and after.
- Final run after latest test additions and production fixes: yes (after the fixer's commit and after the last test edit)

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/admin/users/users-roles-view.ts` | 179/183 (97.81%) | 103/107 (96.26%) | 47/47 (100%) | 149/149 (100%) |
| `packages/renderer/src/app/admin/users/users-roles.model.ts` | 48/48 (100%) | 49/49 (100%) | 22/22 (100%) | 41/41 (100%) |
| `packages/renderer/src/app/admin/users/edit/principal-editor.ts` | 119/119 (100%) | 85/87 (97.70%) | 18/18 (100%) | 100/100 (100%) |
| `packages/renderer/src/app/admin/users/edit/role-input.ts` | 60/60 (100%) | 20/20 (100%) | 7/7 (100%) | 42/42 (100%) |
| `packages/renderer/src/app/admin/users/edit/users-edit.model.ts` | 61/61 (100%) | 40/41 (97.56%) | 17/17 (100%) | 45/45 (100%) |
| `packages/renderer/src/app/admin/users/edit/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/renderer/src/app/safety/operation.ts` | 111/112 (99.11%) | 93/95 (97.89%) | 12/12 (100%) | 91/92 (98.91%) |
| `packages/renderer/src/app/safety/write-guard.service.ts` | 81/81 (100%) | 73/76 (96.05%) | 12/12 (100%) | 61/61 (100%) |
| `packages/backend/src/admin/users/edit/edit.ts` | 57/57 (100%) | 42/42 (100%) | 6/6 (100%) | 51/51 (100%) |
| `packages/backend/src/admin/users/edit/handlers.ts` | 5/5 (100%) | N/A (0/0) | 2/2 (100%) | 5/5 (100%) |
| `packages/backend/src/admin/users/edit/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/backend/src/admin/users/index.ts` | N/A (0/0) | N/A | N/A | N/A |
| `packages/backend/src/server/backend.ts` | 58/63 (92.06%) | 16/18 (88.89%) | 19/24 (79.17%) | 55/58 (94.83%) |
| `packages/contract/src/admin.ts` | 4/4 (100%) | N/A (0/0) | N/A (0/0) | 4/4 (100%) |
| Aggregate (summed counters, all 14 files, none unmeasured) | 783/793 (98.74%) | 521/535 (97.38%) | 162/167 (97.01%) | 644/648 (99.38%) |

Before this run (baseline at the fixer's revision): renderer scope 651/660 statements, 451/471 branches; `role-input.ts` 59/60 statements, 19/20 branches; `users-roles-view.ts` 176/183 statements, 96/107 branches, with changed-line branches 170, 187, 202, 218, 269 uncovered.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `users-roles-view.ts`: branches 170, 187, 202, 218, 269 (task lines) | setMode with the shown mode, edit/drop/grant with nothing selected, `saved()` after the form closed (CR-4) | Covered now: "choosing the mode already shown keeps an open form", "with nothing selected, grant, revoke and drop send nothing", "a save reported after the form was closed..." |
| `role-input.ts`: branch 119 (disabled guard in `add()`) | Enter on a disabled field must not emit | Covered now: "while disabled, Enter emits nothing and keeps the text" |
| `users-roles-view.ts`: branches 116, 124 (`users`/`roles` not loaded), 369, 389 (aborted request after an answer) | Pre-existing users-roles-view code, not changed by this task | Not task lines; left as is |
| `principal-editor.ts`: branches 156, 182 (`parseCustomData` / `parsePrivileges` failing inside `send()`) | Defensive fallback; Save is disabled while custom data or privileges do not parse (tested in `principal-editor.spec.ts`), so `send()` never sees a parse failure | Justified gap: not reachable through the component |
| `users-edit.model.ts`: branch 92 (`String(error)` for a non-Error thrown by the parser) | Defensive; `parseShellSyntax` throws `ShellSyntaxError` (an Error) | Justified gap: would need mocking the core parser to throw a non-Error |
| `operation.ts`: line 218 (default case), branches 65, 70 | Not task lines (the switch default and `docs.insert`) | Not task lines; every changed line of the file is covered (27/27) |
| `write-guard.service.ts`: branches 129, 161, 203 | Not task lines (the task only added DESTRUCTIVE and TITLES entries, which are covered by the confirm tests) | Not task lines |
| `backend.ts`: lines 82, 88, 155 and 5 functions | Pre-existing backend wiring (not changed by this task; the task only registers `usersEditHandlers`, which `backend.spec.ts` exercises) | Not task lines |

## Unable to test

- AC1 (integration) and AC2 (e2e) were not run here: the parent stated it runs `npm run test:int` and `npm run test:e2e` itself. They need to be run and recorded by the parent before `done`.
- Visual appearance of `principal-editor.css` / `users-roles-view.css` is not unit-testable; covered only by the e2e run.
- The browser's datalist pop-up behavior (choosing a suggestion) is not reproducible in the unit DOM; the tests check the offered option values instead.

## Summary

Tests added and all validation passed. No production defects found. Task-scoped whole-file coverage 98.74% statements / 97.38% branches / 97.01% functions / 99.38% lines (summed counters over 14 files), changed-line coverage 346/346; remaining uncovered task branches are defensive and justified above. Integration and e2e acceptance criteria remain for the parent to run.

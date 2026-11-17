# Code Review

Date: 2026-11-17

Task: users-roles-edit - M6 (Could): Edit users and roles

Scope: task commits 73d5b210..62f28d1f on main (`git diff 85488c85..62f28d1f`); committed changes only. Later test-only work by the test-writer (e.g. the untracked `packages/backend/src/admin/users/edit/edit.spec.ts`) is excluded.

Requirements:
- tasks/users-roles-edit.md (goal, 2 acceptance criteria, 4 recorded assumptions)
- SPEC.md M6 ("Could: Users and roles: create, edit, drop, grant/revoke"), M1 safety (write guard, confirm dialog), section 4/6 contract notes
- docs/ARCHITECTURE.md "Users and roles"
- docs/QUALITY.md (report format), AGENTS.md (project notes: theme tokens, no secrets)

Git range:
- Branch: main
- HEAD: 62f28d1fad6d959cb86f555ce17aa20555465829
- Base/start: 85488c85ce4e3c3d58d1206680174650c6168515
- Commits reviewed: 4 (73d5b210, a6dc0967, 6bea914e, 62f28d1f)

Summary: 0 P0, 0 P1, 1 P2, 3 P3

## What was checked

- Contract (`packages/contract/src/admin.ts`): 8 write methods, all `write: 'always'`, strict params, `roleRef` as `{ role, db }`, privileges and custom data as EJSON text; `index.spec.ts` / `methods.spec.ts` samples and `EXPECTED_WRITES` updated; the `roleRef` exemption in the EJSON doc-field walk matches the recorded assumption.
- Backend (`packages/backend/src/admin/users/edit/*`, `server/backend.ts`): one command per method on the primary in `db` via `runCommand` (no read preference); handlers are registered inside `guardWrites`, so read-only profiles get `READ_ONLY` and production profiles need `confirmed` (covered by the integration test). Password goes only into the command; `toBrowseError` redacts driver messages; no logging of params. `$external` password rules and empty-update rejection are correct.
- Renderer: `describeWrite` cases for all 8 methods show the password only as the hidden marker (`HIDDEN_PASSWORD`, operation.ts:30, 160, 167); drops use `alwaysConfirm`; every button uses `appWriteControl` and the grant field is hidden on read-only profiles; built-in roles get no change/drop/grant/revoke controls; `saving`/`busy` guard double submits; editor sends only changed fields and `{}` when custom data is emptied (per assumption); signals/effects (`untracked` reset on subject change) and templates are consistent; CSS uses only theme tokens that exist in the renderer (`--accent`, `--danger-*`, `--bg-input`, ...), no hard-coded colors.
- Tests: integration `test/integration/users-edit.int.spec.ts` covers every operation (create/update/drop user and role, grant/revoke to user and to role), password sign-in, no password echo in errors, and the guard (read-only, production). e2e `test/e2e/users-edit.e2e.ts` creates a user, grants `read` and connects as that user through the UI against an `--auth` MongoDB 8 container. At review time no criterion evidence was recorded yet (`tasks.py verify users-roles-edit` shows both unticked); that is for the parent to record after running them, not a finding.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | Confirm-dialog text of the new writes (password hiding) and the editor's change diff are untested**
    - File: `packages/renderer/src/app/safety/operation.ts:158` (and `packages/renderer/src/app/admin/users/edit/principal-editor.ts:156`, `packages/renderer/src/app/admin/users/edit/users-edit.model.ts:1`)
    - Category: Tests
    - Problem: `operation.spec.ts` has no case for any of the 8 new `describeWrite` branches; nothing asserts that `admin.createUser` / `admin.updateUser` render `pwd` as the hidden marker and never the password value (the view spec only checks the `dropUser` operation text, on a non-production profile where create/update show no dialog). The "Change user" path of `PrincipalEditor` (password-only change, roles diff, emptied custom data sending `{}`, "nothing changed" closing without a request) and the pure helpers in `users-edit.model.ts` (`parseRoleRef` with `@`, `parsePrivileges` validation, `sameRoles`) have no unit tests in the reviewed scope.
    - Why it matters: never displaying the password in the confirm dialog is an explicit safety rule of the task (recorded assumption); a regression in `describeWrite` (e.g. printing `p.password`) would pass the whole suite. The update diff decides what replaces server state (roles are replaced wholesale), so a bug there silently changes a user's roles.
    - Suggested fix: add `operation.spec.ts` cases for all 8 methods, including one asserting the output for `createUser`/`updateUser` with a password contains the marker and not the password; add a view/editor spec for "Change user" on a production profile (confirm shown, password hidden, only changed fields sent, `{}` for emptied custom data, no request when nothing changed); add unit tests for `users-edit.model.ts`.

## P3 Low

- [ ] **CR-2 | Role suggestions offer roles the server refuses for custom roles outside `admin`**
    - File: `packages/renderer/src/app/admin/users/edit/users-edit.model.ts:61`
    - Category: Correctness
    - Problem: `roleSuggestions` always appends `ADMIN_ROLES` as `name@admin` for non-admin databases, and the same `RoleInput` is used for a role's "Inherits from" list and for granting to a role. MongoDB only lets a role defined in a database other than `admin` inherit roles of its own database, so these suggestions always fail with a server error there.
    - Why it matters: the UI suggests choices that cannot work; the error is shown, so no damage, only friction.
    - Suggested fix: pass the subject kind to `RoleInput` / `roleSuggestions` and offer only same-database roles when granting to (or editing) a role in a non-admin database.

- [ ] **CR-3 | Typed role is cleared before the grant succeeds**
    - File: `packages/renderer/src/app/admin/users/edit/role-input.ts:116`
    - Category: Quality
    - Problem: `add()` clears `text` and emits immediately; in the detail view the emit triggers an async `admin.grantRoles` (`users-roles-view.ts:273`). If the server refuses (unknown role, typo, wrong database), the notice shows the error but the input is already empty.
    - Why it matters: the user must retype the role to correct a typo; minor usability issue.
    - Suggested fix: clear the field only after the parent reports success (e.g. a `reset()` method or an input signal), or keep the text when the grant fails.

- [ ] **CR-4 | A change finishing after the tab switched database shows a stale notice**
    - File: `packages/renderer/src/app/admin/users/users-roles-view.ts:285`
    - Category: Correctness
    - Problem: the target effect clears `notice` and `editing` when the tab's profile/db changes, but a `change()` (grant, revoke, drop) or `saved()` already awaiting the server sets its success/error notice afterwards, e.g. "Granted read to carl." over the lists of the new database.
    - Why it matters: misleading status line in a rare sequence; data is not affected (the reload reads the new target).
    - Suggested fix: capture the target at the start of `change()`/`saved()` and skip setting the notice when it no longer equals `this.target()`.

## Review conclusion

Material issues found; fix before completing the task. No P0/P1 defects: the contract, backend, guard integration and UI meet the acceptance criteria as implemented. CR-1 (missing tests for the password-hiding confirm text and the change diff) should be addressed or explicitly dispositioned; CR-2 to CR-4 are low-priority improvements.

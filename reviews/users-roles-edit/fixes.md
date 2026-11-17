# Fix Report

Date: 2026-11-17

Task: users-roles-edit - M6 (Could): Edit users and roles

Scope: current task; findings CR-1 to CR-4 of `reviews/users-roles-edit/review.md` (CR-1 check only, CR-2 to CR-4 fixed as approved by the parent worker). Base commit 27adc3abd4885ca9a8f0496a7abc21d3a21853d1, task commits 77bdb590..678055ee.

## Fixed findings

### CR-2 — Role suggestions offer roles the server refuses for custom roles outside `admin`

Files changed:
- `packages/renderer/src/app/admin/users/edit/users-edit.model.ts`
- `packages/renderer/src/app/admin/users/edit/role-input.ts`
- `packages/renderer/src/app/admin/users/edit/principal-editor.html`
- `packages/renderer/src/app/admin/users/users-roles-view.html`
- `packages/renderer/src/app/admin/users/edit/users-edit.model.spec.ts`
- `packages/renderer/src/app/admin/users/edit/principal-editor.spec.ts`
- `packages/renderer/src/app/admin/users/users-roles-view.spec.ts`

Problem:
`roleSuggestions` always appended the `admin` built-in roles as `name@admin` outside `admin`, also where the roles go to a custom role (its "Inherits from" list, a grant to a role), which MongoDB refuses for a role of a non-admin database.

Fix:
`roleSuggestions(known, db, forRole = false)`: with `forRole` outside `admin` only the database's own roles are suggested. `RoleInput` got a `forRole` input; the editor passes `!isUser()`, the detail view's grant field passes `mode() === 'roles'`. Typing `name@admin` by hand is still possible (suggestions only, no new validation).

Validation:
- `npx ng test --include='src/app/admin/users/**/*.spec.ts'` (in `packages/renderer`) — Pass (137 tests); new cases: model `forRole` outside/in admin, editor suggestions for user / role in shop / role in admin, view suggestions in users vs roles mode.

### CR-3 — Typed role is cleared before the grant succeeds

Files changed:
- `packages/renderer/src/app/admin/users/edit/role-input.ts`
- `packages/renderer/src/app/admin/users/users-roles-view.html`
- `packages/renderer/src/app/admin/users/users-roles-view.ts`
- `packages/renderer/src/app/admin/users/users-roles-view.spec.ts`

Problem:
`RoleInput.add()` emptied the field before the parent's async `admin.grantRoles` ran, so a refused role had to be retyped.

Fix:
`RoleInput` got a `clearOnPick` input (default `true`, the editor keeps its behavior) and a public `clear()`. The grant field in the detail view sets `clearOnPick` to false and passes itself to `grant(ref, field)`, which calls `field.clear()` only when the grant worked. `change()`/`grantOrRevoke()` now resolve to whether the change worked.

Validation:
- New view test "a refused grant keeps the typed role; a grant that worked empties the field" — Pass

### CR-4 — A change finishing after the tab switched database shows a stale notice

Files changed:
- `packages/renderer/src/app/admin/users/users-roles-view.ts`
- `packages/renderer/src/app/admin/users/users-roles-view.spec.ts`

Problem:
A grant, revoke or drop still awaiting the server set its success or error notice after the tab had moved to another profile/database.

Fix:
`change()` captures the target at the start and sets neither the success nor the error notice (and skips the reload, which the target switch already did) when the target no longer matches. `saved()` needed no change: it sets its notice synchronously and returns early when `editing` is null, which the target switch already ensures (the editor is closed and destroyed).

Validation:
- New view tests "a change answered after the tab moved to another database shows no notice" and "a failure answered after the tab moved to another database shows no error" — Pass

## Not fixed

### CR-1 — Confirm-dialog text of the new writes (password hiding) and the editor's change diff are untested

Status:
Invalid (already resolved before this fix run)

Reason:
Commit 678055ee already added the tests: `packages/renderer/src/app/safety/operation.spec.ts` ("user and role changes") asserts `admin.createUser` and `admin.updateUser` with a password render `pwd: "<hidden>"` and `not.toContain` the password, and covers the other methods. `users-edit.model.spec.ts` and `principal-editor.spec.ts` cover the model helpers and the change diff. No code change needed.

## Validation summary

Focused tests:
- `npx ng test --include='src/app/admin/users/**/*.spec.ts'` (packages/renderer) — Pass, 4 files, 137 tests

Full test suite:
- `npm run check` — Pass (root vitest 94 files / 5040 tests, renderer 113 files passed)

Lint/type-check/build:
- `npm run lint` and `npm run typecheck` as part of `npm run check` — Pass

`.taskcheck`:
- Pass (it runs `npm run check`, run above)

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.

# Fix Report

Date: 2026-11-17

Task: users-roles-view - M6 (Should): Users and roles viewer

Scope: current task; findings CR-1 and CR-2 from `reviews/users-roles-view/review.md` (reviewed HEAD cbfbca2)

## Fixed findings

### CR-1 — Reopening the Users and roles tab reloads it and drops the selection

Files changed:
- `packages/renderer/src/app/admin/users/users-roles-view.ts`
- `packages/renderer/src/app/admin/users/users-roles-view.spec.ts`

Problem:
`target` was a `computed` without an `equal` function. Reopening the tab gives the component a new tab object with the same data, so the effect cleared the user and role selection and loaded both lists again.

Fix:
`target` now compares by value: `{ equal: (a, b) => a.profileId === b.profileId && a.db === b.db }`, the same approach as `AggregationView` and `CollectionView`. A comment explains why. New component test: "reopening the same tab (a new, equal tab object) sends nothing and keeps the selection". It selects bob and the reader role, sets a new tab object with equal data, and checks three things: still one `admin.users` request, still one `admin.roles` request, and both selections kept. With the comparator temporarily replaced by `() => false`, the test failed ("expected ... to have a length of 1 but got 2"). It passes with the fix.

Validation:
- `cd packages/renderer; npx ng test --include='src/app/admin/**/*.spec.ts'` — Pass (2 files, 41 tests)
- Same command with the comparator disabled — Fail as expected (new test only)

### CR-2 — The authentication restriction count probably never shows for real users

Files changed:
- `packages/backend/src/admin/users/users.ts`
- `packages/backend/src/admin/users/handlers.spec.ts`
- `test/integration/users-roles.int.spec.ts`

Problem:
The exact-match `usersInfo` detail query sent only `showPrivileges: true`. The server leaves out `authenticationRestrictions` unless it is asked for them, so the renderer's restriction count never appeared. I confirmed this against the 8.x fixture: before the backend change, the new integration test got `undefined` for the field.

Fix:
The detail query now also sends `showAuthenticationRestrictions: true`, and the doc comment says so. The real server accepts this flag together with `showPrivileges` for an exact-match user list. It returns `authenticationRestrictions` as a flat array (for example `[{ clientSource: [...] }]`), and that is the shape `users-roles.model.ts` already counts. So the restriction display stays, and no model or view change was needed. The integration fixture now creates a user `carol` with `authenticationRestrictions: [{ clientSource: ['192.0.2.10'] }]`. A new test checks that `carol` comes back with that restriction and still has its inherited privileges, and that `alice` comes back with `[]`. The users-list expectation now includes `carol`. Both `handlers.spec.ts` expectations of the command sent now include the new flag.

Validation:
- `npm run test:int -- users-roles` (Podman, mongo8 fixture) — Fail before the backend change (field undefined), Pass after it (10 tests)
- `cd packages/backend; npx vitest run src/admin` — Pass (16 tests)

## Not fixed

None.

## Validation summary

Focused tests:
- `cd packages/renderer; npx ng test --include='src/app/admin/**/*.spec.ts'` — Pass (41 tests)
- `cd packages/backend; npx vitest run src/admin` — Pass (16 tests)
- `npm run test:int -- users-roles` — Pass (10 tests)

Full test suite:
- `npm run check` (unit tests): root vitest 70 files / 3882 tests passed; renderer 83 files / 2498 tests passed

Lint/type-check/build:
- `npm run check` lint (eslint, prettier --check) and typecheck (all workspaces, ngc) — Pass

`.taskcheck`:
- Pass. It runs `npm run check`, which I ran directly through `npm --prefix <repo> run check` and which passed in full.

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.

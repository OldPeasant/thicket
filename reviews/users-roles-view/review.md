# Code Review

Date: 2026-11-17

Task: users-roles-view - M6 (Should): Users and roles viewer

Scope: Task change `git diff origin/main 8cf069d` (origin/main dedda46 is the merge-base). Focus of this round: the merge of origin/main (fded389, conflicts in `app.config.ts`, `sidebar-tree.service.ts`, `sidebar-tree.ts` with the new `shell` tab) and the tests added afterwards in 8cf069d. The rest of the task change (backend `admin.users`/`admin.roles`, `UsersRolesView`, `users-roles.model`, integration test) is unchanged since the previous review of 4b9c7b7 (no findings) apart from the merge; it was re-read for consistency with the merged code.

Requirements:
- tasks/users-roles-view.md acceptance criteria and recorded assumptions
- SPEC.md, docs/ARCHITECTURE.md ("Users and roles" section), AGENTS.md
- Parent instructions (check merge resolution and new tests)

Git range:
- Branch: main
- HEAD: 8cf069d7e1888a2adccdd899da4525d1367b75e1
- Base/start: dedda46bd91a53436def437df17145b5482d4509 (origin/main, merge-base)
- Commits reviewed: task commits up to 8cf069d, focusing on fded389 (merge) and 8cf069d (tests); no uncommitted changes

Summary: 0 P0, 0 P1, 0 P2, 0 P3

## Merge resolution checked

- `packages/renderer/src/app/app.config.ts`: both `provideTabView('users', UsersRolesView)` and `provideTabView('shell', ShellConsole)` are registered, each once; imports for both present. Against origin/main the task diff only adds the users import and registration.
- `packages/renderer/src/app/sidebar/sidebar-tree.service.ts`: `openUsers` sits next to main's `openShell`; both imports (`usersTabId`/`UsersTabData`, `shellTabId`/`ShellTabData`) kept; `openShell` is byte-identical to main.
- `packages/renderer/src/app/sidebar/sidebar-tree.ts`: database context menu lists `open-shell` then `users`, no duplicate ids; `users` is not flagged `write`, so it stays enabled on read-only profiles (a read). Connection menu `open-shell` from main is untouched.
- `layout/workspace.service.ts` `TabKind` includes both `shell` (from main) and `users`; `tab-bar.css` keeps main's `shell` icon rule and adds `users` to the `admin` rule.
- Backend wiring (`backend.ts` `usersHandlers`, `index.ts` export) and the ARCHITECTURE.md section are unaffected by the merge.

## New tests checked

- `app.spec.ts`: asserts each tab kind is registered exactly once and that `indexes`, `users`, `shell` map to the expected components; this catches a lost or duplicated registration from a future conflict.
- `sidebar-tree.spec.ts`: asserts the database menu contains `menu-open-shell` and `menu-users` exactly once each, in that order, and that each opens its own tab (`shell:p1`, `users:p1:shop`) with the users tab active. Asserts behavior through the rendered menu and `WorkspaceService`, not internals.
- Re-run here: `cd packages/renderer && npx ng test --include='src/app/app.spec.ts' --include='src/app/sidebar/**/*.spec.ts' --include='src/app/admin/**/*.spec.ts'` -> 5 files, 244 passed.

## Acceptance criteria

- Integration test against a fixture with custom roles: `test/integration/users-roles.int.spec.ts` unchanged by the merge; recorded evidence (mongo8 fixture, 10 passed) remains applicable since no backend code changed.
- Component tests for the views: `users-roles-view.spec.ts` and `users-roles.model.spec.ts` unchanged and passing in the run above, plus sidebar/app coverage for opening the view.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

None.

## Review conclusion

No material issues found.

# Code Review

Date: 2026-11-17

Task: users-roles-view - M6 (Should): Users and roles viewer

Scope: Task change `git diff origin/main 88c6823` (origin/main 44fd007 is the merge-base). Focus of this round: the merge 88c6823 of origin/main, which added the `validator` tab kind (`ValidatorView`), with its only conflict in the `TabKind` union of `packages/renderer/src/app/layout/workspace.service.ts`. The previous review covered 8cf069d (no findings). Between 8cf069d and 88c6823, the only task-relevant files that changed are `app.config.ts` and `workspace.service.ts`. The backend `admin.users`/`admin.roles`, `UsersRolesView`, `users-roles.model`, the sidebar entry and the integration test are byte-identical to the reviewed revision. They were re-read against the merged code to confirm they still fit together.

Requirements:
- tasks/users-roles-view.md acceptance criteria and recorded assumptions
- SPEC.md, docs/ARCHITECTURE.md ("Users and roles" and the new "Validator tab" section), AGENTS.md
- Parent instructions (check the merge result and how the users tab integrates with the validator and other tabs, the tab-bar CSS and the sidebar menus)

Git range:
- Branch: main
- HEAD: 88c6823c8396528f1b26e744b7b67f8afa70576e
- Base/start: 44fd007c7b65db6629a6a69885662ffc10ae49d1 (origin/main, merge-base)
- Commits reviewed: 13 task commits (origin/main..88c6823), focusing on merge 88c6823; no uncommitted changes

Summary: 0 P0, 0 P1, 0 P2, 0 P3

## Merge resolution checked

- `packages/renderer/src/app/layout/workspace.service.ts`: `TabKind` is `'collection' | 'aggregation' | 'indexes' | 'validator' | 'shell' | 'admin' | 'users'`. It keeps main's `validator` and adds only `users`. Against origin/main, the task diff for this file is just the added `'users'` member, plus the line wrap that the longer union needs.
- `packages/renderer/src/app/app.config.ts`: each of `collection`, `aggregation`, `indexes`, `users`, `shell` and `validator` is registered exactly once. Against origin/main, the task diff only adds the `UsersRolesView` import and `provideTabView('users', UsersRolesView)`. The `app.spec.ts` test "registers exactly one view per tab kind" asserts that kinds are unique, so it also covers `validator`, and it passes.
- `packages/renderer/src/app/layout/tab-bar.css`: the task only adds `.kind[data-kind='users']` to the existing `admin` rule. Main added no `validator` rule, so nothing overlaps. Main's `shell` rule is untouched.
- `packages/renderer/src/app/sidebar/sidebar-tree.service.ts`: main's `closeTabs` change (it now also closes `validator` tabs) merged cleanly next to `openUsers`. `users` tabs are deliberately not closed by `closeTabs`. That is consistent: the tab is per database, and dropping a collection does not affect users or roles. `openUsers` and its imports are unchanged.
- `packages/renderer/src/app/sidebar/sidebar-tree.ts`: the database menu still lists `open-shell` and then `users`, without duplicate ids. The validator is opened from the collection tab ("Validator…"), not from the sidebar, so the sidebar menus have no conflict with it.
- Backend: `backend.ts` registers `usersHandlers(connections)` next to main's `validatorHandlers` (both imports present), and `index.ts` exports `./admin/users`. The method names `admin.users`/`admin.roles` do not overlap with `coll.validator.*`.
- `docs/ARCHITECTURE.md`: the "Users and roles" section is intact. Main's "Validator tab" section merged separately.

## Acceptance criteria

- Integration test against a fixture with custom roles: `test/integration/users-roles.int.spec.ts` is unchanged since the reviewed revision, and the merge did not touch the backend code it exercises. The recorded evidence (mongo8 via Podman, 10 passed) is still valid for this code.
- Component tests for the views: I re-ran them in this review on 88c6823 with `cd packages/renderer && npx ng test --include='src/app/app.spec.ts' --include='src/app/admin/**/*.spec.ts' --include='src/app/sidebar/**/*.spec.ts'`. Result: 5 files, 244 tests passed.

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

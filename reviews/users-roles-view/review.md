# Code Review

Date: 2026-11-17

Task: users-roles-view - M6 (Should): Users and roles viewer

Scope: all committed changes of the task after the rebase onto main, `git diff 62aa9cd..4b9c7b7` (62aa9cd is the merge-base with origin/main). This review covers the whole task again, not only the fixes. It also checks how the task fits with code that main gained since the first review: the `indexes` tab kind, the sidebar closing tabs on drop and rename, and closing tabs when a profile is removed. 4b9c7b7 adds one new code change since revision 096eefe: a test in `packages/renderer/src/app/app.spec.ts`. Its other changes are review reports only.

Requirements:
- tasks/users-roles-view.md (acceptance criteria and recorded assumptions)
- SPEC.md M6 "Users and roles: read-only view per database (privileges, inherited roles)"
- packages/contract/src/admin.ts (`admin.users`, `admin.roles` contract)
- docs/ARCHITECTURE.md, AGENTS.md
- Existing conventions (`indexesTabId` / `aggregationTabId` next to their views, `SidebarTreeService.closeTabs`, `ConnectionsPage` profile removal, `TAB_VIEWS` / `provideTabView`)
- Instructions from the parent worker (rebase context, integration with main)

Git range:
- Branch: main
- HEAD: 4b9c7b7ab6bd7cb32092f47f3d3a01915aac2f3d
- Base/start: 62aa9cda12109876a24c3621abdc10c0dca3b22a
- Commits reviewed: 8 (a170ecd, 559520d, 8337d70, 83938a6, 53cebf5, 096dab4, 096eefe, 4b9c7b7). 096eefe changes only reviews/. 4b9c7b7 adds one test and updates reports in reviews/.
- Uncommitted changes: none, apart from this report.

Summary: 0 P0, 0 P1, 0 P2, 0 P3

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

None.

## Notes (verified, no finding)

- New test (4b9c7b7), `App › registers exactly one view per tab kind, including indexes and users`.
  It configures TestBed with the real `appConfig.providers` and injects the multi-provider token
  `TAB_VIEWS`. It then checks three things:
  - every kind is registered only once;
  - `indexes` maps to `IndexesView`;
  - `users` maps to `UsersRolesView`.

  This guards exactly the result of the rebase conflict in `app.config.ts`. A lost registration,
  or a duplicate registration of the same kind, would make the test fail. A duplicate matters
  because `AppShell.viewFor` takes the first match, so a second view for a kind would be ignored
  without any error. The test checks behavior through the public token, not implementation
  details. Run result: `cd packages/renderer && npx ng test --include='src/app/app.spec.ts'` -> 5
  passed.
- Rebase union: `TabKind` in `layout/workspace.service.ts` is
  `'collection' | 'aggregation' | 'indexes' | 'shell' | 'admin' | 'users'`, and `app.config.ts`
  registers `IndexesView` and `UsersRolesView` together with the existing views. Neither side of
  the conflict was lost. `tab-bar.css` gives `users` the same icon as `admin`.
- Dropping a database: `SidebarTreeService.closeTabs` closes the `collection`, `aggregation` and
  `indexes` tabs of the database, but not a `users` tab. This is correct and not a gap. MongoDB's
  `dropDatabase` does not remove the database's users or roles (they are stored in
  `admin.system.users` / `admin.system.roles`), so the users and roles tab still shows valid data
  after a drop. `shell` tabs also stay open, and the existing test "dropping a database closes the
  tabs of its collections only" still describes the behavior. Dropping or renaming a collection
  only affects tabs that belong to that collection, so it rightly leaves `users` tabs alone.
- Removing a profile: `connections/connections-page.ts:90` closes every tab whose
  `data.profileId` matches, whatever its kind. `UsersTabData` has `profileId`, so `users` tabs are
  closed together with the profile's other tabs.
- Disconnect: no kind of tab is closed on disconnect. A `users` tab behaves the same: a refresh
  shows the `NOT_CONNECTED` error message (`role="alert"`), and the user can try again with
  Refresh.
- Contract: params (`profileId`, `db`, optional `builtin`) and results (arrays of canonical EJSON
  document text) match `packages/contract/src/admin.ts`. Handlers are registered in
  `server/backend.ts` with the other connection handlers. The integration test serves them through
  `serve`/`RpcClient`, so the contract is validated end to end.
- Credentials: `showCredentials` is never requested, and a top-level `credentials` field is
  removed before the result is serialized. Unit tests check that neither the field nor its value
  reaches the result, and the integration test covers it too. The tests contain no committed
  secrets: passwords are generated with `randomBytes`.
- Out-of-order answers and cancellation: `loadUsers` and `loadRoles` each abort their earlier
  request through their own `AbortController`. Answers and failures from aborted requests are
  ignored, and both requests are aborted on destroy. Every path ends in `loaded` or `error`, except
  an aborted one, which a newer request has already replaced. The backend wraps both handlers in
  `abortable`, so a cancel answers `CANCELLED` at once. Unit tests cover all of this.
- Reopening (earlier CR-1): `target` compares by value, so reopening the tab keeps the selection
  and sends no new requests. A different database or a different profile reloads. Component tests
  cover all three cases.
- Authentication restrictions (earlier CR-2): the detail query asks for
  `showAuthenticationRestrictions`. The integration test checks the restriction entries for
  `carol` and an empty list for `alice`.
- Read-only: there are no writes. The sidebar menu item stays enabled on read-only profiles, and a
  sidebar test asserts this.
- Dependency direction: `sidebar-tree.service.ts` imports `usersTabId` / `UsersTabData` from the
  view file. `collection-view.ts` imports `indexesTabId` / `aggregationTabId` from their view files
  in the same way.
- Acceptance criteria:
  1. Integration test against a fixture with custom roles: `test/integration/users-roles.int.spec.ts`
     runs on the mongo8 fixture. `orderClerk` inherits from the custom role `orderReader` and the
     built-in role `read`. Users `alice`, `bob` (holding a role on another database) and `carol`
     (with restrictions) cover the main cases. Users and roles are dropped in `afterAll`. The
     recorded evidence names the command and the result (10 passed).
  2. Component tests for the views: `users-roles-view.spec.ts`, `users-roles.model.spec.ts`, the
     sidebar specs for the menu item and `openUsers`, and now the `appConfig` registration test.
     The recorded evidence names the command and the result.
- Docs: the "Users and roles" section in `docs/ARCHITECTURE.md` matches the code.

## Review conclusion

No material issues found. Reviewed revision: 4b9c7b7ab6bd7cb32092f47f3d3a01915aac2f3d.

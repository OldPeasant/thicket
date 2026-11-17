# Code Review

Date: 2026-11-17

Task: users-roles-view - M6 (Should): Users and roles viewer

Scope: committed changes of the task, `git diff 8020ba9..cbfbca2` (backend `admin.users` / `admin.roles` handlers, integration test, renderer Users and roles tab, sidebar menu item, unit and component tests)

Requirements:
- tasks/users-roles-view.md (acceptance criteria and recorded assumptions)
- SPEC.md M6 "Users and roles: read-only view per database (privileges, inherited roles)"
- packages/contract/src/admin.ts (`admin.users`, `admin.roles` contract)
- docs/ARCHITECTURE.md, AGENTS.md
- Existing conventions (collection-view.ts and aggregation-view.ts tab handling)

Git range:
- Branch: main
- HEAD: cbfbca2dc369845a12ae70855bbb32c08618b4a0
- Base/start: 8020ba9e644ea2da3c9d47835f542da1213e48ba
- Commits reviewed: 3 (70f9f9c, 38e0fd9, cbfbca2); no uncommitted changes

Summary: 0 P0, 0 P1, 1 P2, 1 P3

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | Reopening the Users and roles tab reloads it and drops the selection**
    - File: `packages/renderer/src/app/admin/users/users-roles-view.ts:71`
    - Category: Correctness
    - Problem: `target` is a `computed` without an `equal` function, so it returns a new object
      every time the `tab` input changes. `WorkspaceService.open` (`workspace.service.ts:40`)
      replaces an already-open tab with a new object (`{ ...t, ...tab }`), and `app-shell.ts:115`
      passes that new object to the component. Choosing "Users and roles" again for a database whose
      tab is already open therefore re-runs the effect at line 107. The effect clears the selected
      user and role and calls `refresh()`, so both lists go back to "Loading..." and are fetched
      again, even though the profile and database did not change. `CollectionView` (line 162-175)
      and `AggregationView` (line 123) already prevent this with an `equal` comparator and a
      comment explaining why. The view spec only tests a change to another database, not reopening
      the same tab.
    - Why it matters: Opening the same tab from the sidebar should only select it. Here it
      throws away the user's place in the tab and sends two extra server commands. The view also
      handles the same situation differently from the other tab views.
    - Suggested fix: Add `{ equal: (a, b) => a.profileId === b.profileId && a.db === b.db }` to the
      `target` computed. Add a component test that sets a new tab object with the same data and
      asserts that no new request is sent and the selection stays.

## P3 Low

- [ ] **CR-2 | The authentication restriction count probably never shows for real users**
    - File: `packages/backend/src/admin/users/users.ts:53` (renderer: `packages/renderer/src/app/admin/users/users-roles.model.ts:140`, `users-roles-view.html:81`)
    - Category: Correctness
    - Problem: The renderer counts `authenticationRestrictions` and shows "N authentication
      restrictions". According to the MongoDB `usersInfo` documentation, that field is only returned
      when `showAuthenticationRestrictions: true` is set, and it is off by default. The backend
      detail query sends only `showPrivileges: true`. The integration fixture creates no user with
      restrictions, and the only coverage is a component test with a hand-made document. I could not
      check this against a server here because no MongoDB container was running.
    - Why it matters: The UI code for restrictions may never run against a real server, so the
      read-only view would hide restrictions without saying so.
    - Suggested fix: Add `showAuthenticationRestrictions: true` to the exact-match `usersInfo`
      query, or remove the restriction display. Either way, add a user with
      `authenticationRestrictions` to the integration fixture to prove the result.

## Notes (verified, no finding)

- Credentials: `showCredentials` is never requested, and a top-level `credentials` field is
  removed before results are serialized. Both a unit test and the integration test cover this.
- Contract: params and results match `packages/contract/src/admin.ts`. Results are canonical EJSON
  text, the same as other handlers.
- Out-of-order answers and cancellation: each list has its own `AbortController`, older answers
  and older failures are ignored, and requests are aborted when the view is destroyed. Tests cover
  all of these.
- Read-only: the view only reads data, and the menu item stays enabled on read-only profiles, which
  is correct.
- Accessibility: the mode buttons use `aria-pressed`, the lists are labelled `nav` regions with
  `aria-current`, errors use `role="alert"`, loading uses `role="status"`, and the privilege tables
  have captions and `scope` on header cells.

## Review conclusion

Material issues found; fix before completing the task. CR-1 is a medium regression compared with the conventions in the existing tab views. CR-2 is low priority.

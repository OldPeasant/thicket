# Code Review

Date: 2026-11-17

Task: users-roles-view - M6 (Should): Users and roles viewer

Scope: committed changes of the task up to the final revision, `git diff 8020ba9..8c98ff1`. This re-review focuses on the fix commits, `git diff cbfbca2..62fa503` (056aec3 fixes for CR-1 and CR-2, 62fa503 one added test), and on the docs-only commit 8c98ff1 (new "Users and roles" section in docs/ARCHITECTURE.md). The first review covered 8020ba9..cbfbca2.

Requirements:
- tasks/users-roles-view.md (acceptance criteria and recorded assumptions)
- SPEC.md M6 "Users and roles: read-only view per database (privileges, inherited roles)"
- packages/contract/src/admin.ts (`admin.users`, `admin.roles` contract)
- docs/ARCHITECTURE.md, AGENTS.md
- Existing conventions (collection-view.ts and aggregation-view.ts tab handling)
- reviews/users-roles-view/fixes.md and tests.md (claimed validation)

Git range:
- Branch: main
- HEAD: 8c98ff1a662ae5cdcfa26e72f826bedf7f8e81a7
- Base/start: 8020ba9e644ea2da3c9d47835f542da1213e48ba
- Commits reviewed: 6 (70f9f9c, 38e0fd9, cbfbca2, 056aec3, 62fa503, 8c98ff1). Apart from this report, there are no uncommitted changes.

Summary: 0 P0, 0 P1, 0 P2, 0 P3 open (CR-1 and CR-2 from the first review are resolved)

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [x] **CR-1 | Reopening the Users and roles tab reloads it and drops the selection - RESOLVED in 056aec3**
    - File: `packages/renderer/src/app/admin/users/users-roles-view.ts:71`
    - Category: Correctness
    - Problem: `target` was a `computed` without an `equal` function. Reopening an open tab from the
      sidebar gave the view a new tab object, which cleared the selection and loaded both lists again.
    - Resolution check: `target` now has
      `equal: (a, b) => a.profileId === b.profileId && a.db === b.db`, the same approach as
      `CollectionView` and `AggregationView`. The effect that resets the selection and refreshes only
      depends on `target`, so a new tab object with equal data no longer starts it. Three component
      tests cover this:
      - reopening with an equal tab object sends no new `admin.users` / `admin.roles` request and
        keeps both selections;
      - a tab for another database loads again (earlier test);
      - a tab for the same database of another profile loads again (62fa503). This proves the
        comparator also checks `profileId`.

      fixes.md says the new test failed with the comparator disabled and passes with the fix.

## P3 Low

- [x] **CR-2 | The authentication restriction count probably never shows for real users - RESOLVED in 056aec3**
    - File: `packages/backend/src/admin/users/users.ts:53`
    - Category: Correctness
    - Problem: The exact-match `usersInfo` query did not request `authenticationRestrictions`, so the
      view's restriction count could not appear for real users.
    - Resolution check: The detail query now sends `showAuthenticationRestrictions: true` next to
      `showPrivileges: true`, and the doc comment says so. `showCredentials` is still not requested,
      and `credentials` is still removed.
      - The integration fixture now creates `carol` with `authenticationRestrictions`.
      - A new integration test checks that the restrictions come back as a flat array of documents,
        which is the shape `toUserEntry` counts, together with inherited privileges. It also checks
        that `alice` gets `[]`.
      - The handler unit tests assert the new flag in the command sent.

      fixes.md records that the integration test failed before the backend change and passed after
      it (`npm run test:int -- users-roles`, 10 tests). Restrictions are user metadata (allowed client
      and server addresses), not secrets, so showing them read-only is acceptable.

## Notes (verified, no finding)

- Credentials: `showCredentials` is never requested, and a top-level `credentials` field is
  removed before results are serialized. Unit and integration tests cover this.
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
- Acceptance criteria:
  1. The integration test runs against a fixture with custom roles: `test/integration/users-roles.int.spec.ts`, mongo8 fixture, 10 tests, recorded as passing.
  2. Component tests cover the views (`users-roles-view.spec.ts`, `users-roles.model.spec.ts`) and the sidebar entry.
- The fix commits add no new issues.
- Docs (8c98ff1): the new "Users and roles" section in `docs/ARCHITECTURE.md` matches the code. It
  correctly describes:
  - the tab kind `users`, `usersTabId(profileId, db)`, the `UsersTabData` fields, and opening the tab
    with `SidebarTreeService.openUsers` from the database menu;
  - the read-only content of the users and roles views, including links only to roles of the same
    database and `users-roles.model.ts` reducing the EJSON entries;
  - the two-step `usersInfo` query with `showPrivileges` and `showAuthenticationRestrictions`;
  - that credentials are never requested and are removed if present;
  - that `rolesInfo: 1` runs with `showPrivileges` and `showBuiltinRoles`;
  - the path of the integration test.

  The commit changes documentation only, so it does not affect the code evidence (patch-id freshness).

## Review conclusion

No material issues found. CR-1 and CR-2 are resolved. Reviewed revision: 8c98ff1a662ae5cdcfa26e72f826bedf7f8e81a7, the same code as 62fa503 plus the accurate architecture doc section.

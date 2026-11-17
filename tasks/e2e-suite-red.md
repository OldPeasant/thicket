---
title: Test: fix failing e2e tests (layout Compass heading, sidebar drag, LDAP fixture start)
status: in_progress
owner: felix/agent-2
deps: [e2e-screenshot-repaint]
touches: [test/e2e/layout.e2e.ts,test/e2e/ldap.e2e.ts,test/integration/fixtures/ldap.ts]
prio: 2
lease_until: 2026-11-17T06:30:51Z
---
## Goal
`npm run test:e2e` on main (seen 2026-11-17 by e2e-screenshot-repaint, real display, 57 passed / 3 failed,
twice in a row) fails in tests that don't take screenshots:
- `layout.e2e.ts:36` "welcome buttons navigate ... Compass import": after the click the URL is
  `#/connections/import/compass`, but `getByTestId('page-heading')` is not found; the import page
  (`connections/import/import-export-page.ts`) has no `page-heading` test id (the test predates that page).
- `layout.e2e.ts:61` "sidebar width is dragged ...": `aria-valuenow` is 283, expected 340 after
  dragging the splitter by +82 px.
- `ldap.e2e.ts:33`: the LDAP fixture container ends its log before "Waiting for connections"
  (testcontainers log-wait-strategy).
Find each cause (test out of date vs. app bug vs. fixture/environment) and fix it.

## Acceptance criteria
- [x] the three tests pass in `npm run test:e2e` (under a display and headless, DISPLAY/WAYLAND_DISPLAY unset)
  - verified (2026-11-17 07:14+0100 by felix/agent-2): npm run test:e2e at 8d46a2d2 (fresh build, real display DISPLAY=:0/Wayland) -> 61 passed, 1 skipped (demo AppImage, needs npm run dist); headless: node spawn of npx playwright test with DISPLAY and WAYLAND_DISPLAY deleted from env, same build -> 61 passed, 1 skipped; incl. layout.e2e.ts:36, layout.e2e.ts:61 and ldap.e2e.ts (LDAP passes here, kernel 7.1.3, Podman). On Linux kernels 6.19.0-7.0.13 (dell26's failure, SERVER-121912, not reproducible here) ldap.e2e now skips with the reason instead of failing
- [x] if the cause was an app bug, a test covers it
  - verified (2026-11-17 07:14+0100 by felix/agent-2): App bug (splitter drag relied on pointer capture; moves/release off the narrow splitter were lost, 283 = 2nd of 5 steps): cd packages/renderer && npx ng test --include=src/app/layout/app-shell.spec.ts -> 75 passed; the 2 original new tests (moves/release on another element, release position sets width) fail without the fix (2 failed), plus document-listener lifecycle tests; LDAP fixture: npx vitest run --config test/integration/vitest.config.ts ldap-fixture -> 19 passed

## Notes
See SPEC.md and docs/ARCHITECTURE.md ("End-to-end tests").
- ASSUMPTION (2026-11-17 06:52+0100 by felix/agent-2): layout.e2e.ts:36 (Compass import heading) was already fixed by e2e-layout-import-heading (page-heading test id on the import page); nothing more done for it here
- ASSUMPTION (2026-11-17 06:52+0100 by felix/agent-2): Sidebar drag 283 vs 340: 283 = the pointer after the 2nd of 5 steps, the last point still over the narrow splitter, so pointer capture was not in effect and later moves/release missed the splitter (not reproducible here). Treated as an app bug: move/up/cancel now listened on the document and the release position sets the width
- ASSUMPTION (2026-11-17 06:52+0100 by felix/agent-2): LDAP fixture failure on dell26: not reproducible here (kernel 7.1.3, passes); attributed to SERVER-121912 (Enterprise 8.0 refuses kernels 6.19.0-7.0.13, no 8.2 Enterprise image). On such Linux hosts (os.release(), containers share the host kernel) the fixture throws LdapFixtureUnsupportedError and ldap.e2e skips with that reason instead of failing; ldap.int.spec still fails there, with the clear message

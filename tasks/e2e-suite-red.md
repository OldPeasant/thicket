---
title: Test: fix failing e2e tests (layout Compass heading, sidebar drag, LDAP fixture start)
status: in_progress
owner: felix/agent-2
deps: [e2e-screenshot-repaint]
touches: [test/e2e/layout.e2e.ts,test/e2e/ldap.e2e.ts,test/integration/fixtures/ldap.ts]
prio: 2
lease_until: 2026-11-17T06:06:11Z
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
- [ ] the three tests pass in `npm run test:e2e` (under a display and headless, DISPLAY/WAYLAND_DISPLAY unset)
- [ ] if the cause was an app bug, a test covers it

## Notes
See SPEC.md and docs/ARCHITECTURE.md ("End-to-end tests").

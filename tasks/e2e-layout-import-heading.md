---
title: layout.e2e: welcome Import button test expects a page-heading the import page no longer has
status: in_progress
owner: felix/agent-2
deps: []
touches: [test/e2e/layout.e2e.ts,packages/renderer/src/app/connections/import]
prio: 2
lease_until: 2026-11-17T05:55:37Z
---
## Goal
The welcome-page e2e test clicks Import and expects `page-heading` = 'Import from Compass', but the
import/export page's h1 has no `page-heading` test id and reads 'Import and export connections'.

## Acceptance criteria
- [ ] The import/export page h1 carries `data-testid="page-heading"` like the other pages
- [ ] `test/e2e/layout.e2e.ts` expects the real heading text and passes (`npm run test:e2e -- layout.e2e.ts`)
- [ ] `npm run check` passes

## Notes
- ASSUMPTION (2026-11-17 06:35+0100 by felix/agent-2): Fixed the stale e2e expectation instead of renaming the page: the import/export page heading stays 'Import and export connections' (the page does both); the welcome button label 'Import from Compass' is unchanged

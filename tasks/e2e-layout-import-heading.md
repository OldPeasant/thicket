---
title: layout.e2e: welcome Import button test expects a page-heading the import page no longer has
status: in_progress
owner: felix/agent-2
deps: []
touches: [test/e2e/layout.e2e.ts,packages/renderer/src/app/connections/import]
prio: 2
lease_until: 2026-11-17T06:00:38Z
---
## Goal
The welcome-page e2e test clicks Import and expects `page-heading` = 'Import from Compass', but the
import/export page's h1 has no `page-heading` test id and reads 'Import and export connections'.

## Acceptance criteria
- [x] The import/export page h1 carries `data-testid="page-heading"` like the other pages
  - verified (2026-11-17 06:41+0100 by felix/agent-2): import-export-page.html h1 has data-testid=page-heading; cd packages/renderer && npx ng test --include=src/app/connections/import/import-export-page.spec.ts -> 18 passed (new test: exactly one page-heading, an H1, text 'Import and export connections')
- [x] `test/e2e/layout.e2e.ts` expects the real heading text and passes (`npm run test:e2e -- layout.e2e.ts`)
  - verified (2026-11-17 06:41+0100 by felix/agent-2): npm run test:e2e -- layout.e2e.ts (Electron build, Playwright) -> 6 passed, incl. 'welcome buttons navigate to the connection editor and the Compass import'
- [x] `npm run check` passes
  - verified (2026-11-17 06:41+0100 by felix/agent-2): npm run check -> pass (root 85 files/4426 tests, renderer 102 files/3387 tests, lint+typecheck clean)

## Notes
- ASSUMPTION (2026-11-17 06:35+0100 by felix/agent-2): Fixed the stale e2e expectation instead of renaming the page: the import/export page heading stays 'Import and export connections' (the page does both); the welcome button label 'Import from Compass' is unchanged

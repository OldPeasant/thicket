---
title: M0: Application layout: sidebar, tabs, status bar, welcome screen
status: in_progress
owner: felix/agent-1
deps: [themes,api-client]
touches: [packages/renderer/src/app/layout]
prio: 1
lease_until: 2026-11-16T20:55:51Z
---
## Goal
The main window layout: resizable sidebar, tabbed workspace (tabs for collections, shell, admin views), status bar (connection, operation progress), welcome screen with "New connection" and "Import from Compass". Use the frontend-design skill for the visual direction; respect the Business and Tron tokens (no hard-coded colors).

## Acceptance criteria
- [x] Tabs open/close/reorder; sidebar width persists in settings (component tests)
  - verified (2026-11-16 21:36+0100 by felix/agent-1): cd packages/renderer && npx ng test --include='src/app/layout/**/*.spec.ts' at e48d66a -> 7 files, 142 passed (tab-bar/workspace open, close, reorder by drag and Ctrl+Shift+PageUp/Down; sidebar-width.service.spec and desktop store.spec persist sidebarWidth in settings.json)
- [x] Keyboard: Ctrl/Cmd+W closes a tab, Ctrl/Cmd+Tab cycles (test)
  - verified (2026-11-16 21:36+0100 by felix/agent-1): same ng test run -> app-shell.spec keyboard block passes: Ctrl/Cmd+W closes the active tab (also physical KeyW on non-Latin layouts, AZERTY guard, focus handling), Ctrl+Tab/Ctrl+Shift+Tab and Ctrl+PageUp/Down cycle; npm run test:e2e -- test/e2e/layout.e2e.ts: Ctrl+W does not close the window -> pass
- [ ] Welcome screen buttons emit the right navigation (test); e2e screenshot in Business light and Tron dark

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-16 21:00+0100 by felix/agent-1): Sidebar width is a new settings key sidebarWidth (contract SIDEBAR_WIDTH 180..560 px, default 260) in settings.json, so it persists per user, not per window
- ASSUMPTION (2026-11-16 21:00+0100 by felix/agent-1): Welcome buttons navigate to routes /connections/new and /connections/import/compass, which show placeholder pages until connection-ui / profiles-import-export implement them
- ASSUMPTION (2026-11-16 21:00+0100 by felix/agent-1): Ctrl/Cmd+W is always consumed by the renderer, even with no tab open, so it never closes the window; tab reorder by drag and drop plus Ctrl+Shift+PageUp/PageDown; Ctrl+PageUp/PageDown also cycle
- ASSUMPTION (2026-11-16 21:00+0100 by felix/agent-1): The sidebar holds a 'Connections' placeholder (empty state + New connection link) until sidebar-tree; tab views register per kind with provideTabView, unregistered kinds show TabPlaceholder
- ASSUMPTION (2026-11-16 21:17+0100 by felix/agent-1): Ctrl/Cmd+W also matches the physical W key (event.code KeyW) only when the typed character is not a Latin letter, so AZERTY Ctrl+Z (same physical key) stays undo

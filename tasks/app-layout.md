---
title: M0: Application layout: sidebar, tabs, status bar, welcome screen
status: in_progress
owner: felix/agent-1
deps: [themes,api-client]
touches: [packages/renderer/src/app/layout]
prio: 1
lease_until: 2026-11-16T20:15:24Z
---
## Goal
The main window layout: resizable sidebar, tabbed workspace (tabs for collections, shell, admin views), status bar (connection, operation progress), welcome screen with "New connection" and "Import from Compass". Use the frontend-design skill for the visual direction; respect the Business and Tron tokens (no hard-coded colors).

## Acceptance criteria
- [ ] Tabs open/close/reorder; sidebar width persists in settings (component tests)
- [ ] Keyboard: Ctrl/Cmd+W closes a tab, Ctrl/Cmd+Tab cycles (test)
- [ ] Welcome screen buttons emit the right navigation (test); e2e screenshot in Business light and Tron dark

## Notes
See SPEC.md and docs/ARCHITECTURE.md.

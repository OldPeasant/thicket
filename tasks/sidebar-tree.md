---
title: M1: Sidebar tree of connections, databases, collections
status: in_progress
owner: felix/agent-1
deps: [app-layout,api-client,browse-backend,safety-ui]
touches: [packages/renderer/src/app/sidebar]
prio: 1
lease_until: 2026-11-16T21:41:22Z
---
## Goal
Tree: connections → databases → collections/views/time series with lazy loading, counts/sizes on demand, context menus for create/drop/rename (drop asks to type the name), open collection in a tab.

## Acceptance criteria
- [ ] Component tests with the fake API for lazy load, errors, context actions
- [ ] e2e against a fixture: create db+collection, rename, drop with typed name
- [ ] Read-only profile hides/disables write actions (test)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-16 22:23+0100 by felix/agent-1): Sidebar loads profiles itself (profiles.list) and registers their flags in ProfileSafetyService; SidebarTreeService.reloadProfiles() is the hook connection-ui calls after save/delete (there is no profiles-changed broadcast); a refresh button reloads too.
- ASSUMPTION (2026-11-16 22:23+0100 by felix/agent-1): Profiles with secretMode 'ask' get a password prompt in the sidebar before conn.open; the password is passed once and not kept. connection-ui may replace this prompt.
- ASSUMPTION (2026-11-16 22:23+0100 by felix/agent-1): Counts and sizes on demand = context menu: 'Show counts and sizes' (coll.stats / db.stats) and 'Show database sizes' (db.listDatabases withSizes); results shown inline on the node. Views have no stats and cannot be renamed (menu items disabled).
- ASSUMPTION (2026-11-16 22:23+0100 by felix/agent-1): Drops always confirm with the typed name (WriteGuard alwaysConfirm + typeToConfirm), on every profile; create/rename confirm only where WriteGuard requires it (production). Dropping/renaming closes the affected collection tabs. Read-only: write menu items are disabled (with the read-only hint), not hidden.
- ASSUMPTION (2026-11-16 22:23+0100 by felix/agent-1): Collection tab contract: id collection:<profileId>:<db>.<coll>, kind 'collection', data {profileId, db, coll, type} (CollectionTabData in app/sidebar) for collection-view.

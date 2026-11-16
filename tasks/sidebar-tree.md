---
title: M1: Sidebar tree of connections, databases, collections
status: todo
owner:
deps: [app-layout,api-client,browse-backend,safety-ui]
touches: [packages/renderer/src/app/sidebar]
prio: 1
---
## Goal
Tree: connections → databases → collections/views/time series with lazy loading, counts/sizes on demand, context menus for create/drop/rename (drop asks to type the name), open collection in a tab.

## Acceptance criteria
- [ ] Component tests with the fake API for lazy load, errors, context actions
- [ ] e2e against a fixture: create db+collection, rename, drop with typed name
- [ ] Read-only profile hides/disables write actions (test)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.

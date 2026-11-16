---
title: Release (Should): Update available notice
status: todo
owner:
deps: [app-settings,app-layout]
touches: [apps/desktop/src/update,packages/renderer/src/app/update]
prio: 3
---
## Goal
Check the GitHub releases API at start (and daily) unless disabled in settings; show a non-modal notice with a link to the release.

## Acceptance criteria
- [ ] Unit tests with recorded API responses: newer, same, pre-release ignored, network error silent
- [ ] Setting off → no request made (test)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.

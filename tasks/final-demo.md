---
title: Release: full demo script end to end
status: todo
owner:
deps: [m1-e2e,agg-ui,explain-ui,index-ui,conn-ui-m2,shell-ui]
touches: [test/e2e/demo]
prio: 2
---
## Goal
The complete SPEC demo script as one e2e suite (steps 2–11, fixtures instead of Atlas), run against the packaged Linux app.

## Acceptance criteria
- [ ] `npm run test:e2e -- demo` passes against the AppImage
- [ ] Screenshots of every step in Business light and Tron dark committed under reviews/final-demo/

## Notes
See SPEC.md and docs/ARCHITECTURE.md.

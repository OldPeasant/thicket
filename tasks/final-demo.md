---
title: Release: full demo script end to end
status: in_progress
owner: dell26/agent-1
deps: [m1-e2e,agg-ui,explain-ui,index-ui,conn-ui-m2,shell-ui]
touches: [test/e2e/demo]
prio: 2
lease_until: 2026-11-17T04:45:34Z
---
## Goal
The complete SPEC demo script as one e2e suite (steps 2–11, fixtures instead of Atlas), run against the packaged Linux app.

## Acceptance criteria
- [ ] `npm run test:e2e -- demo` passes against the AppImage
- [ ] Screenshots of every step in Business light and Tron dark committed under reviews/final-demo/

## Notes
See SPEC.md and docs/ARCHITECTURE.md.

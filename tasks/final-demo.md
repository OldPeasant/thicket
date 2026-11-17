---
title: Release: full demo script end to end
status: in_progress
owner: dell26/agent-1
deps: [m1-e2e,agg-ui,explain-ui,index-ui,conn-ui-m2,shell-ui]
touches: [test/e2e/demo]
prio: 2
lease_until: 2026-11-17T05:05:47Z
---
## Goal
The complete SPEC demo script as one e2e suite (steps 2–11, fixtures instead of Atlas), run against the packaged Linux app.

## Acceptance criteria
- [x] `npm run test:e2e -- demo` passes against the AppImage
  - verified (2026-11-17 05:48+0100 by dell26/agent-1): npm run dist (AppImage target built: apps/desktop/release/thicket-0.0.0-linux-x86_64.AppImage; .deb target fails on this host: fpm ruby lacks libcrypt.so.1, unrelated), then npm run test:e2e -- demo -> 2 passed (test/e2e/demo/demo.e2e.ts 'release demo, steps 2-11, against the AppImage' 52.7s; m1 demo 9.4s)
- [ ] Screenshots of every step in Business light and Tron dark committed under reviews/final-demo/

## Notes
See SPEC.md and docs/ARCHITECTURE.md.

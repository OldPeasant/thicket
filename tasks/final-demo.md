---
title: Release: full demo script end to end
status: in_progress
owner: dell26/agent-1
deps: [m1-e2e,agg-ui,explain-ui,index-ui,conn-ui-m2,shell-ui]
touches: [test/e2e/demo]
prio: 2
lease_until: 2026-11-17T05:15:53Z
---
## Goal
The complete SPEC demo script as one e2e suite (steps 2–11, fixtures instead of Atlas), run against the packaged Linux app.

## Acceptance criteria
- [x] `npm run test:e2e -- demo` passes against the AppImage
  - verified (2026-11-17 05:48+0100 by dell26/agent-1): npm run dist (AppImage target built: apps/desktop/release/thicket-0.0.0-linux-x86_64.AppImage; .deb target fails on this host: fpm ruby lacks libcrypt.so.1, unrelated), then npm run test:e2e -- demo -> 2 passed (test/e2e/demo/demo.e2e.ts 'release demo, steps 2-11, against the AppImage' 52.7s; m1 demo 9.4s)
  - verified (2026-11-17 05:58+0100 by dell26/agent-1): at final code 287f9b8: npm run dist (AppImage target built, mtime 2026-11-17T04:56:49Z; .deb target fails on this host: fpm ruby lacks libcrypt.so.1, unrelated), then npm run test:e2e -- demo -> test logs that AppImage path+mtime; 2 passed (release demo steps 2-11 against the AppImage 49.2s; m1 demo 10.0s)
- [x] Screenshots of every step in Business light and Tron dark committed under reviews/final-demo/
  - verified (2026-11-17 05:48+0100 by dell26/agent-1): same run wrote test-results/demo/{business-light,tron-dark}/step-01..step-11 (22 PNGs per theme); copied to reviews/final-demo/{business-light,tron-dark}/ and committed in a751b3d; spot-checked step-02 (password masked), step-09 IXSCAN (tron dark), step-11 shell count 40000 (business light)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 05:48+0100 by dell26/agent-1): The .deb target of npm run dist fails on this Fedora host (fpm's bundled ruby needs libcrypt.so.1); the criterion names the AppImage, which builds, so the deb failure is treated as host-specific and out of scope
- ASSUMPTION (2026-11-17 05:55+0100 by dell26/agent-1): Demo step 4 reaches page 3 by typing 3 in the page field + Enter instead of a single click; same result (rows 101-150), and the page field is the paginator's direct-jump control

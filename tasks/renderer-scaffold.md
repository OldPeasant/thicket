---
title: M0: Angular renderer workspace
status: in_progress
owner: dell26/agent-1
deps: [scaffold]
touches: [packages/renderer]
prio: 1
lease_until: 2026-11-16T18:01:08Z
---
## Goal
Angular 22 app in packages/renderer (standalone components, signals, zoneless if Canopy is), built into `packages/renderer/dist` for Electron to load from disk; Vitest unit tests as in JSON Canopy.

## Acceptance criteria
- [ ] `npm run build -w packages/renderer` produces a static build that works from `file://` (relative base href)
- [ ] `npm run dev -w packages/renderer` serves it for development
- [ ] Unit test for the root component runs in `npm run check`
- [ ] No external network resources (fonts are bundled locally, no CDN)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.

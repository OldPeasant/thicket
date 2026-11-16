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
- ASSUMPTION (2026-11-16 18:44+0100 by dell26/agent-1): Renderer specs run with the Angular CLI (ng test, @angular/build:unit-test, Vitest runner, jsdom) instead of a root Vitest project, so copied Canopy specs with templateUrl/styleUrl compile (AOT); root 'test' = 'vitest run && npm run test -w packages/renderer'. Alternative would be @analogjs/vite-plugin-angular in the root projects.
- ASSUMPTION (2026-11-16 18:44+0100 by dell26/agent-1): file:// loading verified structurally (base href ./, all asset refs relative and present, no external URLs); actually loading dist/index.html in Electron 45 was prepared but launching the Electron binary needed an interactive approval that nobody could give at night. Electron loads ES module scripts from file:// via loadFile (as electron-vite apps do); electron-shell/e2e tasks will exercise it.
- ASSUMPTION (2026-11-16 18:45+0100 by dell26/agent-1): No web fonts in the scaffold (system-ui only). Tron fonts (Orbitron/Share Tech Mono) are bundled from npm (@fontsource) by the themes task; no-network.spec.ts guards against CDN URLs.

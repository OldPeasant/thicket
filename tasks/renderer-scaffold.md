---
title: M0: Angular renderer workspace
status: in_progress
owner: dell26/agent-1
deps: [scaffold]
touches: [packages/renderer]
prio: 1
lease_until: 2026-11-16T18:11:19Z
---
## Goal
Angular 22 app in packages/renderer (standalone components, signals, zoneless if Canopy is), built into `packages/renderer/dist` for Electron to load from disk; Vitest unit tests as in JSON Canopy.

## Acceptance criteria
- [~] `npm run build -w packages/renderer` produces a static build that works from `file://` (relative base href)
  - skipped (2026-11-16 18:52+0100 by dell26/agent-1): Loading in Electron not run: launching the Electron 45 binary (installed in out/electron-check) needed an interactive approval nobody could give. What was checked at 044a8e7: npm run build -w packages/renderer -> production build in packages/renderer/dist, index.html at top level, <base href="./">, script/style refs relative and present (node structural check), no external URLs. Electron file:// load is left to the electron-shell/e2e tasks (assumption recorded).
- [x] `npm run dev -w packages/renderer` serves it for development
  - verified (2026-11-16 18:52+0100 by dell26/agent-1): npm run dev -w packages/renderer -- --port 4317 (ng serve, development config) -> 'Local: http://localhost:4317/', node fetch GET / -> 200 with app-root + vite client, GET /main.js -> 200 text/javascript; then stopped
- [x] Unit test for the root component runs in `npm run check`
  - verified (2026-11-16 18:53+0100 by dell26/agent-1): npm run check at 044a8e7 -> lint + typecheck (ngc strictTemplates + tsc) pass; root vitest 4/4, then ng test (Vitest runner, jsdom) 46/46 incl. src/app/app.spec.ts (root component renders title, zoneless); a deliberately failing renderer spec made the test step exit 1 (test-writer probe)
- [x] No external network resources (fonts are bundled locally, no CDN)
  - verified (2026-11-16 18:53+0100 by dell26/agent-1): npm run build -w packages/renderer + node scan of dist/*.{html,js,css} -> 0 external URLs except XML namespace ids (http://www.w3.org/...), no font files, body font system-ui; src/no-network.spec.ts (in npm run check) fails on remote src/href/srcset/ngSrc/url()/@import in src/ (probe with a Google Fonts @import failed as expected); CSP default-src 'self'; font-src 'self'

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-16 18:44+0100 by dell26/agent-1): Renderer specs run with the Angular CLI (ng test, @angular/build:unit-test, Vitest runner, jsdom) instead of a root Vitest project, so copied Canopy specs with templateUrl/styleUrl compile (AOT); root 'test' = 'vitest run && npm run test -w packages/renderer'. Alternative would be @analogjs/vite-plugin-angular in the root projects.
- ASSUMPTION (2026-11-16 18:44+0100 by dell26/agent-1): file:// loading verified structurally (base href ./, all asset refs relative and present, no external URLs); actually loading dist/index.html in Electron 45 was prepared but launching the Electron binary needed an interactive approval that nobody could give at night. Electron loads ES module scripts from file:// via loadFile (as electron-vite apps do); electron-shell/e2e tasks will exercise it.
- ASSUMPTION (2026-11-16 18:45+0100 by dell26/agent-1): No web fonts in the scaffold (system-ui only). Tron fonts (Orbitron/Share Tech Mono) are bundled from npm (@fontsource) by the themes task; no-network.spec.ts guards against CDN URLs.
- ASSUMPTION (2026-11-16 18:45+0100 by dell26/agent-1): index.html carries a CSP meta tag: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' (Angular component styles are inline <style> tags); electron-shell may additionally set it via headers.

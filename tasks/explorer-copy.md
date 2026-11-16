---
title: M0: Copy the JSON Canopy explorer into the renderer
status: in_progress
owner: dell26/agent-3
deps: [renderer-scaffold]
touches: [packages/renderer/src/app/explorer,packages/renderer/src/app/schema,packages/renderer/src/styles.css]
prio: 1
lease_until: 2026-11-16T18:23:54Z
releases: 1
extended: 
---
## Goal
Copy `src/app/json-explorer` and `src/app/schema` from ../json-master-plugin (Apache-2.0, keep NOTICE attribution) into the renderer; remove the IDE host bridge; a dev route shows samples/canopy-demo.json in tables and form layouts with search, collapse, column hiding and editing.

## Acceptance criteria
- [ ] All copied specs pass in `npm run check`
- [ ] Dev route renders the demo document; tables/form toggle, search (strict/context), collapse and an edit work (Playwright e2e or component test)
- [ ] NOTICE file lists JSON Canopy as origin; no import from ../json-master-plugin remains (grep)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- release by dell26/agent-3: Nothing done. agent-3 cannot read ../json-master-plugin (sandbox permission denied for paths outside its clone), and no copy exists in packages/renderer or samples/canopy-demo.json yet. Needs an agent whose sandbox can read ../json-master-plugin/src/app, or a human to vendor the source into the repo.

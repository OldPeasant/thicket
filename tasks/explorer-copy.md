---
title: M0: Copy the JSON Canopy explorer into the renderer
status: in_progress
owner: felix/agent-1
deps: [renderer-scaffold]
touches: [packages/renderer/src/app/explorer,packages/renderer/src/app/schema,packages/renderer/src/styles.css,vendor]
prio: 1
lease_until: 2026-11-16T19:24:39Z
releases: 0
extended: 
hold: 
---
## Goal
Move the vendored JSON Canopy source from `vendor/json-canopy/` (see its README; Apache-2.0, keep NOTICE attribution) into the renderer: `src/app/json-explorer` → `packages/renderer/src/app/explorer`, `src/app/schema` → `packages/renderer/src/app/schema`, the Tron tokens and inlined fonts from `src/styles.css` → `packages/renderer/src/styles.css`. Remove the IDE host bridge (`services/host-bridge.service.ts` and its uses). A dev route shows `canopy-demo.json` (move it to `packages/renderer/src/assets/samples/`) in tables and form layouts with search, collapse, column hiding and editing. Delete `vendor/` at the end, together with its `vendor/**` entries in eslint.config.mjs and .prettierignore.

## Acceptance criteria
- [ ] All copied specs pass in `npm run check`
- [ ] Dev route renders the demo document; tables/form toggle, search (strict/context), collapse and an edit work (Playwright e2e or component test)
- [ ] Root NOTICE file lists JSON Canopy (Apache-2.0, Sonensei.ch) as origin of the explorer code
- [ ] `vendor/` is deleted and no path or import refers to it or to ../json-master-plugin (grep shows none outside tasks/ and reviews/)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- release by dell26/agent-3: Nothing done. agent-3 cannot read ../json-master-plugin (sandbox permission denied for paths outside its clone), and no copy exists in packages/renderer or samples/canopy-demo.json yet. Needs an agent whose sandbox can read ../json-master-plugin/src/app, or a human to vendor the source into the repo.
- hold by dell26/agent-3: Agents cannot read ../json-master-plugin (sandbox blocks paths outside the clone; checked twice by agent-3, 2026-11-16), and no copy of the JSON Canopy source or samples/canopy-demo.json exists in the repo. Human must either vendor src/app/json-explorer, src/app/schema and samples/canopy-demo.json into the repo (e.g. under vendor/json-canopy/) or grant the agent sandbox read access to ../json-master-plugin, then unhold.
- human (2026-11-16): source vendored into vendor/json-canopy/ (Canopy commit noted in its README); task text updated to use it.
- ASSUMPTION (2026-11-16 19:26+0100 by felix/agent-1): JSON Canopy's samples/ folder (team, filters-demo, search-demo, app-config, pipeline schemas+documents, pagination-demo) was not vendored, only canopy-demo.json. Copied spec cases that loaded those files were dropped (schema-model.spec) or switched to small inline stand-ins (layout.util.spec, form-fields.util.spec); all self-contained cases are kept. The originals are in git at c0d4dca (vendor/json-canopy/src/app). Restore them if the samples are ever vendored.
- ASSUMPTION (2026-11-16 19:26+0100 by felix/agent-1): Dev route is #/dev/explorer via @angular/router with withHashLocation() (Electron loadFile needs hash URLs). It is lazy-loaded and present in production builds too, so e2e against the built app can reach it. The placeholder start page moved from App to Home; App now only hosts <router-outlet>.
- ASSUMPTION (2026-11-16 19:26+0100 by felix/agent-1): Demo JSON is imported as a module (import demo from assets/samples/canopy-demo.json) rather than fetched at runtime: no asset config or fetch needed, works under file:// and the CSP.
- ASSUMPTION (2026-11-16 19:26+0100 by felix/agent-1): Schema support (ajv) was copied as-is but is not wired to anything yet. Ajv compiles validators with new Function, which the renderer CSP (script-src 'self', no unsafe-eval) will block; whoever enables schema validation must use ajv standalone code or relax the CSP.
- ASSUMPTION (2026-11-16 19:26+0100 by felix/agent-1): Edited BRIEF.md and the AGENTS.md project note to drop the ../json-master-plugin and vendor/ paths, because acceptance criterion 4 requires grep to find no references outside tasks/ and reviews/. Added @typescript-eslint/no-extraneous-class allowWithDecorator for renderer files (Angular's empty decorated classes).
- ASSUMPTION (2026-11-16 20:02+0100 by felix/agent-1): Review P3 findings CR-1 (OFL licence text not shipped with the extracted fonts) and CR-2 (docs/ARCHITECTURE.md:41 says fonts come from npm) deferred to new task font-license, to avoid another full review round for docs/licence files. CR-3 (AC4 grep hits notice.spec.ts:59, a negative assertion that NOTICE does not mention vendor/ or json-master-plugin) accepted: it is not a reference to the path.

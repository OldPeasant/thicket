---
title: Ship the SIL OFL 1.1 text with the Orbitron/Share Tech Mono fonts and update docs/ARCHITECTURE.md font note
status: in_progress
owner: felix/agent-2
deps: [explorer-copy]
touches: [packages/renderer/src/assets/fonts,NOTICE,docs/ARCHITECTURE.md]
prio: 2
lease_until: 2026-11-16T19:54:54Z
---
## Goal
The explorer-copy task extracted the Orbitron and Share Tech Mono fonts from JSON Canopy's inlined CSS into
`packages/renderer/src/assets/fonts/*.woff2` (CSP `font-src 'self'` blocks data: URLs). NOTICE says they are
under the SIL Open Font License 1.1, but the licence text (with each font's copyright line) is not shipped,
which the OFL requires. `docs/ARCHITECTURE.md:41` still says fonts come from npm packages.
(Findings CR-1/CR-2 of the final explorer-copy review, reviews/explorer-copy/review.md.)

## Acceptance criteria
- [ ] The full SIL OFL 1.1 text with the Orbitron and Share Tech Mono copyright lines is in the repo next to the fonts and is included in the renderer build output
- [ ] docs/ARCHITECTURE.md describes where the fonts live (src/assets/fonts, bundled by the build)

## Notes
- ASSUMPTION (2026-11-16 20:36+0100 by felix/agent-2): OFL.txt is copied to dist/media/ (where the build emits the hashed woff2 files) via an angular.json assets entry; angular.json is outside the task's touches list but is the only way to include it in the build output. Copyright lines taken verbatim from the fonts' name tables.

# Fix Report

Date: 2026-11-16

Task: explorer-copy - M0: Copy the JSON Canopy explorer into the renderer

Scope: current task; findings CR-1, CR-2, CR-3 and CR-4 / TW-1 from reviews/explorer-copy/review.md and reviews/explorer-copy/tests.md, as passed on by the parent worker.

## Fixed findings

### CR-1 - Inlined data: URL fonts are blocked by the renderer CSP (font-src 'self')

Files changed:
- `packages/renderer/src/styles.css`
- `packages/renderer/src/assets/fonts/orbitron.woff2` (new)
- `packages/renderer/src/assets/fonts/share-tech-mono.woff2` (new)

Problem:
Both @font-face rules used `url(data:font/woff2;base64,...)`. The CSP in `packages/renderer/src/index.html` only allows `font-src 'self'`, so the browser would refuse both fonts.

Fix:
A temporary node script (run from the repo, then deleted) decoded the two base64 payloads into `orbitron.woff2` (11800 bytes) and `share-tech-mono.woff2` (13500 bytes). Both files start with the `wOF2` signature. styles.css now uses `url('./assets/fonts/orbitron.woff2')` and `url('./assets/fonts/share-tech-mono.woff2')`. The header comment now says the fonts ship as files with the app (SIL OFL 1.1, from JSON Canopy) and that the themes task may switch to npm packages. The CSP is unchanged.

Validation:
- `grep -c "data:" packages/renderer/src/styles.css` - 0 matches (Pass)
- `npm run build -w packages/renderer` - Pass. `dist/media/orbitron-D5C4P7FB.woff2` and `dist/media/share-tech-mono-XX4T45LZ.woff2` are emitted. `dist/styles-QMCW4GGP.css` references `url("./media/orbitron-D5C4P7FB.woff2")` and `url("./media/share-tech-mono-XX4T45LZ.woff2")` (relative paths, no `data:`). `dist/index.html` keeps `<base href="./">` and `font-src 'self'`.
- `src/no-network.spec.ts` (CSP pin) still passes in `npm run check`.

### CR-2 - Stale comments about the removed IntelliJ host

Files changed:
- `packages/renderer/src/styles.css`
- `packages/renderer/src/app/explorer/services/edit-mode.service.ts`
- `packages/renderer/src/app/explorer/services/schema.service.ts`

Problem:
The comments referred to the IntelliJ plugin, JBColor/ThemeSync, the host bridge and "IDE settings", none of which exist in Thicket.

Fix:
The comments were reworded to be neutral and no code changed. The theme comment now says the `data-theme` attribute sets the theme. The `setReadOnly` comment now says the host app calls it and that nothing calls it yet. The schema origin example list dropped "IDE settings". A grep for `intellij|IDE|host bridge|plugin|JBColor` in `packages/renderer/src` finds nothing more.

Validation:
- `npm run check` - Pass (lint, type check, tests)

### CR-3 - Root NOTICE claims Thicket ownership and does not state the modifications

Files changed:
- `NOTICE`

Problem:
NOTICE began with "Thicket / Copyright 2026 Sonensei.ch", but the repo does not say who owns Thicket. It also did not say the JSON Canopy files were modified, which Apache-2.0 section 4(b) requires.

Fix:
NOTICE now starts with "Thicket" and a line saying the product includes software from JSON Canopy. It gives the origin (JSON Canopy 0.4.0, commit 1edaee8, Copyright 2026 Sonensei.ch, Apache-2.0) and a paragraph listing the modifications: the files were moved into the renderer, adapted to Thicket's lint/type settings, the IDE host bridge was removed and the inlined fonts were extracted into files. The original JSON Canopy NOTICE text and the third-party list are kept. The font entries now point to `packages/renderer/src/assets/fonts`.

Validation:
- Manual read of `NOTICE`. Acceptance criterion 3 (NOTICE lists JSON Canopy, Apache-2.0, Sonensei.ch as the origin of the explorer code) still holds.

### CR-4 / TW-1 - mergeTwo mistakes inherited Object names for existing properties

Files changed:
- `packages/renderer/src/app/schema/schema-model.ts`
- `packages/renderer/src/app/schema/schema-model.spec.ts`

Problem:
`mergeTwo` used `merged[name]` to test whether a property already existed. Inherited names such as `toString` or `constructor` were therefore wrapped as `{ allOf: [Function, schema] }`. A `__proto__` property name also changed the prototype of the merged object instead of being stored as data.

Fix:
`mergeTwo` now tests with `Object.hasOwn(merged, name)` and writes with `Object.defineProperty` (enumerable, writable, configurable). `__proto__` is therefore stored as an own data property, and the prototype is never changed. This was a small change, so it was included. Two specs were added under `resolve`. The first checks that `toString` and `constructor` in an allOf part come through unchanged. The second uses a JSON-parsed `__proto__` property and checks that the prototype stays `Object.prototype`, that `__proto__` is an own key and that the key order is `['a', '__proto__']`.

Validation:
- `npm run test -w packages/renderer` - Pass (22 files, 277 tests)

## Not fixed

None.

## Validation summary

Focused tests:
- `npm run test -w packages/renderer` - Pass (22 test files, 277 tests)
- `npm run build -w packages/renderer` - Pass. Font files are in `dist/media/` and the CSS references them with relative URLs.

Full test suite:
- `npm run check` (repo root: lint, type check, root vitest 5 files / 599 tests, renderer 22 files / 277 tests) - Pass

Lint/type-check/build:
- `npx prettier --write` on all touched files - done (styles.css reformatted, the rest unchanged)
- lint and type check are part of `npm run check` - Pass
- `npm run build -w packages/renderer` - Pass

`.taskcheck`:
- Pass (it runs `npm run check`, which passed as above)

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.

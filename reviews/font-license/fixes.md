# Fix Report

Date: 2026-11-16

Task: font-license - Ship the SIL OFL 1.1 text with the Orbitron/Share Tech Mono fonts and update docs/ARCHITECTURE.md font note

Scope: current task; finding TW-1 from `reviews/font-license/tests.md`, as assigned by the parent worker.

## Fixed findings

### TW-1 — Share Tech Mono copyright line in OFL.txt is not verbatim

Files changed:
- `packages/renderer/src/assets/fonts/OFL.txt`
- `packages/renderer/src/font-license.spec.ts`

Problem:
OFL.txt line 5 ended the Share Tech Mono copyright notice with a period that the font's own copyright record (name table ID 0 in `share-tech-mono.woff2`) does not have. The test `quotes the copyright notice embedded in each font file verbatim` failed because of it.

Fix:
Removed the trailing period after `with Reserved Font Name 'Share'` in OFL.txt line 5. Removed the same period from the matching expected string in the `names the copyright holder of each bundled font` test so it quotes the corrected line. The verbatim test was not changed. It still checks the whole line against the font file.

Validation:
- `cd packages/renderer && npx ng test --include='src/font-license.spec.ts' --include='src/notice.spec.ts'` — Pass (2 files, 12 tests)
- `npm run build -w packages/renderer` then `cmp packages/renderer/dist/media/OFL.txt packages/renderer/src/assets/fonts/OFL.txt` — Pass (identical; `dist/media/` contains `OFL.txt`, `orbitron-D5C4P7FB.woff2`, `share-tech-mono-XX4T45LZ.woff2`)

## Not fixed

None.

## Validation summary

Focused tests:
- `cd packages/renderer && npx ng test --include='src/font-license.spec.ts' --include='src/notice.spec.ts'` — Pass, 12 passed

Full test suite:
- `npm run check` (repo root) — Pass: lint and type check passed, root Vitest 34 files / 2166 tests passed, renderer `ng test` 28 files / 443 tests passed

Lint/type-check/build:
- lint and type check are part of `npm run check` — Pass
- `npm run build -w packages/renderer` — Pass

`.taskcheck`:
- Not run separately. It runs `npm run check`, which passed above.

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.

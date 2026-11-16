# Fix Report

Date: 2026-11-16

Task: explorer-copy - M0: Copy the JSON Canopy explorer into the renderer

Scope: current task; finding TW-2 from reviews/explorer-copy/tests.md (test-writer second pass on commit 5e9bd88), as passed on by the parent worker.

## Earlier fix round (97efff0)

The first fix round resolved CR-1, CR-2, CR-3 and CR-4 / TW-1 from the first review and test pass. Those fixes were committed in 97efff0:

- CR-1: the inlined `data:` fonts broke the CSP `font-src 'self'`. They were extracted to `packages/renderer/src/assets/fonts/orbitron.woff2` and `share-tech-mono.woff2`, and `styles.css` now references them by relative URL. The build emits them under `dist/media/`.
- CR-2: comments about the IntelliJ host, JBColor/ThemeSync, the host bridge and "IDE settings" were reworded in `styles.css`, `edit-mode.service.ts` and `schema.service.ts`. No code changed.
- CR-3: the root `NOTICE` no longer claims Thicket ownership. It names JSON Canopy 0.4.0 (commit 1edaee8, Copyright 2026 Sonensei.ch, Apache-2.0) as the origin and lists the modifications, as Apache-2.0 section 4(b) requires.
- CR-4 / TW-1: `mergeTwo` uses `Object.hasOwn` and `Object.defineProperty`, so `toString`, `constructor` and `__proto__` are treated as plain property names. Two specs were added in `schema-model.spec.ts`.

Validation then: `npm run test -w packages/renderer` passed (277 tests), `npm run check` passed and `npm run build -w packages/renderer` passed.

## Fixed findings

### TW-2 - Inherited Object names in documents resolve to Object.prototype members instead of the schema

Files changed:
- `packages/renderer/src/app/schema/schema-model.ts`

Problem:
Several lookups used `properties?.[key]` without checking for an own property. A document key such as `constructor` or `toString` therefore picked up the inherited `Object.prototype` function as its "declared" schema. As a result:
- `typesAt` ignored `additionalProperties` and `patternProperties` for that key;
- `permitsKey` accepted the key even under `additionalProperties: false`;
- `seed` invented a required `toString` that `properties` does not declare.

Also, `seed` wrote a required `__proto__` key with plain assignment, which changed the prototype of the seeded object instead of adding an own key. Membership tests with `key in obj` had the same inherited-name problem for document and seeded objects.

Fix:
I added two small module-level helpers next to `mergeTwo` and followed the same approach as the 97efff0 fix:
- `ownEntry(record, key)` returns `record[key]` only when `Object.hasOwn(record, key)` is true.
- `setOwn(target, key, value)` writes the value with `Object.defineProperty` as an enumerable, writable and configurable data property.

These changes use the helpers:
- `ownChild` uses `ownEntry` for the `properties` lookup. `permits`, `childrenOf`, `nodesAt`, `typesAt` and `permitsKey` all go through `ownChild`, so they are fixed too.
- `seed` (object case) uses `ownEntry` for the required-key lookup and `setOwn` for the write.
- `switchVariant` uses `ownEntry` for both `target.properties` lookups and `setOwn` for every write to `value` (discriminator, kept or reset keys, added required keys). It tests "already present" with `Object.hasOwn` instead of `in`.
- `selectorValues` uses `ownEntry`.

The same kind of `in` check appeared in three more places, which now use `Object.hasOwn`:
- the filter in `ghostKeys`;
- the `fits` property loop;
- the strict required check in `fits`.

Without this change, a document missing a declared `constructor` key would not have offered it as a ghost key, and `fits` would have treated it as present.

The `patternProperties` handling uses `Object.entries`, which returns only own keys, so it was already correct. The `$ref` pointer walk in `lookup` was left unchanged because it is outside this finding: an inherited function there already fails the `typeof node !== 'object'` check and produces an "unresolved $ref" warning.

Behaviour for ordinary keys is unchanged. For plain JSON objects, `in` and `Object.hasOwn` give the same result for any key that is not inherited, and `defineProperty` with these flags behaves like assignment. The 4 TW-2 tests were left as they were.

Validation:
- `npm run test -w packages/renderer` - Pass (27 files, 432 tests, including the 4 TW-2 tests that failed before)
- `npm run check` (repo root) - Pass

## Not fixed

None.

## Validation summary

Focused tests:
- `npm run test -w packages/renderer` - Pass (27 test files, 432 tests)

Full test suite:
- `npm run check` (repo root: lint with eslint and `prettier --check`, type check of all workspaces, root vitest 14 files / 1051 tests, renderer 27 files / 432 tests) - Pass

Lint/type-check/build:
- `npx prettier --write packages/renderer/src/app/schema/schema-model.ts` - done (it wrapped the `setOwn` descriptor)
- lint and type check are part of `npm run check` - Pass
- Build: not run in this round. The change is a single TypeScript file with no asset or config changes, and `ngc` type checks it as part of `npm run check`.

`.taskcheck`:
- Pass. It runs `npm run check` because `package.json` exists, and that passed as above.

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.

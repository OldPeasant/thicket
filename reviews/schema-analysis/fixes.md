# Fix Report

Date: 2026-11-17

Task: schema-analysis - M3: Schema analysis

Scope: current task; findings CR-1, CR-3, CR-4 and CR-5 from `reviews/schema-analysis/review.md`, as triaged by the parent worker. CR-2 (missing unit tests) was already handled by the test-writer (`reviews/schema-analysis/tests.md`) and was not part of this fix list.

## Fixed findings

### CR-1 - Truncated examples become equality filters that match nothing

Files changed:
- `packages/backend/src/schema/analyze.ts`
- `packages/backend/src/schema/analyze.spec.ts`
- `docs/ARCHITECTURE.md` ("Schema analysis" section)

Problem:
`storedValuesLengthLimit` (200) makes the analyzer cut stored values: strings and Code bodies are cut to the limit (or one less when the cut would split a surrogate pair), and Binary buffers longer than the limit are cut to the limit (`getCappedValue`/`cropString` in `node_modules/@mongodb-js/mongodb-schema/dist/schema-analyzer.js`, the same code as in the old package). These cut values were returned as examples, and clicking one built an equality filter that matched no documents.

Fix:
The limit is now `EXAMPLE_LENGTH_LIMIT` = 1000 (exported). A new `isCut(typeName, value)` in `mergeTypes` drops any example that the analyzer may have cut: `String` values of length >= limit - 1, `Binary` values with `buffer.length` >= limit, and `Code` values with `code.length` >= limit - 1. It checks `_bsontype` rather than `instanceof`, because the analyzer may build cut values with its own `bson` copy. `CodeWScope` is never cut, so it is left alone. The type counts and shares do not change; only the example lists lose these values. As a result, every example returned is a real, complete value. The cutoff is deliberately conservative: a real value exactly at the limit, or one below it for strings and code, is also left out. The renderer already shortens display text and shows a tooltip.

Validation:
- `cd packages/backend && npx vitest run src/schema` - Pass (58 tests). The old test "cuts long example strings at 200 characters" was replaced by two regression tests. The first covers strings: 5000 characters, exactly the limit, limit - 1, and a surrogate pair that straddles the cut. All of these are counted but left out of the examples; only the full values remain. The second covers a Binary over the limit and at the limit, plus long Code; only the short values remain.

### CR-4 - Deprecated `mongodb-schema` dependency

Files changed:
- `packages/backend/package.json`
- `package-lock.json`
- `packages/backend/src/schema/analyze.ts` (import and doc comment)
- `packages/backend/src/schema/analyze.spec.ts` (type import)
- `docs/ARCHITECTURE.md` (stack table, "Schema analysis" section)

Problem:
`mongodb-schema@12.7.0` is deprecated upstream in favour of `@mongodb-js/mongodb-schema`.

Fix:
Ran `npm install @mongodb-js/mongodb-schema@^12.8.20 -w packages/backend` and `npm uninstall mongodb-schema -w packages/backend`. The lock now resolves `@mongodb-js/mongodb-schema@12.8.20`, and the `mongodb-schema` and `mongodb-ns` entries plus the nested yargs tree are gone. I checked API compatibility in the installed `dist/index.d.ts`: it exports the same named items (`parseSchema`, `Schema`, `SchemaType`), and `SchemaParseOptions` still has `storeValues`, `semanticTypes`, `storedValuesLengthLimit` and `signal`. The cut logic is unchanged. The successor still lists the CLI helpers (`cli-table`, `js-yaml`, `numeral`, ...) as optionalDependencies, so that part of the review note remains as upstream ships it. No backend code uses them.

Validation:
- `cd packages/backend && npx vitest run src/schema` - Pass (58)
- `npx vitest run --config test/integration/vitest.config.ts test/integration/schema.int.spec.ts` - Pass (5)
- `npm run check` (includes backend `tsc`) - Pass

### CR-5 - `aria-pressed` on the Schema button does not match its behavior

Files changed:
- `packages/renderer/src/app/collection/collection-view.html`
- `packages/renderer/src/app/collection/collection-view.spec.ts`

Problem:
The `query-schema` button had `aria-pressed` set while the panel was open, which marks it as a toggle. Pressing it again re-runs the analysis instead of closing the panel.

Fix:
Removed `[attr.aria-pressed]`. The behavior is unchanged: the button re-analyzes with the current filter, and the panel has a Close button. The spec now asserts that the button has no `aria-pressed` attribute, both before and after opening. The Close test no longer checks the attribute. No e2e test referenced it.

Validation:
- `cd packages/renderer && npx ng test --watch=false --include='src/app/schema-analysis/**/*.spec.ts' --include='src/app/collection/collection-view.spec.ts'` - Pass (3 files, 168 tests)

## Not fixed

### CR-3 - The query bar's collation is ignored by the analysis

Status:
Out of scope

Reason:
The parent worker accepted this limitation: collation is not part of the `schema.analyze` contract for this task.

## Validation summary

Focused tests:
- `cd packages/backend && npx vitest run src/schema` - Pass (1 file, 58 tests)
- `cd packages/renderer && npx ng test --watch=false --include='src/app/schema-analysis/**/*.spec.ts' --include='src/app/collection/collection-view.spec.ts'` - Pass (3 files, 168 tests). A bare `src/app/schema-analysis/**` glob also matches `schema-panel.css` and fails to build (TS6054), so the glob was limited to spec files.
- `npx vitest run --config test/integration/vitest.config.ts test/integration/schema.int.spec.ts` (from root, MongoDB container) - Pass (5 tests)

Full test suite:
- `npm run check` - Pass (root vitest: 79 files, 4280 tests; renderer: 102 files, 3336 tests)

Lint/type-check/build:
- `npm run check` (eslint `--max-warnings 0`, prettier `--check`, `tsc` for all workspaces, `ngc`) - Pass
- e2e (`test/e2e/schema-analysis.e2e.ts`) - Not run by the fixer. The only change it could notice is the removed `aria-pressed`, which it does not reference.

`.taskcheck`:
- Pass (it runs `npm run check`, as above)

Remaining unresolved findings:
0 in scope (CR-3 is out of scope by parent decision)

## Final status

All validated findings fixed and validation passed.

# Fix Report

Date: 2026-11-17

Task: agg-backend - M3: Aggregation run, stage preview, explain, views

Scope: current task; findings CR-1 to CR-4 from `reviews/agg-backend/review.md`

## Fixed findings

### CR-1 — Preview inserts `$limit` before a `$match` with `$text`, which must be the first stage

Files changed:
- `packages/backend/src/agg/agg.ts`
- `packages/backend/src/agg/agg.spec.ts`
- `test/integration/agg.int.spec.ts`

Problem:
`previewPipeline` put the sample `{ $limit: sampleSize }` in front of a leading `$match` that uses `$text`. MongoDB accepts a `$text` `$match` only as the first stage, so the server rejected every stage preview of a text-search pipeline.

Fix:
Added `mustComeFirst(stage)`. It is true for a `FIRST_STAGES` stage, or for a `$match` whose filter is a plain document with a top-level `$text` key. `previewPipeline` uses it to choose where the sample `$limit` goes, the same way it already handles `$geoNear`. A `$text` nested under `$or` does not count, because MongoDB does not allow that position for the first-stage exception either. Updated the doc comment.
Unit tests: a leading `$text` `$match` keeps its first position and the sample comes after it; a plain `$match` and a nested-`$text` `$match` keep the sample first.
Integration test: a separate `notes` collection gets a text index, and `agg.previewStage` with `[{ $match: { $text: { $search: 'coffee' } } }, { $sort: { _id: 1 } }]` returns `_id` 1 and 3.

Validation:
- `npm run check` — Pass (backend 3253 tests, renderer 2014 tests; lint, prettier and typecheck clean)
- `npx vitest run --config test/integration/vitest.config.ts agg.int` (Podman fixtures) — Pass (15 tests, including the new `$text` case)

### CR-2 — `$out`/`$merge` stage list defined twice (guard and agg)

Files changed:
- `packages/backend/src/guard/guard.ts`
- `packages/backend/src/agg/agg.ts`

Problem:
`agg.ts` and `guard.ts` each kept their own `WRITING_STAGES` list.

Fix:
`guard.ts` now exports `WRITING_STAGES: readonly string[]` and is the only owner of the list. `agg.ts` imports it from `../guard/guard` and no longer defines or exports its own copy. There is no import cycle, because `guard.ts` imports only `@thicket/contract` and `server/rpc`. Nothing else imported `WRITING_STAGES` from agg.

Validation:
- `npm run check` — Pass
- `npx vitest run --config test/integration/vitest.config.ts agg.int` — Pass

### CR-3 — Odd self-referencing import path

Files changed:
- `packages/backend/src/agg/agg.ts`

Problem:
The import used `'../../src/browse/browse'`.

Fix:
Changed it to `'../browse/browse'`.

Validation:
- `npm run check` — Pass

### CR-4 — `isOpenClient` copied from docs/query handlers

Files changed:
- `packages/backend/src/connections/manager.ts`
- `packages/backend/src/agg/handlers.ts`
- `packages/backend/src/docs/query/handlers.ts`

Problem:
Both handler modules contained the same private `isOpenClient` function.

Fix:
Moved it unchanged into `connections/manager.ts` as an exported function next to `abortable`. Both handler modules now import it from there. Behavior is unchanged. The stream wrappers were left as they are, because the review marked the larger "stream helper" refactor as optional.

Validation:
- `npm run check` — Pass
- `npx vitest run --config test/integration/vitest.config.ts agg.int` — Pass (15)
- `npx vitest run --config test/integration/vitest.config.ts query.int` — Pass (35, docs-query)

## Not fixed

None.

## Validation summary

Focused tests:
- `npx vitest run --config test/integration/vitest.config.ts agg.int` — 1 file, 15 tests passed (Podman fixtures)
- `npx vitest run --config test/integration/vitest.config.ts query.int` — 1 file, 35 tests passed

Full test suite:
- `npm run check` — Pass (backend 55 files / 3253 tests, renderer 71 files / 2014 tests)

Lint/type-check/build:
- `npm run check` (eslint --max-warnings 0, prettier --check, tsc) — Pass

`.taskcheck`:
- Not run directly (running the script needed interactive approval). It runs `npm run check`, which passed.

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.

# Test Report

Date: 2026-11-17

Task: schema-analysis — M3: Schema analysis

Scope: task commits `1d5097e9b7d64df151d86dd329c77c0217096422..1ed51146493086c8acfc57ae453f4a9e012186f5`
(dedd1b8b backend + integration test, 0445fb2f renderer panel and collection-view wiring, 1ed51146 e2e
test), on branch `main`, `tasks/` changes excluded. Uncommitted inputs at measurement time: only the test
files listed below (plus `docs/ARCHITECTURE.md` and `reviews/schema-analysis/review.md`, changed by other
helpers/the parent, not by the test-writer and not production code).

Requirements:
- `tasks/schema-analysis.md` (goal, both acceptance criteria, the four recorded assumptions)
- `SPEC.md` M3 (sample default 1 000), `docs/ARCHITECTURE.md` "Coverage"
- contract doc comments in `packages/contract/src/schema.ts`
- parent instructions (unit tests for backend analyze/handlers, renderer model, SchemaPanel, collection-view wiring)

## Test files changed

- `packages/backend/src/schema/analyze.spec.ts` (new)
- `packages/renderer/src/app/schema-analysis/schema-analysis.model.spec.ts` (new)
- `packages/renderer/src/app/schema-analysis/schema-panel.spec.ts` (new)
- `packages/renderer/src/app/collection/collection-view.spec.ts` (new `describe('Schema (schema-analysis)')` block, 9 tests; nothing else changed)

## Tests added or updated

Count: 135 test cases (57 backend, 53 model, 16 panel, 9 collection-view; `it.each` rows counted individually)

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: integration test on a fixture with mixed types per field gives the expected shares | `test/integration/schema.int.spec.ts` (existing, 5 tests) | `npx vitest run --config test/integration/vitest.config.ts test/integration/schema.int.spec.ts` | Pass (5/5) |
| AC1 (unit level): field share, missing ratio, type shares, int/double/long/decimal kept apart, shares sum to field share | `analyzeSample › gives each field its share, missing rest and type shares…`, `analyzeCollection › decodes raw batches without promotion` | `cd packages/backend && npx vitest run src/schema` | Pass |
| AC2: e2e: open analysis, click a value → query bar filter set | `test/e2e/schema-analysis.e2e.ts` (existing) | `npx playwright test test/e2e/schema-analysis.e2e.ts` (headless, on the renderer/desktop build already present from the parent's `npm run test:e2e`) | Pass (1/1) |
| AC2 (component level): Schema button analyzes the parsed filter, pick puts value / `$type` into the filter, same key replaced, `[]` segments dropped, unparseable filter replaced, focus on filter, query not run | collection-view `Schema (schema-analysis)` block (9 tests); `withFilterField` / `filterKeyOf` tests | `cd packages/renderer && npx ng test --include='src/app/collection/collection-view.spec.ts'` and `--include='src/app/schema-analysis/schema-analysis.model.spec.ts'` | Pass |
| Sample default 1 000, `$match` before `$sample`, custom size, maxTimeMS, invalid filter → INVALID_PARAMS | `sampleCommand` tests, `analyzeCollection › an invalid filter…` | `cd packages/backend && npx vitest run src/schema` | Pass |
| Nested paths relative to parent; array items `a.[]` share 1; docs in arrays `a.[].b`; empty arrays | `analyzeSample › nested fields…`, `› array items…`, `› empty arrays…`, `› every share stays within 0..1` | same | Pass |
| Examples: canonical EJSON, distinct, ≤5 per type, strings ≤200 chars; DBRef+Document merged | `analyzeSample › keeps examples…`, `› cuts long example strings…`, `flattenSchema` tests | same | Pass |
| Cancel kills the sampling operation; NOT_CONNECTED without a connection | `analyzeCollection › abort during sampling…`, `› a signal aborted before…`, `schemaHandlers` tests | same | Pass |
| Panel states: loading, ok, empty, error + retry, CANCELLED silent; pick emits; stale answers ignored; params change / null / destroy cancel | `SchemaPanel` (16 tests) | `cd packages/renderer && npx ng test --include='src/app/schema-analysis/schema-panel.spec.ts'` | Pass |
| Tab pointed at another collection closes the panel and cancels the analysis | collection-view `pointing the tab at another collection…` | `cd packages/renderer && npx ng test --include='src/app/collection/collection-view.spec.ts'` | Pass |

## Focused test execution

Command:

`cd packages/backend && npx vitest run src/schema/analyze.spec.ts`;
`cd packages/renderer && npx ng test --include='src/app/schema-analysis/schema-analysis.model.spec.ts'`;
`cd packages/renderer && npx ng test --include='src/app/schema-analysis/schema-panel.spec.ts'`;
`cd packages/renderer && npx ng test --include='src/app/collection/collection-view.spec.ts'`

Result:

Pass (57, 53, 16 and 99 tests). One backend expectation was initially wrong (sibling path order: `mongodb-schema` orders sibling fields alphabetically) and was corrected in the test; this is not a defect (the contract only promises depth-first order).

## Full test execution

Command:

`npm run check` (repository root: eslint, prettier, typecheck of all workspaces, `vitest run`, `ng test`);
`npx vitest run --config test/integration/vitest.config.ts test/integration/schema.int.spec.ts`;
`npx playwright test test/e2e/schema-analysis.e2e.ts`

Result:

Pass: root vitest 77 files / 4189 tests, renderer 100 files / 3300 tests; integration 5/5; e2e 1/1.

## .taskcheck

Result:

Pass (`.taskcheck` runs `npm run check`; run directly as `npm run check`, see above).

## Bugs found

None.

## Coverage

Status: verified

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured as a provider metric. Manual spot check of the lcov `DA` records of
`collection-view.ts` (the only pre-existing renderer file changed): every executable added line
(189, 340, 364, 454–476) has hits > 0, and no uncovered `BRDA` falls in the added ranges. The other
renderer and backend schema files are new, so their whole-file numbers equal changed-line numbers.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `schema-analysis`, base `1d5097e9b7d64df151d86dd329c77c0217096422` (from the parent), HEAD `1ed51146493086c8acfc57ae453f4a9e012186f5`; commits from `git log 1d5097e9..HEAD` (dedd1b8b, 0445fb2f, 1ed51146), confirmed against the task's `touches` and acceptance criteria.
- Source/test snapshot identifier (including uncommitted inputs): production code = HEAD (no uncommitted production changes). Test files sha256: `analyze.spec.ts` c003f56c…e46d, `schema-analysis.model.spec.ts` 5eaaf637…035b8, `schema-panel.spec.ts` 22992367…a347, `collection-view.spec.ts` 89b815e1…4344.
- Exact included files; renamed/deleted/excluded files and reasons: included `packages/backend/src/schema/analyze.ts`, `handlers.ts`, `index.ts`, `packages/backend/src/server/backend.ts`, `packages/renderer/src/app/schema-analysis/schema-analysis.model.ts`, `schema-panel.ts`, `index.ts`, `packages/renderer/src/app/collection/collection-view.ts`. Excluded: `packages/backend/src/index.ts` (one re-export line), `packages/contract/src/schema.ts` (doc comments only), `collection-view.html` and `schema-panel.css` (template/style, no v8 counters; template behavior covered by the component tests), `package.json`/`package-lock.json` (dependency manifest), `test/**` (tests). No renames or deletions.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 + `@vitest/coverage-v8`, Node 24.22.1. Backend, in `packages/backend`: `npx vitest run src/schema src/server/backend.spec.ts --coverage --coverage.include='src/schema/analyze.ts' --coverage.include='src/schema/handlers.ts' --coverage.include='src/schema/index.ts' --coverage.include='src/server/backend.ts' --coverage.reportsDirectory=coverage/schema-analysis-tw3`. Renderer, in `packages/renderer`: `npx ng test --coverage --coverage-include='src/app/schema-analysis/schema-analysis.model.ts' --coverage-include='src/app/schema-analysis/schema-panel.ts' --coverage-include='src/app/schema-analysis/index.ts' --coverage-include='src/app/collection/collection-view.ts' --include='src/app/schema-analysis/**/*.spec.ts' --include='src/app/collection/collection-view.spec.ts'`.
- Run start/completion time and exit status: backend final run 2026-11-17 ~05:51:50 +0100, exit 0 (105 tests passed); renderer run 2026-11-17 05:49:04–05:49:24 +0100, exit 0 (168 tests passed).
- Generated report paths and report hashes/run identifier: `packages/backend/coverage/schema-analysis-tw3/coverage-summary.json` sha256 e5d45d13…4bab, `lcov.info` 3eb558bd…b986; `packages/renderer/coverage/renderer/coverage-summary.json` sha256 2d57310e…84cb8, `lcov.info` a01c5596…8284 (directory recreated by the run at 05:49:04).
- Evidence outputs are fresh and inputs stayed unchanged: backend reports written to a new directory by this run; renderer output directory recreated by the run. The backend run was repeated after `prettier --write` reformatted `analyze.spec.ts` (identical counters and hashes to the pre-format run); the renderer specs were unchanged by Prettier, so the renderer run covers the final snapshot.
- Final run after latest test additions and production fixes: yes (no production fixes were made).

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/schema/analyze.ts` | 84/84 (100%) | 38/38 (100%) | 15/15 (100%) | 73/73 (100%) |
| `packages/backend/src/schema/handlers.ts` | 2/2 (100%) | N/A (0/0) | 2/2 (100%) | 2/2 (100%) |
| `packages/backend/src/schema/index.ts` | N/A (0/0) | N/A (0/0) | N/A (0/0) | N/A (0/0) |
| `packages/backend/src/server/backend.ts` | 54/62 (87.1%) | 16/18 (88.9%) | 16/23 (69.6%) | 51/57 (89.5%) |
| `packages/renderer/src/app/schema-analysis/schema-analysis.model.ts` | 32/32 (100%) | 17/18 (94.4%) | 14/14 (100%) | 29/29 (100%) |
| `packages/renderer/src/app/schema-analysis/schema-panel.ts` | 144/146 (98.6%) | 41/43 (95.3%) | 17/17 (100%) | 107/107 (100%) |
| `packages/renderer/src/app/schema-analysis/index.ts` | N/A (0/0) | N/A (0/0) | N/A (0/0) | N/A (0/0) |
| `packages/renderer/src/app/collection/collection-view.ts` | 270/300 (90.0%) | 140/176 (79.5%) | 80/86 (93.0%) | 234/251 (93.2%) |
| **Aggregate (summed counters, 8 files above)** | 586/626 (93.6%) | 252/293 (86.0%) | 144/157 (91.7%) | 496/519 (95.6%) |

Excluded from the aggregate (see above): `packages/backend/src/index.ts`, `packages/contract/src/schema.ts`, `collection-view.html`, `schema-panel.css`, `package.json`, `package-lock.json`. No scoped file is missing from the reports.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/backend/src/schema/analyze.ts:133,148,149` (`?? []` / `?? 0` fallbacks) | malformed `mongodb-schema` output | Covered after adding `flattenSchema › tolerates documents without fields and arrays without item types or totals`; now 38/38 branches |
| `packages/backend/src/server/backend.ts:70–86` and branches at 52, 121 | OIDC browser/token callbacks and shell logging: pre-existing code, not changed by this task | Not task behavior; the task's line (`...schemaHandlers(connections)`) is in an executed statement; registration is exercised end to end by the e2e test |
| `packages/renderer/src/app/schema-analysis/schema-analysis.model.ts:88` (`?? field.path`) | `split('.')` always yields at least one segment | Unreachable defensive fallback; no test |
| `packages/renderer/src/app/schema-analysis/schema-panel.ts:177` (`sampledText` non-ok branch) | template only reads it in the ok state | Unreachable through the template; no test |
| `packages/renderer/src/app/schema-analysis/schema-panel.ts:220` (`abort.signal.aborted` after a successful answer) | a cancelled request's late success must not replace the state | The `ApiService` rejects a cancelled request at once, so this guard is defensive; the observable behavior (late answer ignored) is covered by `new params cancel the running request; its late answer does not replace the newer one` |
| `packages/renderer/src/app/collection/collection-view.ts` 329–334, 487–608 | pre-existing raw toggle, explorer edit/insert/delete handling | Outside the task's changed lines; all task lines (189, 340, 364, 452–478) are hit |

## Unable to test

- The e2e run used the renderer/desktop build already present from the parent's earlier `npm run test:e2e`; the test-writer did not rebuild. Production code has not changed since HEAD, so the build matches, but the parent should rebuild if production code changes. No xvfb: Playwright ran headless.
- Visual styling of the panel (`schema-panel.css`, type colors actually rendered) is not asserted; `typeColor` mapping to the defined `--bson-*` tokens is unit-tested.

## Summary

Tests added and all validation passed. Tests and task-scoped coverage are sufficient; no production defects found.

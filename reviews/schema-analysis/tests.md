# Test Report

Date: 2026-11-17

Task: schema-analysis — M3: Schema analysis (test-writer round 2, final code)

Scope: task commits `f733a77819cd805195c7dc4eb3b5677cfdd6a941..921fe01f5c48d96659f951cbf63433deca42d7bf`
on branch `main` (121c52a0 backend + integration test, dca190ba renderer panel, b3bb08c2 e2e, 2d7dbca4
unit tests, e471003b fixes CR-1/CR-4/CR-5, 921fe01f extra example-cut tests); `tasks/` and `reviews/`
excluded. The only uncommitted input is this round's test addition in
`packages/backend/src/schema/analyze.spec.ts` (no uncommitted production code). This report replaces the
round-1 report, which described the pre-fix revision (old HEAD 1ed51146, examples cut at 200 chars,
`mongodb-schema`, `aria-pressed` on the Schema button); those numbers are stale and are not reused.

Requirements:
- `tasks/schema-analysis.md` (goal, both acceptance criteria, all seven recorded assumptions, in
  particular the 06:02 corrections: examples are full values only, limit 1000, cut examples dropped;
  `@mongodb-js/mongodb-schema`; collation ignored)
- `SPEC.md` M3 (sample default 1 000), `docs/ARCHITECTURE.md` "Schema analysis" and "Coverage"
- contract doc comments in `packages/contract/src/schema.ts`
- `reviews/schema-analysis/review.md` (round 2) and `fixes.md` (CR-1, CR-4, CR-5)
- parent instructions for round 2 (isCut thresholds for string/binary/code, `aria-pressed` removal)

## Test files changed

- `packages/backend/src/schema/analyze.spec.ts` (one test added in this round)

## Tests added or updated

Count: 1 (`analyzeSample › leaves out code cut one character short to avoid splitting a surrogate pair`)

Why only one: the fix and 921fe01f already cover the final code. Each `isCut` threshold was checked
against the installed analyzer (`node_modules/@mongodb-js/mongodb-schema/dist/schema-analyzer.js`,
`cropString`/`getCappedValue`): strings are cut to `limit` or `limit - 1` (surrogate pair); binaries only
when longer than `limit`, to exactly `limit`; Code when `code.length >= limit`, to `limit` or `limit - 1`;
CodeWScope and other types are never cut. Existing tests cover string 5000 / limit / limit - 1 /
surrogate cut (dropped) and limit - 2 (kept); binary over the limit and at the limit (dropped) and
limit - 1 (kept); Code 5000 and 1200 (dropped), limit - 1 (dropped), limit - 2 (kept); long CodeWScope
(kept); cut values not taking example slots; and a long value read from the server. The one missing
case was an actual surrogate-pair cut of Code (the code path that produces a `limit - 1` result, the
reason for the `>= limit - 1` threshold); it is added now. The `aria-pressed` removal (CR-5) is
asserted in `collection-view.spec.ts` (`hasAttribute('aria-pressed')` false before and after opening
the panel); nothing to add.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: integration test on a fixture with mixed types per field gives the expected shares | `test/integration/schema.int.spec.ts` (5 tests) | `npx vitest run --config test/integration/vitest.config.ts test/integration/schema.int.spec.ts` (repo root, MongoDB container) | Pass (5/5) |
| AC1 (unit level): field share, missing ratio, type shares, int/double/long/decimal kept apart, type shares sum to field share | `analyzeSample › gives each field its share…`, `analyzeCollection › decodes raw batches without promotion` | `cd packages/backend && npx vitest run src/schema` | Pass (63/63) |
| AC2: e2e: open analysis, click a value → query bar filter set | `test/e2e/schema-analysis.e2e.ts` | Not run in this round: the parent runs the e2e suite on the final build (per instructions) | Not run: delegated to the parent |
| AC2 (component level): Schema button analyzes the parsed filter, pick puts value / `$type` into the filter, same key replaced, array segments dropped, unparseable filter replaced, filter focused, query not run; no `aria-pressed` | collection-view `Schema (schema-analysis)` block (9 tests); `withFilterField` / `filterKeyOf` tests | `cd packages/renderer && npx ng test --include='src/app/schema-analysis/**/*.spec.ts' --include='src/app/collection/collection-view.spec.ts'` | Pass (168/168) |
| CR-1 fix: no example that may have been cut (strings and Code at or above limit - 1, Binary at or above limit); full values just below kept; CodeWScope kept; cut values take no example slot; counts unchanged | `keeps no example that may have been cut…`, `keeps no binary or code example that may have been cut`, `keeps binary and code values just below the cut thresholds in full`, `leaves out code cut one character short…` (new), `keeps long code with scope…`, `values left out as cut take no example slot…`, `analyzeCollection › a long value read from the server…` | `cd packages/backend && npx vitest run src/schema` | Pass |
| Sample default 1 000, `$match` before `$sample`, custom size, maxTimeMS, invalid filter → INVALID_PARAMS | `sampleCommand` tests, `analyzeCollection › an invalid filter…` | same | Pass |
| Nested paths relative to the parent; array items share 1; documents in arrays; empty arrays | `analyzeSample › nested fields…`, `› array items…`, `› empty arrays…`, `› every share stays within 0..1` | same | Pass |
| Examples canonical EJSON, distinct, at most 5 per type; DBRef and Document merged | `analyzeSample › keeps examples…`, `flattenSchema` tests | same | Pass |
| Cancel kills the sampling operation; NOT_CONNECTED without a connection | `analyzeCollection › abort during sampling…`, `› a signal aborted before…`, `schemaHandlers` tests | same | Pass |
| Panel states: loading, ok, empty, error + retry, CANCELLED silent; pick emits; stale answers ignored; params change / null / destroy cancel | `SchemaPanel` (16 tests) | renderer command above | Pass |
| Tab pointed at another collection closes the panel and cancels the analysis | collection-view `pointing the tab at another collection…` | renderer command above | Pass |

## Focused test execution

Command:

`cd packages/backend && npx vitest run src/schema` (before the addition: 62 passed);
`cd packages/backend && npx vitest run src/schema src/server/backend.spec.ts --coverage …` (after: 111 passed, 63 of them in `analyze.spec.ts`);
`cd packages/renderer && npx ng test --coverage … --include='src/app/schema-analysis/**/*.spec.ts' --include='src/app/collection/collection-view.spec.ts'`;
`npx vitest run --config test/integration/vitest.config.ts test/integration/schema.int.spec.ts`

Result:

Pass (backend 111/111, renderer 168/168, integration 5/5). `npx prettier --check src/schema/analyze.spec.ts`: clean.

## Full test execution

Command:

`npm run check` (repository root: lint, Prettier, typecheck of all workspaces, root `vitest run`, renderer `ng test`), 2026-11-17 06:08:48–06:10:22 +0100

Result:

Pass: root vitest 80 files / 4360 tests, renderer 102 files / 3355 tests.

## .taskcheck

Result:

Pass (`.taskcheck` runs `npm run check`; run directly, see above).

## Bugs found

None. `isCut` matches the analyzer's cut rules for every type it cuts; it is conservative (a genuine
string or Code of exactly limit - 1 characters, or a genuine Binary of exactly limit bytes, is also left
out), which is documented in `analyze.ts` and `docs/ARCHITECTURE.md` and is not a defect.

## Unable to test

- AC2 e2e (`test/e2e/schema-analysis.e2e.ts`) was not run in this round; the parent runs it on the final
  build and records the evidence. The only renderer production change since the round-1 e2e pass is the
  removed `aria-pressed` attribute, which the e2e test does not reference.
- Visual styling of the panel (`schema-panel.css`) is not asserted; the `typeColor` mapping is unit-tested.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. One test added (Code
surrogate-pair cut); all focused, integration and full-check runs pass.

## Coverage

Status: verified (fresh run on the final code plus this round's test addition)

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not a provider metric; derived from the lcov `DA`/`BRDA` records. The backend
schema files and renderer schema-analysis files are new, so whole-file equals changed-line for them.
`collection-view.ts` added lines (from `git diff -U0 f733a778..HEAD`: 38–43 imports, 121, 193–194, 345,
369, 472–498): 16/16 executable lines with `DA` records hit, 6/6 branches in those ranges taken.
`backend.ts` added lines 15 (import) and 142 (`...schemaHandlers(connections)`, inside the statement
starting at line 132, hit 6 times).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `schema-analysis`, base `f733a77819cd805195c7dc4eb3b5677cfdd6a941` (from the parent), HEAD `921fe01f5c48d96659f951cbf63433deca42d7bf`; commits from `git log f733a778..HEAD` (6 commits, listed under Scope), matched against the task's `touches` and acceptance criteria.
- Source/test snapshot identifier (including uncommitted inputs): production code = HEAD (no uncommitted production changes; `git status` shows only `analyze.spec.ts` modified). Test file sha256: `packages/backend/src/schema/analyze.spec.ts` 10d865ba…0344 (uncommitted), `schema-analysis.model.spec.ts` 5eaaf637…35b8, `schema-panel.spec.ts` 22992367…a347, `collection-view.spec.ts` 0394193b…a5e, `test/integration/schema.int.spec.ts` 32904701…789.
- Exact included files; renamed/deleted/excluded files and reasons: included `packages/backend/src/schema/analyze.ts`, `handlers.ts`, `index.ts`, `packages/backend/src/server/backend.ts`, `packages/renderer/src/app/schema-analysis/schema-analysis.model.ts`, `schema-panel.ts`, `index.ts`, `packages/renderer/src/app/collection/collection-view.ts`. Excluded: `packages/backend/src/index.ts` (one re-export line), `packages/contract/src/schema.ts` (doc comments only), `collection-view.html` and `schema-panel.css` (template/style, no v8 counters; template behavior covered by component tests), `package.json`/`package-lock.json` (dependency manifest), `docs/ARCHITECTURE.md`, `test/**`. No renames or deletions.
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with v8 coverage (`@vitest/coverage-v8`), Node 24.22.1. Backend, in `packages/backend`: `npx vitest run src/schema src/server/backend.spec.ts --coverage --coverage.include='src/schema/analyze.ts' --coverage.include='src/schema/handlers.ts' --coverage.include='src/schema/index.ts' --coverage.include='src/server/backend.ts' --coverage.reportsDirectory=coverage/schema-analysis-tw4`. Renderer, in `packages/renderer`: `npx ng test --coverage --coverage-include='src/app/schema-analysis/schema-analysis.model.ts' --coverage-include='src/app/schema-analysis/schema-panel.ts' --coverage-include='src/app/schema-analysis/index.ts' --coverage-include='src/app/collection/collection-view.ts' --include='src/app/schema-analysis/**/*.spec.ts' --include='src/app/collection/collection-view.spec.ts'`.
- Run start/completion time and exit status: backend 2026-11-17 06:07:15–06:07:20 +0100, all 111 tests passed, report written; renderer 06:07:37–06:08:19 +0100, all 168 tests passed, report written.
- Generated report paths and report hashes/run identifier: `packages/backend/coverage/schema-analysis-tw4/coverage-summary.json` sha256 4d710998…d708e, `lcov.info` 22aad988…6d27; `packages/renderer/coverage/renderer/coverage-summary.json` sha256 de7a0332…e4f2, `lcov.info` 57298020…b43.
- Evidence outputs are fresh and inputs stayed unchanged: the backend report directory is new for this run (files timestamped 06:07:20); the renderer directory was rewritten by this run (06:08:19). No source or test file changed after the runs (the test addition was made and Prettier-checked before both runs).
- Final run after latest test additions and production fixes: yes (runs are after the fix commit e471003b, after 921fe01f and after this round's test addition).

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/schema/analyze.ts` | 94/94 (100%) | 52/52 (100%) | 16/16 (100%) | 82/82 (100%) |
| `packages/backend/src/schema/handlers.ts` | 2/2 (100%) | N/A (0/0) | 2/2 (100%) | 2/2 (100%) |
| `packages/backend/src/schema/index.ts` | N/A (0/0) | N/A (0/0) | N/A (0/0) | N/A (0/0) |
| `packages/backend/src/server/backend.ts` | 54/62 (87.1%) | 16/18 (88.9%) | 16/23 (69.6%) | 51/57 (89.5%) |
| `packages/renderer/src/app/schema-analysis/schema-analysis.model.ts` | 32/32 (100%) | 17/18 (94.4%) | 14/14 (100%) | 29/29 (100%) |
| `packages/renderer/src/app/schema-analysis/schema-panel.ts` | 144/146 (98.6%) | 41/43 (95.3%) | 17/17 (100%) | 107/107 (100%) |
| `packages/renderer/src/app/schema-analysis/index.ts` | N/A (0/0) | N/A (0/0) | N/A (0/0) | N/A (0/0) |
| `packages/renderer/src/app/collection/collection-view.ts` | 276/309 (89.3%) | 142/178 (79.8%) | 81/88 (92.0%) | 239/259 (92.3%) |
| **Aggregate (summed counters, 8 files above)** | 602/645 (93.3%) | 268/309 (86.7%) | 146/160 (91.3%) | 510/536 (95.1%) |

Excluded from the aggregate (see Evidence): `packages/backend/src/index.ts`, `packages/contract/src/schema.ts`, `collection-view.html`, `schema-panel.css`, `package.json`, `package-lock.json`. No scoped file is missing from the reports.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/backend/src/schema/analyze.ts` (none) | `isCut` thresholds for String, Binary, Code; CodeWScope pass-through; non-matching types | All 52 branches covered; added the Code surrogate-pair cut test so the `limit - 1` Code result is exercised directly |
| `packages/backend/src/server/backend.ts:70–86`, branches at 52 and 121 | OIDC browser/token callbacks and shell logging: pre-existing code, not changed by this task | Outside task scope; the task's line 142 is in an executed statement, and the handler registration is exercised end to end by the integration and e2e tests |
| `packages/renderer/src/app/schema-analysis/schema-analysis.model.ts:88` (`?? field.path`) | `split('.')` always yields at least one segment | Unreachable defensive fallback; no test |
| `packages/renderer/src/app/schema-analysis/schema-panel.ts:177` (`sampledText` non-ok branch) | the template reads it only in the ok state | Unreachable through the template; no test |
| `packages/renderer/src/app/schema-analysis/schema-panel.ts:220` (`abort.signal.aborted` after a successful answer) | a cancelled request's late success must not replace the state | Defensive (the ApiService rejects a cancelled request at once); the observable behavior is covered by `new params cancel the running request; its late answer does not replace the newer one` |
| `packages/renderer/src/app/collection/collection-view.ts` lines 334–339, 437–439, 536–547, 565–566 and branches outside 472–498 | pre-existing raw toggle, explorer edit/insert/delete handling | Outside the task's changed lines; every task-added executable line and branch is hit |

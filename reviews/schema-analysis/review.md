# Code Review

Date: 2026-11-17

Task: schema-analysis - M3: Schema analysis

Scope (round 2, current): the task's commits 82f57482, 9d140a4f, e206993f, 11724df3 and f0f755d0 on top of base 1d5097e9 (`git diff 1d5097e9..HEAD -- . ':!tasks' ':!reviews'`, narrowed to this task's files). The range also contains commits that other tasks merged into main (saved-pipelines, query-history, shell-open-close-race and others). Those were left out, except where they meet this task's code in `collection-view.{ts,html}`. The focus is on the fix commit f0f755d0, the `docs/ARCHITECTURE.md` "Schema analysis" section and the new unit specs. Only committed code was reviewed. Uncommitted test-file changes from the concurrent test-writer were ignored.

Requirements:
- tasks/schema-analysis.md acceptance criteria and recorded assumptions #1-#4
- SPEC.md M3 (schema analysis Must; "click a field type to build a filter" Could)
- docs/ARCHITECTURE.md (stack table, API conventions, Schema analysis section)
- AGENTS.md (evidence, no secrets)
- reviews/schema-analysis/fixes.md (fixer's claims, verified against the code)

Git range:
- Branch: main
- HEAD: f0f755d0a449ab58078f939062abfaa3949cb857
- Base/start: 1d5097e9b7d64df151d86dd329c77c0217096422
- Commits reviewed: 5 task commits (82f57482, 9d140a4f, e206993f, 11724df3, f0f755d0)

Summary: 0 P0, 0 P1, 0 P2, 1 P3 (round 2; see "Round 1 findings, status" for the earlier ones)

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-6 | Task assumptions no longer match the code (example limit, library, collation)**
    - File: `tasks/schema-analysis.md:21` (assumption #4), compared with `packages/backend/src/schema/analyze.ts:33` and `:116`
    - Category: Quality
    - Problem: Assumption #4 still says "strings cut at 200 chars". The code now uses `EXAMPLE_LENGTH_LIMIT` = 1000 and drops any string, code or binary example that may have been cut. The task Goal names `mongodb-schema`, but the dependency is now `@mongodb-js/mongodb-schema` (the stack table in ARCHITECTURE has been updated). CR-3 (the bar's collation is ignored) was accepted as out of scope, but no assumption records that limitation.
    - Why it matters: Humans review decisions through `tasks.py assumptions`. As things stand, they would review an outdated behavior and would not see the library change or the collation limitation.
    - Suggested fix: The parent worker should record new assumptions with `python tasks.py assume schema-analysis "..."`: examples that may have been cut at 1000 are dropped, not shortened; the dependency is `@mongodb-js/mongodb-schema` because the old package is deprecated; collation is not passed to `schema.analyze`. This review does not change task state.

## Round 2 verification of round-1 fixes

- **CR-1 (cut examples), fixed.** I checked `isCut` (`analyze.ts:84-97`) against the installed analyzer (`node_modules/@mongodb-js/mongodb-schema/dist/schema-analyzer.js:131-155`):
    - `cropString` returns `slice(0, limit)` or, when the cut would split a surrogate pair, `slice(0, limit - 1)`. A string shorter than `limit - 1` is never changed. Dropping strings of length `>= limit - 1` therefore removes every cut string. It also drops a few genuine ones, which is conservative and documented.
    - Binary is cut only when `buffer.length > limit`, and the result is exactly `limit` long, so `>= limit` is exact. Code is cut when `code.length >= limit`, to `limit` or `limit - 1`, so `>= limit - 1` covers it.
    - `CodeWScope` and all other types are passed through unchanged by `getCappedValue`.
    - The `_bsontype` check is sound. The lock file has a single hoisted `bson@7.3.4` and no nested copy under the package.
    - Type counts are unchanged; only the example lists lose values.
    - The regression tests at `analyze.spec.ts:232-272` cover 5000 characters, exactly the limit, `limit - 1`, the surrogate-pair cut, Binary over and at the limit, and long Code. They also assert that each remaining example equals a source value.
    - The ARCHITECTURE section describes this behavior correctly.
- **CR-2 (unit tests), resolved by 11724df3.** The new specs cover everything round 1 asked for:
    - `schema-analysis.model.spec.ts`: `withFilterField` (replace in place, unparseable filter, blank or `{}` filter, dotted keys, int typing), `filterKeyOf`, `percent`, and `schemaRows` with malformed examples.
    - `schema-panel.spec.ts`: an older answer arriving late, an older failure after the newer answer, CANCELLED ignored, error then retry, null params or destroy cancelling the request.
    - `analyze.spec.ts`: alias merging, the 5-example cap, `a.[].b`, unpromoted decoding, cancellation and killing the server operation, and the handler errors.
    - `collection-view.spec.ts`: wiring, including a parse error clearing a stale panel.
    - The tests assert behavior through the DOM and the fake RPC, not through private state.
- **CR-3 (collation), not fixed.** Accepted by the parent as out of contract scope. That is reasonable for M3, but it is not recorded as an assumption (see CR-6).
- **CR-4 (deprecated dependency), fixed.**
    - `packages/backend/package.json` now depends on `@mongodb-js/mongodb-schema@^12.8.20`.
    - The lock entry is at `package-lock.json:4481`. The old `mongodb-schema`/`mongodb-ns` entries are gone.
    - No source file imports `mongodb-schema` any more.
    - The API used (`parseSchema`, `Schema`, `SchemaType`, the options including `signal`) is unchanged.
    - The optional CLI dependencies (`yargs`, `cli-table`, `js-yaml` and others) are still published upstream as optionalDependencies, as fixes.md says. This was not raised again.
    - The `devOptional` -> `dev` flips for root `argparse`/`js-yaml`/`color-*` in the lock are the expected result of removing the old package.
- **CR-5 (`aria-pressed`), fixed.** `collection-view.html:101-110` has no `aria-pressed`, and the spec asserts that the attribute is absent before and after opening the panel.

## Round 1 findings, status

- CR-1 (P2) Truncated examples become equality filters that match nothing: fixed (f0f755d0).
- CR-2 (P2) No unit tests for the new pure logic and the panel: fixed (11724df3).
- CR-3 (P3) The query bar's collation is ignored by the analysis: accepted as out of scope; record it as an assumption (CR-6).
- CR-4 (P3) Deprecated `mongodb-schema` dependency: fixed (f0f755d0).
- CR-5 (P3) `aria-pressed` on the Schema button: fixed (f0f755d0).

## Notes (not findings)

- The integration with query-history in `collection-view.ts`/`.html` merged cleanly:
    - the Schema button sits beside Explain;
    - `pickFilter` only edits the filter text and clears a stale filter error, without running a query, so it does not record history;
    - retargeting the tab closes the panel.
- `docs/ARCHITECTURE.md` "Schema analysis" is now committed (11724df3, updated in f0f755d0) and matches the code: the pipeline, unpromoted decoding, path and share rules, example rules, the renderer flow and the test locations.
- Evidence: `tasks.py verify` has not recorded either acceptance criterion yet. The parent must run the integration test (`test/integration/schema.int.spec.ts` against the MongoDB container) and the e2e test (`test/e2e/schema-analysis.e2e.ts` via Playwright/Electron) on the final code and record them. Since round 1 the only renderer change is the removed `aria-pressed`, which the e2e test does not reference. This review did not run the test suites.
- Raising the stored-value limit from 200 to 1000 increases memory per stored value. This is bounded by the sample size (default 1000 documents) and is negligible.

## Review conclusion

No material issues found. The P2 findings from round 1 (CR-1, CR-2) and the optional CR-4 and CR-5 have been fixed, and I checked the fixes against the code and the installed analyzer. The only open item is CR-6 (P3): outdated or missing task assumptions, which the parent worker records with `tasks.py assume`. The acceptance-criterion evidence (integration and e2e runs) still has to be recorded before `done`.

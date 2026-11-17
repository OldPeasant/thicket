# Code Review

Date: 2026-11-17

Task: schema-analysis - M3: Schema analysis

Scope: `git diff 1d5097e9..HEAD -- . ':!tasks'` (committed changes only): backend `packages/backend/src/schema/` and its wiring, contract `packages/contract/src/schema.ts`, renderer `packages/renderer/src/app/schema-analysis/` plus `collection-view.{ts,html}`, `test/integration/schema.int.spec.ts`, `test/e2e/schema-analysis.e2e.ts`, `package-lock.json` / `packages/backend/package.json`.

Requirements:
- tasks/schema-analysis.md acceptance criteria and recorded assumptions #1-#4
- SPEC.md M3 (schema analysis Must; "click a field type to build a filter" Could)
- docs/ARCHITECTURE.md (stack table, API conventions, Schema analysis section)
- AGENTS.md (evidence, no secrets)

Git range:
- Branch: main
- HEAD: 061dba5a64e9463ab0a2dae1f320c39f284d0093
- Base/start: 1d5097e9b7d64df151d86dd329c77c0217096422
- Commits reviewed: 3 code commits (343b22c6, 41c76712, 061dba5a) plus a heartbeat commit touching only `tasks/`. The commits were rebased over the heartbeat during review; `git range-diff` shows them identical to the original dedd1b8b/0445fb2f/1ed51146. An uncommitted change to `docs/ARCHITECTURE.md` (new "Schema analysis" section) was in the working tree; it is outside the committed scope and was only read for context.

Summary: 0 P0, 0 P1, 2 P2, 3 P3

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | Truncated examples become equality filters that match nothing**
    - File: `packages/backend/src/schema/analyze.ts:171` (with `packages/renderer/src/app/schema-analysis/schema-panel.ts:143`, `:205`)
    - Category: Correctness
    - Problem: `storedValuesLengthLimit: EXAMPLE_STRING_LIMIT` (200) makes `mongodb-schema` silently crop stored String values (`cropString`), Binary buffers and Code bodies (`getCappedValue` in `node_modules/mongodb-schema/lib/schema-analyzer.js:115-132`). These cropped values go into `examples` as if they were real values. The panel then offers them as "use as filter" chips, and `pickValue` emits `{ key: croppedValue }`. The tooltip (`ex.full`) shows the cropped text with no sign that it was cut.
    - Why it matters: SPEC M3 "use as filter for a value". For any string longer than 200 characters, or any Binary longer than 200 bytes, the chip builds a filter that matches no documents, and nothing tells the user why.
    - Suggested fix: Mark cropped examples in the backend, or drop them there. For example, compare against the original length, or skip values at or above the limit. The renderer should then show such examples without making them clickable, or build a `$regex` prefix filter for strings. Add a test for a long string.

- [ ] **CR-2 | No unit tests for the new pure logic and the panel**
    - File: `packages/renderer/src/app/schema-analysis/schema-analysis.model.ts:59-136`, `packages/renderer/src/app/schema-analysis/schema-panel.ts:216-235`, `packages/backend/src/schema/analyze.ts:60-160`, `packages/renderer/src/app/collection/collection-view.ts:452-477`
    - Category: Tests
    - Problem: The diff adds no `*.spec.ts`. Neighbouring features follow the convention of model and panel specs (`explain.model.spec.ts`, `explain-panel.spec.ts`). The following are covered only indirectly, by one happy-path integration test and one e2e test, or not at all:
      - `withFilterField`: replacing the same key in place, an unparseable filter being replaced, an empty filter;
      - `filterKeyOf` (`a.[].b` -> `a.b`);
      - `percent` rounding;
      - `schemaRows` with malformed `examples`;
      - `typeAlias` / `mergeTypes` (DBRef+Document merge, Long/Int64, dedupe, 5-example cap);
      - the depth-first ordering of `flattenSchema` for documents inside arrays (`a.[].b`);
      - the panel's cancel/out-of-order handling: a newer request aborts the older one; CANCELLED is ignored; the error state appears on failure; closing aborts;
      - `analyzeSchema` clearing a stale panel on a parse error.
    - Why it matters: Assumption #3 (merge semantics) and the cancellation contract are exactly the kind of behavior that regresses quietly. The e2e test does not cover the replace-same-key or unparseable-filter paths, or `a.[].b` paths.
    - Suggested fix: Add `schema-analysis.model.spec.ts`, `schema-panel.spec.ts` (with `provideFakeThicket`) and a backend `analyze.spec.ts` that runs `analyzeSample` on in-memory BSON documents. The test-writer covers this.

## P3 Low

- [ ] **CR-3 | The query bar's collation is ignored by the analysis**
    - File: `packages/renderer/src/app/collection/collection-view.ts:463`
    - Category: Correctness
    - Problem: `analyzeSchema` passes only `filter`. `docs.find` and Explain apply the bar's `collation`, but `schema.analyze` has no `collation` param. With a case-insensitive collation set, the sample can be drawn from a different set of documents than the ones the bar shows, while the button's title says it analyzes "the documents the filter matches".
    - Why it matters: This is a small edge case, but it gives a misleading result when it happens.
    - Suggested fix: Add an optional `collation` to the contract and pass it to the `aggregate` command. Otherwise, record the limitation as an assumption.

- [ ] **CR-4 | Dependency `mongodb-schema` is deprecated upstream and brings CLI-only optional deps**
    - File: `packages/backend/package.json:25`, `package-lock.json` (`node_modules/mongodb-schema`)
    - Category: Quality
    - Problem: The lock entry for `mongodb-schema@12.7.0` carries `"deprecated": "This package is not maintained anymore. Please use @mongodb-js/mongodb-schema instead"`. It also installs optional CLI dependencies (`yargs`, `cli-table`, `js-yaml`, `numeral`, `progress`, `stats-lite`) that the backend never uses and that may end up in the packaged app. ARCHITECTURE's stack table does name `mongodb-schema`, so the choice follows the docs.
    - Why it matters: The package gets no future fixes (for example, for new driver/BSON majors; its peer range today is `mongodb ^6.6.1 || ^7.0.0`), and the app bundle grows.
    - Suggested fix: Consider `@mongodb-js/mongodb-schema` (the same API), or record an assumption and a follow-up. Either way, update the stack table if the dependency changes.

- [ ] **CR-5 | `aria-pressed` on the Schema button does not match its behavior**
    - File: `packages/renderer/src/app/collection/collection-view.html:106`
    - Category: Quality (accessibility)
    - Problem: The button reports `aria-pressed="true"` while the panel is open, which tells screen readers it is a toggle. Activating it again re-runs the analysis instead of closing the panel. The other `aria-pressed` buttons in this view (Export/Import/Bulk, view modes) are real toggles or selections.
    - Why it matters: Assistive-technology users are told that pressing it again will close the panel, and it won't.
    - Suggested fix: Either drop `aria-pressed` (use `aria-expanded` with `aria-controls` on the panel instead), or make a second press close the panel and keep "Analyze again" inside the panel.

## Notes (not findings)

- Acceptance criteria: the integration test, a 100-document fixture with string/int/double/long/decimal/null/missing at `value`, nested documents and mixed arrays, asserts the exact shares, missing ratio, filter-before-sample, sample size, empty collection and INVALID_PARAMS. The e2e test opens the analysis, clicks a value and a type, and asserts the query bar's filter text, focus and the filtered run. Both criteria are covered by the tests in the diff. No evidence is recorded yet (`tasks.py verify schema-analysis` shows both unchecked), and this review did not run the integration or e2e suites.
- Checked and found sound:
    - Cancellation: the backend runs `Operation` with `comment`/kill plus `abortable`, and passes the signal into `parseSchema`. The renderer aborts the previous request on new params, close or destroy, and ignores late or cancelled results; every path leaves the loading state.
    - The cursor is closed in `finally`.
    - No `eval` or `innerHTML`: values go through `parseEJson`/`printShellSyntax`, and the template uses text interpolation only. Style bindings go through Angular, so they are CSP-safe.
    - Contract doc comments match the flattening (relative shares, `a.[]` = 1).
    - Unpromoted decoding keeps int/long/double/decimal apart (asserted in the integration test).
    - Accessibility: the bar has `role="img"` with an `aria-label`, chips are real buttons with titles and `:focus-visible` outlines, the status and alert roles are set, and the table uses `scope` headers.
- The `docs/ARCHITECTURE.md` "Schema analysis" section is uncommitted at review time. The parent should commit it with the task.

## Review conclusion

Material issues found; fix before completing the task. There are no blocking (P0/P1) issues. CR-1 (cropped examples used as filters) and CR-2 (missing unit tests) should be fixed. CR-3 to CR-5 are optional.

---
title: M3: Schema analysis
status: in_progress
owner: felix/agent-2
deps: [docs-query-backend,collection-view]
touches: [packages/backend/src/schema,packages/renderer/src/app/schema-analysis]
prio: 2
lease_until: 2026-11-17T05:35:25Z
---
## Goal
Sample-based (default 1 000) analysis with mongodb-schema: fields, types and shares, missing ratio, examples; shown in the table view; click a value to use it as a filter.

## Acceptance criteria
- [x] Integration test on a fixture with mixed types per field gives the expected shares
  - verified (2026-11-17 06:12+0100 by felix/agent-2): npx vitest run --config test/integration/vitest.config.ts test/integration/schema.int.spec.ts (MongoDB container fixture, 100 docs with string/int/double/long/decimal/null/missing per field) at 738dbc16 -> 5 passed, exact type shares and missing ratio asserted
- [x] e2e: open analysis, click a value → query bar filter set
  - verified (2026-11-17 06:12+0100 by felix/agent-2): npm run build -w packages/renderer && npm run build -w apps/desktop && npx playwright test test/e2e/schema-analysis.e2e.ts (Electron app against MongoDB container) at 738dbc16 -> 1 passed (open Schema panel, click value chip and type chip -> query bar filter text set)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 05:42+0100 by felix/agent-2): Analysis is shown in its own table (one row per path: present %, type-share bar, clickable type and example chips) styled like the explorer, not inside the explorer component itself: the explorer has no per-value click hooks for 'use as filter'.
- ASSUMPTION (2026-11-17 05:42+0100 by felix/agent-2): Shares of nested paths are relative to the parent (a.b: share of a-documents; a.[]: share of all array items), like mongodb-schema/Compass; contract doc comments updated accordingly. Missing (Undefined) is not listed as a type: missing ratio = 1 - probability.
- ASSUMPTION (2026-11-17 05:42+0100 by felix/agent-2): Clicking a value or type merges { path: value } / { path: { $type } } into the current filter text (replacing the same key, replacing an unparseable filter) and focuses the filter field; it does not run the query. Array item segments ([]) are dropped from the filter key.
- ASSUMPTION (2026-11-17 05:42+0100 by felix/agent-2): Schema button sits next to Explain in the query bar and analyzes the bar's current filter; sample uses $match then $sample (default 1000), up to 5 distinct examples per type, strings cut at 200 chars.
- ASSUMPTION (2026-11-17 06:02+0100 by felix/agent-2): Correction to the earlier sample assumption: examples are full values only; the library limit is 1000 chars/bytes and any example that may have been cut is dropped, so no example builds a filter that cannot match (review CR-1/CR-6).
- ASSUMPTION (2026-11-17 06:02+0100 by felix/agent-2): Uses @mongodb-js/mongodb-schema (maintained successor of the deprecated mongodb-schema named in ARCHITECTURE.md; same API).
- ASSUMPTION (2026-11-17 06:02+0100 by felix/agent-2): Schema analysis ignores the query bar's collation: schema.analyze has no collation param in the contract (review CR-3, accepted).

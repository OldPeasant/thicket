---
title: M3: Schema analysis
status: in_progress
owner: felix/agent-2
deps: [docs-query-backend,collection-view]
touches: [packages/backend/src/schema,packages/renderer/src/app/schema-analysis]
prio: 2
lease_until: 2026-11-17T05:03:38Z
---
## Goal
Sample-based (default 1 000) analysis with mongodb-schema: fields, types and shares, missing ratio, examples; shown in the table view; click a value to use it as a filter.

## Acceptance criteria
- [ ] Integration test on a fixture with mixed types per field gives the expected shares
- [ ] e2e: open analysis, click a value → query bar filter set

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 05:42+0100 by felix/agent-2): Analysis is shown in its own table (one row per path: present %, type-share bar, clickable type and example chips) styled like the explorer, not inside the explorer component itself: the explorer has no per-value click hooks for 'use as filter'.
- ASSUMPTION (2026-11-17 05:42+0100 by felix/agent-2): Shares of nested paths are relative to the parent (a.b: share of a-documents; a.[]: share of all array items), like mongodb-schema/Compass; contract doc comments updated accordingly. Missing (Undefined) is not listed as a type: missing ratio = 1 - probability.
- ASSUMPTION (2026-11-17 05:42+0100 by felix/agent-2): Clicking a value or type merges { path: value } / { path: { $type } } into the current filter text (replacing the same key, replacing an unparseable filter) and focuses the filter field; it does not run the query. Array item segments ([]) are dropped from the filter key.
- ASSUMPTION (2026-11-17 05:42+0100 by felix/agent-2): Schema button sits next to Explain in the query bar and analyzes the bar's current filter; sample uses $match then $sample (default 1000), up to 5 distinct examples per type, strings cut at 200 chars.

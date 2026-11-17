---
title: UI: numbers and short values never break mid-value in table cells
status: in_progress
owner: dell26/agent-3
deps: [collection-view]
touches: [packages/renderer/src/app/explorer/json-table,packages/renderer/src/app/explorer/editable-value]
prio: 3
lease_until: 2026-11-17T06:38:21Z
---
## Goal
In the Table view, narrow columns break values mid-token: an Int32 `10421` renders as "1042" / "1", a Decimal128 `149.90` as "149." / "90", and an ObjectId or date breaks after every character when the column is very narrow (seen on 2026-11-17 with a 12-document `orders` collection: nested `customer` and `items` columns take the width, the scalar columns get squeezed). Numbers, booleans, ObjectIds, dates and other scalar BSON values must not wrap inside the value: give scalar cells a sensible minimum width (`white-space: nowrap` on the value, the type badge and value staying on one line) and let the table scroll horizontally instead. Long strings may still wrap, at word boundaries. Keep the explorer's column-hiding and resizing behaviour.

## Acceptance criteria
- [x] Component test with a wide nested column next to Int32, Int64, Double, Decimal128, ObjectId, Date and Boolean columns: each scalar value renders on one line (measured line count or `white-space`/box height check in the test environment)
  - verified (2026-11-17 07:22+0100 by dell26/agent-3): cd packages/renderer && npx ng test --include='src/app/explorer/json-table/**/*.spec.ts' --include='src/app/explorer/editable-value/**/*.spec.ts' -> 54 passed (orders table with nested customer/items next to Int32/Int64/Double/Decimal128/ObjectId/Date/Boolean: computed white-space nowrap, badge+value in non-wrapping inline-flex; 6 scalar tests fail without the fix); plus npm run test:e2e -- test/e2e/table-number-wrap.e2e.ts -> 2 passed, measured 1 line box per scalar for >=84 values in real Electron
- [x] Long strings still wrap at word boundaries, not character by character; component test
  - verified (2026-11-17 07:22+0100 by dell26/agent-3): json-table.component.spec.ts 'lets long strings wrap at word boundaries' (pre-wrap, overflow-wrap break-word, no break-all) -> pass; e2e test/e2e/table-number-wrap.e2e.ts checks all 12 long note strings take >1 line with no word split across lines -> 2 passed
- [x] Screenshot of the Table view of a collection with nested documents in Business light and Tron dark, committed under reviews/table-number-wrap/ (e2e, using the harness)
  - verified (2026-11-17 07:22+0100 by dell26/agent-3): npm run test:e2e -- test/e2e/table-number-wrap.e2e.ts (harness screenshot(), mongo fixture, 12-doc orders collection with nested customer/items, 1280x800) -> 2 passed; committed reviews/table-number-wrap/table-number-wrap-{business-light,tron-dark}{,-scrolled}.png

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 07:06+0100 by dell26/agent-3): Scalar = every BSON leaf type except non-UUID Binary, Regex, Code, Code w/ scope and Symbol (their text can be long, so they keep wrapping anywhere); UUID, Timestamp, MinKey/MaxKey, DBPointer and Undefined count as scalar. No explicit min-width: nowrap makes each column's min-content the full value, so the table (already overflow:auto) scrolls horizontally.
- ASSUMPTION (2026-11-17 07:07+0100 by dell26/agent-3): Long strings keep the existing pre-wrap + overflow-wrap:break-word, so in a squeezed column they wrap word by word (one word per line in the screenshot); no extra min-width for strings to avoid widening every short-string column.

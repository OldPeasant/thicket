---
title: UI: numbers and short values never break mid-value in table cells
status: todo
owner:
deps: [collection-view]
touches: [packages/renderer/src/app/explorer/json-table,packages/renderer/src/app/explorer/editable-value]
prio: 3
---
## Goal
In the Table view, narrow columns break values mid-token: an Int32 `10421` renders as "1042" / "1", a Decimal128 `149.90` as "149." / "90", and an ObjectId or date breaks after every character when the column is very narrow (seen on 2026-11-17 with a 12-document `orders` collection: nested `customer` and `items` columns take the width, the scalar columns get squeezed). Numbers, booleans, ObjectIds, dates and other scalar BSON values must not wrap inside the value: give scalar cells a sensible minimum width (`white-space: nowrap` on the value, the type badge and value staying on one line) and let the table scroll horizontally instead. Long strings may still wrap, at word boundaries. Keep the explorer's column-hiding and resizing behaviour.

## Acceptance criteria
- [ ] Component test with a wide nested column next to Int32, Int64, Double, Decimal128, ObjectId, Date and Boolean columns: each scalar value renders on one line (measured line count or `white-space`/box height check in the test environment)
- [ ] Long strings still wrap at word boundaries, not character by character; component test
- [ ] Screenshot of the Table view of a collection with nested documents in Business light and Tron dark, committed under reviews/table-number-wrap/ (e2e, using the harness)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.

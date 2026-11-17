---
title: docs.get sliceAbove skips arrays with all-digit field names (like docs.find)
status: todo
owner:
deps: [doc-paging]
touches: [packages/backend/src/docs/query]
prio: 2
---
## Goal
getDocument (docs.get with sliceAbove, packages/backend/src/docs/query/query.ts ~line 524) cuts top-level arrays whose field name is all digits (e.g. "2024"), but docs.getSlice rejects numeric paths. Since doc-paging, Save reads large documents back with sliceAbove, so such arrays become read-only and pages after the first fail with INVALID_PARAMS. docs.find (sliceLargeArrays) already skips them. Found as CR-7 in reviews/doc-paging/review.md.

## Acceptance criteria
- [ ] docs.get with sliceAbove leaves arrays with all-digit top-level names whole (same /^\d+$/ rule as sliceLargeArrays); unit test in query.spec.ts

## Notes

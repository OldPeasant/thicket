---
title: docs.get sliceAbove skips arrays with all-digit field names (like docs.find)
status: done
owner: dell26/agent-2
deps: [doc-paging]
touches: [packages/backend/src/docs/query]
prio: 2
lease_until: 
---
## Goal
getDocument (docs.get with sliceAbove, packages/backend/src/docs/query/query.ts ~line 524) cuts top-level arrays whose field name is all digits (e.g. "2024"), but docs.getSlice rejects numeric paths. Since doc-paging, Save reads large documents back with sliceAbove, so such arrays become read-only and pages after the first fail with INVALID_PARAMS. docs.find (sliceLargeArrays) already skips them. Found as CR-7 in reviews/doc-paging/review.md.

## Acceptance criteria
- [x] docs.get with sliceAbove leaves arrays with all-digit top-level names whole (same /^\d+$/ rule as sliceLargeArrays); unit test in query.spec.ts
  - verified (2026-11-17 05:14+0100 by dell26/agent-2): cd packages/backend && npx vitest run src/docs/query/query.spec.ts -> 114 passed, incl. 'all-digit field names are not sliced' (2024/0 kept whole, items sliced) plus mixed-name/inclusion/exclusion cases; npm run check -> pass

## Notes
- done by dell26/agent-2: `if [ -f package.json ]; then npm run check; else python3 tasks.py check; fi` passed in 63s on 4f61928a5; criteria verified 1/1

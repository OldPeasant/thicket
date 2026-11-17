---
title: M1: Paging inside documents
status: in_progress
owner: felix/agent-2
deps: [bson-inputs,docs-query-backend]
touches: [packages/renderer/src/app/explorer]
prio: 1
lease_until: 2026-11-17T01:37:56Z
---
## Goal
Replace Canopy's 'show more' with a pager for arrays/objects above N entries (setting, default 100); for documents above a size threshold, load array pages lazily through docs.getSlice.

## Acceptance criteria
- [ ] Component tests: pager on a 2 000-item array, jump to page, edits on page 7 preserved when paging away
- [ ] e2e: 50 000-item array document opens in < 2 s and pages via getSlice (network log shows slices)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 02:20+0100 by felix/agent-2): Large documents: docs.find gets a 'slice' param ({above: nestedPageSize, docBytes: 1 MiB}); the backend reads the whole document from MongoDB but sends the renderer only the first page of each top-level array longer than a page (listed in the batch's 'sliced'); other pages come via docs.getSlice ($slice on the server). Only top-level arrays are cut (same rule as docs.get). Threshold 1 MiB is a guess.

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

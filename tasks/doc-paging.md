---
title: M1: Paging inside documents
status: in_progress
owner: dell26/agent-3
deps: [bson-inputs,docs-query-backend]
touches: [packages/renderer/src/app/explorer]
prio: 1
lease_until: 2026-11-17T02:45:54Z
extended: 
releases: 1
---
## Goal
Replace Canopy's 'show more' with a pager for arrays/objects above N entries (setting, default 100); for documents above a size threshold, load array pages lazily through docs.getSlice.

## Acceptance criteria
- [x] Component tests: pager on a 2 000-item array, jump to page, edits on page 7 preserved when paging away
  - verified (2026-11-17 03:21+0100 by dell26/agent-3): cd packages/renderer && npx ng test --include src/app/explorer/doc-paging.spec.ts (HEAD 35aa821) -> 16 passed: 2000-item array pager, next/last/prev/first, jump to typed page, edit on page 7 kept when paging away and back
- [x] e2e: 50 000-item array document opens in < 2 s and pages via getSlice (network log shows slices)
  - verified (2026-11-17 03:21+0100 by dell26/agent-3): npm run build -w packages/renderer && npm run build -w apps/desktop && npx playwright test test/e2e/doc-paging.e2e.ts (built Electron app, mongo8 container fixture, headless) -> 1 passed: 50 000-item doc opened in 190 ms (<2 s), find sent only page 1, system.profile log shows $slice reads for pages 2, 400, 500
  - verified (2026-11-17 03:21+0100 by dell26/agent-3): npm run build -w packages/renderer && npm run build -w apps/desktop && npx playwright test test/e2e/doc-paging.e2e.ts (built Electron app, mongo8 container fixture, headless) -> 1 passed: 50 000-item doc opened in 190 ms (<2 s), find sent only page 1, system.profile log shows slice reads for pages 2, 400, 500

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 02:20+0100 by felix/agent-2): Large documents: docs.find gets a 'slice' param ({above: nestedPageSize, docBytes: 1 MiB}); the backend reads the whole document from MongoDB but sends the renderer only the first page of each top-level array longer than a page (listed in the batch's 'sliced'); other pages come via docs.getSlice ($slice on the server). Only top-level arrays are cut (same rule as docs.get). Threshold 1 MiB is a guess.
- ASSUMPTION (2026-11-17 02:20+0100 by felix/agent-2): Arrays loaded page-wise (large documents) are read-only in the explorer (other fields stay editable); the document counts as partial, so Save refuses edits that would replace a whole cut array. Editing inside such arrays needs a follow-up.
- ASSUMPTION (2026-11-17 02:20+0100 by felix/agent-2): Page state is per node instance (uid), so rows of a table page independently; the search does not filter inside a partly loaded array (it only sees loaded items). The pager replaces Canopy's show-more everywhere (table, form, JSON Lines list; lines keep 50 per page).
- extended by felix/agent-2: Implementation, test-writer, review (round 2) and fixes are committed; merged latest main, npm run check passes (2239 tests). Left: re-run AC1 component tests (doc-paging.spec.ts) and AC2 e2e (test/e2e/doc-paging.e2e.ts, mongo8 container), record both with tasks.py verify, write reviews/doc-paging/quality.json (reviewed_revision = current hash, findings CR-1..CR-7 dispositions; CR-7 -> follow-up task docs-get-numeric-slice), commit, tasks.py done.
- release by felix/agent-2: over budget after 2 sessions (~60 min) and a review that decided nothing; still resumable: continue from wip/doc-paging (see git log)

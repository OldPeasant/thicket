---
title: Conflict view for partly loaded (cut-array) documents
status: in_progress
owner: felix/agent-2
deps: [doc-paging,conflict-merge-close]
touches: [packages/renderer/src/app/document/conflict,packages/renderer/src/app/document/document-actions.service.ts]
prio: 2
lease_until: 2026-11-17T04:50:02Z
---
## Goal
Follow-up of doc-paging (reviews/doc-paging/tests.md TW-1, TW-2): when a save conflict hits a large
document whose top-level arrays were cut (docs.find `sliced`), the conflict view compares the cut local
array with the whole server document and blames a projection for the missing Overwrite/Merge.

## Acceptance criteria
- [x] The conflict diff of a document with cut arrays does not list never-loaded items as differences and does not render the whole server array (component test with a 300-item server array, 100 loaded)
  - verified (2026-11-17 05:30+0100 by felix/agent-2): cd packages/renderer && npx ng test --include src/app/collection/collection-view.spec.ts (+conflict-view.spec.ts, document-actions.service.spec.ts, document-editing.spec.ts) -> 296 passed; collection-view 'compares only the loaded items of the cut array, not the whole server array' (300-item server array, 100 loaded): server column shows SKU-000099 but not SKU-000100/SKU-000299, only the name line differs ('1 differing line'), cut note 'only the first 100 items are compared (the server has 300 items)'; conflict-view.spec covers dotted paths, appended/removed local items
- [x] The conflict note, the refused-resolve message and the re-insert refusal (document-actions.service.ts, "with a projection active") for a partly loaded document without a projection name the partial load, not a projection (same wording rule as Save's PARTIAL_REFUSED)
  - verified (2026-11-17 05:30+0100 by felix/agent-2): same run -> pass: collection-view 'names the partial load, not a projection, in the note and the refusals' (note and Overwrite/Merge refusals say 'loaded only partly ... long arrays are read page by page', no projection wording) and 'refuses to insert the cut document again when it was deleted' (Not inserted ... read page by page, no 'with a projection active', no docs.insert); document-actions.service.spec cut-array block asserts the same messages
- [ ] Keep server version whose read-back fails (fallback to the conflict's complete server version, reviews/doc-paging/review.md CR-8) shows that version as whole: no cut flags, arrays editable, pager lengths match the real arrays (adjust the collection-view test that asserts "still cut")

## Notes
See SPEC.md, docs/ARCHITECTURE.md "Paging inside documents", conflict-ui task.
- ASSUMPTION (2026-11-17 05:08+0100 by felix/agent-2): resolveBlocker returns the new 'partial' only for documents with cut arrays (stored on the SaveConflict at conflict time), even under a top-level projection; documents edited under a since-cleared projection keep the existing, more specific projection wording. Re-insert uses the partial wording when cut or when no projection is active.

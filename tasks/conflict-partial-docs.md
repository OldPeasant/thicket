---
title: Conflict view for partly loaded (cut-array) documents
status: todo
owner:
deps: [doc-paging,conflict-merge-close]
touches: [packages/renderer/src/app/document/conflict,packages/renderer/src/app/document/document-actions.service.ts]
prio: 2
---
## Goal
Follow-up of doc-paging (reviews/doc-paging/tests.md TW-1, TW-2): when a save conflict hits a large
document whose top-level arrays were cut (docs.find `sliced`), the conflict view compares the cut local
array with the whole server document and blames a projection for the missing Overwrite/Merge.

## Acceptance criteria
- [ ] The conflict diff of a document with cut arrays does not list never-loaded items as differences and does not render the whole server array (component test with a 300-item server array, 100 loaded)
- [ ] The conflict note, the refused-resolve message and the re-insert refusal (document-actions.service.ts, "with a projection active") for a partly loaded document without a projection name the partial load, not a projection (same wording rule as Save's PARTIAL_REFUSED)
- [ ] Keep server version whose read-back fails (fallback to the conflict's complete server version, reviews/doc-paging/review.md CR-8) shows that version as whole: no cut flags, arrays editable, pager lengths match the real arrays (adjust the collection-view test that asserts "still cut")

## Notes
See SPEC.md, docs/ARCHITECTURE.md "Paging inside documents", conflict-ui task.

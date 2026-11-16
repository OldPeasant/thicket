---
title: M1: Edit session and explicit save
status: in_progress
owner: felix/agent-1
deps: [collection-view,docs-write-backend,bson-inputs,safety-ui]
touches: [packages/renderer/src/app/document]
prio: 1
lease_until: 2026-11-17T00:02:44Z
---
## Goal
Edit session per document: modified marker and change count, undo/redo within unsaved edits, Revert, Save via diff-ops + docs.update through WriteGuard; insert (empty/copy), clone and delete.

## Acceptance criteria
- [x] Component tests: change count, undo/redo, revert
  - verified (2026-11-17 00:43+0100 by felix/agent-1): cd packages/renderer && npx ng test --include='src/app/document/**/*.spec.ts' --include='src/app/collection/**/*.spec.ts' -> 8 files, 218 passed (change count, undo/redo, revert in document-editing/edit-session/document-actions specs)
- [x] e2e: edit two fields and save; server document matches (verified by a driver query in the test)
  - verified (2026-11-17 00:43+0100 by felix/agent-1): npm run test:e2e -- test/e2e/document-edit.e2e.ts (Electron app + MongoDB container fixture) -> 'edit two fields and save: the server document matches' passed (MongoClient findOne asserts stored doc); 3 passed
- [ ] e2e: production profile shows the confirm dialog with the `$set` operation before saving
- [ ] Read-only profile: edit controls disabled (test)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 00:12+0100 by felix/agent-1): Undo/redo is one history per collection tab across its documents (Ctrl+Z/Ctrl+Shift+Z/Ctrl+Y outside text fields); Save/Revert of a document drops that document's steps from the history. Unsaved edits are keyed by _id and survive paging and new queries until saved or reverted.
- ASSUMPTION (2026-11-17 00:12+0100 by felix/agent-1): Change count = number of update operations Save would send (diff-ops ops; for a replace, the changed top-level fields). Diff bar Save saves every edited document, one docs.update each (production: one confirm dialog per document), stopping at the first failure.
- ASSUMPTION (2026-11-17 00:12+0100 by felix/agent-1): After Save the document is read back with docs.get (query projection) and patched into the shown page; after Delete it is removed from the page; inserted documents are not added to the page (message says to run the query again). Pager counts are not adjusted.
- ASSUMPTION (2026-11-17 00:12+0100 by felix/agent-1): Insert (empty) and insert-from-copy/Clone create drafts (new ObjectId _id) shown as forms above the results until Insert/Discard; Clone copies the document as shown (with unsaved edits, and only the projected fields when a projection is active). In the table view an added root row becomes a draft and a removed root row asks to delete that document; per-document Save/Revert/Clone/Delete buttons are in the Documents view.
- ASSUMPTION (2026-11-17 00:12+0100 by felix/agent-1): Delete always asks (alwaysConfirm) and sends docs.delete without expected values; a CONFLICT on save keeps the edits and shows a message plus a 'Changed on the server' marker with the server version kept in DocumentActions.conflicts for conflict-ui. Added the './diff' export to packages/core/package.json so the renderer can import diffDocuments.
- ASSUMPTION (2026-11-17 00:40+0100 by felix/agent-1): With a projection active, replacing a field that holds a sub-document/array by a scalar, or unsetting it, is still saved (hidden nested fields go with it): the user deliberately replaced/removed the whole field. Only container-over-container sets and whole-document replaces are refused.

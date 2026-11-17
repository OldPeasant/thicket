---
title: Close the conflict merge editor when its conflict disappears or changes state (CR-7 of conflict-ui)
status: in_progress
owner: felix/agent-2
deps: [conflict-ui]
touches: [packages/renderer/src/app/document/conflict]
prio: 2
lease_until: 2026-11-17T03:19:04Z
---
## Goal
The conflict view's merge editor (`conflict-view.ts`) stays open after its conflict is gone or no longer
"changed" (see `reviews/conflict-ui/review.md` round 2, CR-7): after a revert or edit-bar save it reopens
with stale text on the next conflict and hides Keep server / Overwrite; after Save merged hits a deleted
document, the editor stays and its Save does nothing silently.

## Acceptance criteria
- [x] The merge editor closes when its conflict is removed or its server version is no longer a document (deleted/unknown); component tests cover revert, edit-bar save and the deleted case
  - verified (2026-11-17 03:58+0100 by felix/agent-2): cd packages/renderer; npx ng test --include='src/app/document/**/*.spec.ts' -> 254 passed; CR-7 describe in document-editing.spec.ts covers revert (header), Revert all, edit-bar save, Save merged -> deleted, Save merged -> unknown, deleted->changed in place; these tests fail with the closing effect disabled
- [x] A later conflict on the same document opens with Keep server / Overwrite / Merge offered and fresh merge text (test)
  - verified (2026-11-17 03:58+0100 by felix/agent-2): same run (254 passed): revert / Revert all / edit-bar-save tests reconflict the same document and assert Keep server, Overwrite, Merge offered and fresh merge text (new total, no earlier qty: 77), no stale syntax error

## Notes

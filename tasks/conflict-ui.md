---
title: M1: Conflict resolution view
status: in_progress
owner: dell26/agent-2
deps: [doc-edit-save]
touches: [packages/renderer/src/app/document/conflict]
prio: 1
lease_until: 2026-11-17T01:28:41Z
---
## Goal
On CONFLICT show local vs server side by side with differences highlighted; actions overwrite (replace with conflict check on the new server version), keep server version, merge manually.

## Acceptance criteria
- [ ] e2e reproduces demo step 7: external change between load and save → conflict view appears
- [ ] Overwrite writes the local version; keep-server discards local edits; manual merge saves the merged doc (tests)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 02:05+0100 by dell26/agent-2): Overwrite = rebase the edits onto the server's current version and save the diff (server -> local) with the server's values as expected; result equals the local version (fields only the server has are unset) and a newer server change conflicts again. A document deleted on the server is inserted again (refused with a projection); merge is not offered for deleted documents.
- ASSUMPTION (2026-11-17 02:05+0100 by dell26/agent-2): Merge manually = a shell-syntax textarea prefilled with the local version, saved like Overwrite (must keep the _id); not a 3-way field picker. With a projection active, both sides and Overwrite/Merge consider only the top-level fields the user loaded/edited, so hidden fields are neither shown nor unset. The side-by-side diff is a line diff (LCS) of the shell-syntax pretty print; above 4M cells it pairs the differing middle without LCS.

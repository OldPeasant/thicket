---
title: Conflict view: one re-insert rule shared with DocumentActions
status: in_progress
owner: dell26/agent-2
deps: [conflict-partial-docs]
touches: [packages/renderer/src/app/document/conflict,packages/renderer/src/app/document/document-actions.service.ts]
prio: 3
lease_until: 2026-11-17T05:41:16Z
---
## Goal
Follow-up of conflict-partial-docs (reviews/conflict-partial-docs/review.md CR-4): the conflict view
hides "Insert your version again" only for a deleted cut document, while `DocumentActions.resolveWith`
refuses re-insert for any partial document (`partial || cut`). A document deleted on the server that is
partial only because of a projection still offers the button, and clicking it is always refused.

## Acceptance criteria
- [ ] The view and `DocumentActions` use one rule for whether a deleted document can be inserted again (e.g. `canReinsert(key)` or a `resolveBlocker` result for deleted documents); the rule lives in the service only
- [ ] A document deleted on the server that was loaded with a projection (active or since cleared) does not offer "Insert your version again" and shows a note saying why (component test)

## Notes
See conflict-partial-docs, SPEC.md "Conflict detection".
- ASSUMPTION (2026-11-17 06:23+0100 by dell26/agent-2): Added DocumentActions.reinsertBlocker(key) ('projection'|'partial'|null) instead of extending resolveBlocker, so resolveBlocker keeps its contract (null for deleted docs); the conflict view shows one generic 'loaded only partly' insert-again note for both blockers, wording 'data' instead of 'items' since it now covers projections too.

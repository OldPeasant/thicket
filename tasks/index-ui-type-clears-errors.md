---
title: Indexes form: changing a key type clears collation/wildcard projection errors (CR-6 of index-ui)
status: done
owner: dell26/agent-2
deps: [index-ui]
touches: [packages/renderer/src/app/indexes]
prio: 2
lease_until: 
---
## Goal
In `IndexCreateForm.setType` (packages/renderer/src/app/indexes/index-create-form.ts), also clear the
`collation` and `wildcardProjection` errors: since index-ui they depend on the key type, so after a
failed Create, switching a text/2d field to ascending leaves a stale message until the next Create
(reviews/index-ui/review.md CR-6, P3).

## Acceptance criteria
- [x] Component test: a collation error after Create with a text key disappears when the key type changes to ascending
  - verified (2026-11-17 05:20+0100 by dell26/agent-2): cd packages/renderer && npx ng test --include='src/app/indexes/index-create-form.spec.ts' -> 29 passed; tests 'clears a collation error after Create with a text key when the type changes to ascending' and the $** text variant fail without the setType fix (checked by stashing it: 1 failed)

## Notes
- done by dell26/agent-2: `if [ -f package.json ]; then npm run check; else python3 tasks.py check; fi` passed in 55s on d5a9dc972; criteria verified 1/1

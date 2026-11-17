---
title: Indexes form: changing a key type clears collation/wildcard projection errors (CR-6 of index-ui)
status: in_progress
owner: dell26/agent-2
deps: [index-ui]
touches: [packages/renderer/src/app/indexes]
prio: 2
lease_until: 2026-11-17T04:37:19Z
---
## Goal
In `IndexCreateForm.setType` (packages/renderer/src/app/indexes/index-create-form.ts), also clear the
`collation` and `wildcardProjection` errors: since index-ui they depend on the key type, so after a
failed Create, switching a text/2d field to ascending leaves a stale message until the next Create
(reviews/index-ui/review.md CR-6, P3).

## Acceptance criteria
- [ ] Component test: a collation error after Create with a text key disappears when the key type changes to ascending

## Notes

---
title: M1: Document writes with conflict detection
status: in_progress
owner: felix/agent-2
deps: [conn-manager,diff-ops]
touches: [packages/backend/src/docs/write]
prio: 1
lease_until: 2026-11-16T22:59:58Z
---
## Goal
docs.insert/update/replace/delete; update takes the diff and expected values and returns CONFLICT plus the current server document when nothing matched; updateMany/deleteMany with a `preview` step (count + sample) and an execute step; all through the write guard.

## Acceptance criteria
- [ ] Integration tests: update succeeds; concurrent change → CONFLICT with server doc; delete; insert returns _id
- [ ] updateMany/deleteMany preview count equals the affected count of the execute step (int test)
- [ ] Read-only and unconfirmed-production writes refused (int test)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.

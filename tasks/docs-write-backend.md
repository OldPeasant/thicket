---
title: M1: Document writes with conflict detection
status: in_progress
owner: felix/agent-2
deps: [conn-manager,diff-ops]
touches: [packages/backend/src/docs/write]
prio: 1
lease_until: 2026-11-16T23:16:36Z
---
## Goal
docs.insert/update/replace/delete; update takes the diff and expected values and returns CONFLICT plus the current server document when nothing matched; updateMany/deleteMany with a `preview` step (count + sample) and an execute step; all through the write guard.

## Acceptance criteria
- [x] Integration tests: update succeeds; concurrent change → CONFLICT with server doc; delete; insert returns _id
  - verified (2026-11-16 23:59+0100 by felix/agent-2): npx vitest run --config test/integration/vitest.config.ts docs-write (Podman, mongo 8.x replica set fixture, handlers behind guardWrites + contract validation) -> 20 passed; covers update ok, concurrent change -> CONFLICT with current server doc (and null when deleted), delete by _id, insert returns _ids (generated ObjectId + given)
- [x] updateMany/deleteMany preview count equals the affected count of the execute step (int test)
  - verified (2026-11-16 23:59+0100 by felix/agent-2): same int run -> 'updateMany: the preview count equals the matched and modified count', 'deleteMany: the preview count equals the deleted count', pipeline+collation variant: passed
- [ ] Read-only and unconfirmed-production writes refused (int test)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-16 23:44+0100 by felix/agent-2): docs.delete with expected on an already deleted document answers deleted:false (goal reached) instead of CONFLICT; a doc that exists but no longer matches expected gives CONFLICT with the server version
- ASSUMPTION (2026-11-16 23:44+0100 by felix/agent-2): updateMany/deleteMany expectedCount: refused with CONFLICT (no detail) only when MORE documents match now than the preview showed; fewer is allowed (nothing unconfirmed is touched)
- ASSUMPTION (2026-11-16 23:44+0100 by felix/agent-2): docs.update refuses update docs with non-operator keys and docs.replace refuses $-keys (INVALID_PARAMS) so an update can never silently replace; insert generates ObjectId _ids so every insertedId is returned; write errors -> SERVER_ERROR with serverCode/codeName

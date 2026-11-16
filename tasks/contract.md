---
title: M0: Typed IPC contract (envelope, errors, all method groups)
status: in_progress
owner: dell26/agent-2
deps: [scaffold]
touches: [packages/contract]
prio: 1
lease_until: 2026-11-16T18:16:33Z
---
## Goal
Implement SPEC.md section 4 in packages/contract: envelope types, stable error codes, and params/result types with zod schemas for every method group (profiles, conn, db, coll, docs, agg, idx, schema, io, shell, admin, app). One file per group (`src/<group>.ts`) so later tasks extend only their group. Also a `route(method)` helper saying whether a method is served by `main` (profiles.*, app.*, io dialogs) or `backend`.

## Acceptance criteria
- [ ] Unit tests: every method has a schema; valid sample params parse, invalid ones fail with a readable message
- [ ] Documents are typed as canonical EJSON strings in every params/result type (test asserts no `object` doc fields)
- [ ] Writes (`docs.insert/update/replace/delete/updateMany/deleteMany`, `idx.create/drop`, `db/coll.drop` …) carry `profileId` and optional `confirmed: boolean`; a test lists all write methods and checks this
- [ ] `npm run check` passes; no `any` in the package (lint rule on)

## Notes
Exact method signatures are decided here; record notable choices with `assume`.
- ASSUMPTION (2026-11-16 18:54+0100 by dell26/agent-2): zod 4 (4.6.7) chosen; params schemas are strictObject so unknown keys (e.g. a misspelt 'confirm') fail with INVALID_PARAMS; results are non-strict for forward compatibility
- ASSUMPTION (2026-11-16 18:54+0100 by dell26/agent-2): One open connection per profile, keyed by profileId (conn.open/close take profileId; no separate connection id)
- ASSUMPTION (2026-11-16 18:54+0100 by dell26/agent-2): updateMany/deleteMany preview step is a separate read method docs.previewMany (count + sample); updateMany/deleteMany take optional expectedCount. Backend should require confirmed:true for bulk writes on every profile, not only production
- ASSUMPTION (2026-11-16 18:54+0100 by dell26/agent-2): EJSON fields only check the outer shape (starts with { or [, or non-empty); full EJSON parsing is the receiver's job to avoid parsing 16 MB documents twice
- ASSUMPTION (2026-11-16 18:54+0100 by dell26/agent-2): io.export/io.previewImport/io.import route to main (native dialogs); the renderer never sends file paths, io.import takes an opaque fileToken returned by io.previewImport
- ASSUMPTION (2026-11-16 18:54+0100 by dell26/agent-2): Write methods: db.create/drop, coll.create/drop/rename/validator.set, docs.insert/update/replace/delete/updateMany/deleteMany, agg.createView, idx.create/drop/hide, io.import, admin.killOp; agg.run is a conditional write (only with out/merge stages). shell.eval is not a contract write (spec: server permissions are the only guard there)
- ASSUMPTION (2026-11-16 18:54+0100 by dell26/agent-2): app.* methods are app.settings.get, app.settings.set, app.theme, app.checkForUpdate; theme and connection-state changes are broadcast on well-known streams app.theme and conn.status

---
title: M0: Typed IPC contract (envelope, errors, all method groups)
status: todo
owner:
deps: [scaffold]
touches: [packages/contract]
prio: 1
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

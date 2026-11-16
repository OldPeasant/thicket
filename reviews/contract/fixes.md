# Fix Report

Date: 2026-11-16

Task: contract - M0: Typed IPC contract (envelope, errors, all method groups)

Scope: current task. Findings TW-1 (`reviews/contract/tests.md`) and CR-1..CR-5 (`reviews/contract/review.md`), plus the parent-approved `ejsonValue` whitespace observation from `tests.md`. Base 721a27361eadde378e1225eb2d7fd03043ae1c7e, fixes applied on top of HEAD 988e51b (uncommitted working tree changes).

## Fixed findings

### TW-1 — docs.updateMany `update` union gives "Invalid input"

Files changed:
- `packages/contract/src/common.ts`
- `packages/contract/src/docs.ts`
- `packages/contract/src/methods.spec.ts`

Problem:
`update: z.union([ejsonDocument('update'), ejsonArray('update pipeline')])` failed with zod 4's generic "Invalid input" message, so the caller did not learn what was expected.

Fix:
New helper `ejsonDocumentOrArray(description)` in `common.ts`: one string schema that accepts text starting with `{` or `[`, with the message `update must be canonical EJSON text of a document (starting with "{") or an array (starting with "[")`. It is registered in `ejsonSchemas` with the new `EJsonKind` value `'documentOrArray'`. `docs.updateMany.update` uses it. The existing TW-1 test now passes unchanged; added a helper test (accepted/rejected shapes, exact message, default description, registered kind).

Validation:
- `cd packages/contract && npx vitest run` — Pass

### CR-1 — `profile.connectionString` accepts a password

Files changed:
- `packages/contract/src/profiles.ts`
- `packages/contract/src/methods.spec.ts`

Problem:
The schema only checked the `mongodb://` / `mongodb+srv://` prefix, so `user:pass@host` passed in params (`profiles.save`, `conn.test` drafts) and results (`profiles.list/get/save/duplicate`, imports).

Fix:
Exported `hasPassword(uri)`: takes the authority (up to the first `/`, `?` or `#`, so multi-host lists and query options containing `:` are handled), the userinfo is everything before its last `@`, and a `:` in it means a password (an empty password `user:@` is rejected too). `connectionString` gets a `.refine` with the message `connectionString must not contain a password (user:password@); store it with profiles.setSecret` (the password itself is not echoed). Username-only userinfo stays allowed. Tests cover `mongodb://` and `mongodb+srv://`, single and multi-host, with and without username-only userinfo, query options containing `:`, a percent-encoded password, and rejection in `profiles.save` params, `conn.test` drafts, and `profiles.list` / `profiles.importUris` results.

Validation:
- `cd packages/contract && npx vitest run` — Pass

### CR-2 — no main-process file picker for profile file paths

Files changed:
- `packages/contract/src/profiles.ts`
- `packages/contract/src/index.spec.ts`
- `packages/contract/src/methods.spec.ts`
- `docs/ARCHITECTURE.md`

Problem:
`tls.caFile`, `tls.certificateKeyFile` and `ssh.privateKeyFile` could only be typed by hand; the contract had no native dialog method, and the "renderer never sends file paths" rule was applied inconsistently.

Fix:
Added main-routed `profiles.chooseFile` with params `{ purpose: 'tlsCaFile' | 'tlsCertificateKeyFile' | 'sshPrivateKeyFile' }` (exported `FILE_PURPOSES` / `FilePurpose`) and result `{ path: string | null }` (`null` = dialog cancelled). Doc comments on the profile path fields and in ARCHITECTURE.md say these stored profile paths are the deliberate exception to "renderer never sends paths" and come from `profiles.chooseFile`. Added samples to `SAMPLES` (index.spec.ts) and `RESULTS` (methods.spec.ts), plus tests for route, purposes, unknown keys and the cancelled result.

Validation:
- `cd packages/contract && npx vitest run` — Pass

### CR-3 — cancel routing undocumented

Files changed:
- `packages/contract/src/envelope.ts`
- `docs/ARCHITECTURE.md`

Problem:
`cancel` carries only an id; the contract did not say which process owns a request or stream, or where a cancel is sent.

Fix:
Documentation only. A request and its stream belong to the process that served the request (`route(method)`); the preload/main sends a cancel to the owner: by the request's method for a request id, and through a streamId → owner map kept by `main` for a stream id. Streams of main-routed `io.*` methods are run by the backend, so `main` forwards their cancel to the backend. Also corrected the comment's field name (`target` -> `cancel`, the actual key).

Validation:
- `npm run check` — Pass (comment-only change)

### CR-4 — docs.find accepts contradictory paging params

Files changed:
- `packages/contract/src/docs.ts`
- `packages/contract/src/methods.spec.ts`

Problem:
`after`, `before` and `skip` could all be sent together.

Fix:
Two `.refine`s on the `docs.find` params (same pattern as `conn.test`): `docs.find takes at most one of after or before` and `docs.find takes skip or range paging (after/before), not both`. Tests for valid single use and for each rejected combination with the message.

Validation:
- `cd packages/contract && npx vitest run` — Pass

### CR-5 — `confirmed: true` rule documented inconsistently

Files changed:
- `packages/contract/src/define.ts`
- `packages/contract/src/common.ts`
- `docs/ARCHITECTURE.md`

Problem:
These places said `confirmed: true` is required only on production profiles.

Fix:
Comments now say it is required for every write on production profiles and for `docs.updateMany` / `docs.deleteMany` on every profile (SPEC M1 "Safety"), matching `errors.ts` and the recorded assumption. No `MethodDef` attribute added (optional in the review; not needed).

Validation:
- `npm run check` — Pass (comment-only change)

### TW-obs — `ejsonValue` accepts whitespace-only text

Files changed:
- `packages/contract/src/common.ts`
- `packages/contract/src/methods.spec.ts`

Problem:
`ejsonValue` used `min(1)`, so `"   "` passed (e.g. as an `_id`).

Fix:
Replaced `min(1)` with a refine on `text.trim().length > 0`, same message (`<description> must be non-empty canonical EJSON text`). Added a test (spaces, newline/tab, and `docs.get` with a blank `id`).

Validation:
- `cd packages/contract && npx vitest run` — Pass

## Not fixed

None.

## Validation summary

Focused tests:
- `cd packages/contract && npx vitest run` — Pass: 2 files, 594 tests passed

Full test suite:
- `npm run check` (repo root) — Pass: lint, prettier, typecheck, vitest (5 files, 597 tests passed), renderer tests (2 files, 46 tests passed)

Lint/type-check/build:
- Included in `npm run check` — Pass. `npx prettier --write` run on the changed `.ts` files. `*.md` is in `.prettierignore` (human-written docs keep their own formatting), so the prettier reformat of `docs/ARCHITECTURE.md` was reverted and only the contract-section lines were edited.

`.taskcheck`:
- `sh .taskcheck` — Pass

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.

# Fix Report

Date: 2026-11-17

Task: index-ui - M3: Indexes tab

Scope: current task; approved findings TW-1 (reviews/index-ui/tests.md), CR-1, CR-3, CR-4, CR-5 (reviews/index-ui/review.md), plus removal of the dead `hasUsage` computed. Base b739b48, fixed on top of HEAD 87f2e22 (uncommitted).

## Fixed findings

### TW-1 — `.$**` passes field validation

Files changed:
- `packages/renderer/src/app/indexes/index-form.model.ts`

Problem:
`fieldProblem` treated an empty base of any wildcard path as valid, so `.$**` was accepted.

Fix:
Only the bare `$**` returns no problem; a `path.$**` with an empty base returns "A field path has no empty parts.". The existing failing test is unchanged and now passes.

Validation:
- `npx ng test --include='src/app/indexes/**/*.spec.ts'` (packages/renderer) — Pass

### CR-1 — Wildcard text index `{ "$**": "text" }` refused

Files changed:
- `packages/renderer/src/app/indexes/index-form.model.ts`
- `packages/renderer/src/app/indexes/index-create-form.ts`
- `packages/renderer/src/app/indexes/index-form.model.spec.ts`
- `packages/renderer/src/app/indexes/index-create-form.spec.ts`

Problem:
Every wildcard field had to be ascending/descending, and wildcard + text was refused as a whole, so the documented text index on all string fields could not be created.

Fix:
`type: text` is allowed on the bare `$**` field. Such a field no longer counts as a wildcard (non-text) field: it is a text index, so weights and default_language apply, and it can be combined with plain and other text fields. `text` on `path.$**` is refused ("Only the field $** can be a text field among wildcards."); `2dsphere`/`2d`/`hashed` on any wildcard field stay refused; a wildcard text field together with a wildcard (non-text) field is refused. A wildcard projection on a wildcard text index is refused ("A wildcard text index has no wildcard projection."), and the form greys out the wildcard projection label for it (`hasWildcard` excludes text fields). The old test "refuses a wildcard field of type text" for `$**` contradicted MongoDB behavior; it now covers `2dsphere`/`2d`/`hashed` on `$**` and `attrs.$**`, and text is covered by new tests (accept `$**` text, compound with plain/text fields, refuse `attrs.$**` text, refuse with a wildcard field or a special type, weights/language sent, projection and collation refused; component test creating `{ "$**": "text" }` with weights and language).

Validation:
- `npx ng test --include='src/app/indexes/**/*.spec.ts'` (packages/renderer) — Pass

### CR-3 — Missing client-side refusals (2d position, collation with text/2d)

Files changed:
- `packages/renderer/src/app/indexes/index-form.model.ts`
- `packages/renderer/src/app/indexes/index-form.model.spec.ts`

Problem:
A 2d field that is not first, and a collation on a key with a text or 2d field, were only refused by the server.

Fix:
`errors.fields` "A 2d field must be the first field of the key." (checked after the existing whole-key rules, so their messages keep priority); `errors.collation` "A text index does not support a collation." / "A 2d index does not support a collation.". The existing test "builds every option in a fixed order" combined a text key with a collation, which MongoDB refuses; the collation was moved into a second assertion on a plain key in the same test, so the option order (incl. collation's place) is still checked. New tests: 2d not first refused, 2d first with further fields accepted, collation refused on text/2d/wildcard text keys, collation still accepted on 2dsphere.

Validation:
- `npx ng test --include='src/app/indexes/**/*.spec.ts'` (packages/renderer) — Pass

### CR-4 — Cancel enabled while a create is in flight

Files changed:
- `packages/renderer/src/app/indexes/index-create-form.html`
- `packages/renderer/src/app/indexes/index-create-form.spec.ts`

Problem:
Cancelling during `idx.create` destroyed the form, so a successful create was neither reported nor reloaded.

Fix:
Cancel has `[disabled]="saving()"`. New component test: Cancel is disabled while the create is pending, a click emits nothing, and after the create finishes `created` is emitted and Cancel is enabled again.

Validation:
- `npx ng test --include='src/app/indexes/**/*.spec.ts'` (packages/renderer) — Pass

### CR-5 — Text indexes listed as `_fts`/`_ftsx`; text/wildcard options not tagged

Files changed:
- `packages/renderer/src/app/indexes/indexes-view.ts`
- `packages/renderer/src/app/indexes/indexes-view.spec.ts`

Problem:
The list showed the stored `_fts text  _ftsx ↑` key and no tags for the language or the wildcard projection.

Fix:
`toRows` parses `raw` once. For a key with `_fts: "text"`, the `_fts` part is replaced by the field names of `raw.weights` (kind `text`, `$**` for a wildcard text index) and `_ftsx` is dropped; other key fields stay in place. If the weights cannot be read the raw parts are kept. New tags: `language <x>` (title `default_language`) when `default_language` is not `english`, and `wildcard projection` (title = the projection in shell syntax). Tests: compound text index with prefix/suffix fields and default English (no tag), wildcard text index with Spanish, unreadable raw keeps `_fts`/`_ftsx`, wildcard projection tag.

Validation:
- `npx ng test --include='src/app/indexes/**/*.spec.ts'` (packages/renderer) — Pass

### Dead `hasUsage` computed

Files changed:
- `packages/renderer/src/app/indexes/indexes-view.ts`

Problem:
`hasUsage` was never used by the template or the class.

Fix:
Removed.

Validation:
- `npm run check` — Pass (lint and type check included)

Docs: `docs/ARCHITECTURE.md` "Indexes tab" updated for the wildcard text index, the new refusals, the disabled Cancel and the text key / language / wildcard projection display.

## Not fixed

None. (CR-2 was not in the supplied list; the test-writer's indexes-view.spec.ts already covers it.)

## Validation summary

Focused tests:
- `npx ng test --include='src/app/indexes/**/*.spec.ts'` (in packages/renderer) — Pass, 3 files, 187 tests

Full test suite:
- `npm run check --prefix /home/eric/work/mongo-db-client-agents/agent-1` — Pass: lint (eslint + prettier) and type check pass; root vitest 64 files / 3545 tests passed; renderer `ng test` 83 files / 2628 tests passed

Lint/type-check/build:
- Included in `npm run check` — Pass. `prettier --write` run on `packages/renderer/src/app/indexes/`.

`.taskcheck`:
- Not run separately; it runs `npm run check`, which passed.

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.

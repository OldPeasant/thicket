# Code Review

Date: 2026-11-17

Task: index-ui - M3: Indexes tab

Scope: task commits e31e972 and e4feff8 (`git diff b739b48..e4feff8`); committed changes only, uncommitted spec files from the parallel test-writer ignored.

Requirements:
- tasks/index-ui.md acceptance criteria (e2e TTL + partial index listed with options; component tests for create form validation)
- SPEC.md M3 "Index management" (list with size and usage stats; create with fields and direction, unique, sparse, partial filter, TTL, collation, hidden, text/2dsphere/wildcard; drop; hide/unhide)
- docs/ARCHITECTURE.md (WriteGuard for writes, contract packages/contract/src/idx.ts, theme tokens)
- AGENTS.md project notes; parent instructions (accessibility, theme tokens, validation vs MongoDB server behavior)

Git range:
- Branch: main
- HEAD: e4feff8d626f36258b68c9e8cf92cee3c115fe0c
- Base/start: b739b48d188a45b25e68023ffc6cc61f3479e17e
- Commits reviewed: 2

Summary: 0 P0, 0 P1, 2 P2, 3 P3

Checked and found in order: all three writes (`idx.create`, `idx.drop` with `alwaysConfirm`, `idx.hide`) go through `WriteGuard.run` and their buttons use `appWriteControl`; params match the `idx.ts` contract (canonical EJSON key/options strings, `expireAfterSeconds` as Int32, bounded by INT32_MAX); `idx.stats` failure only blanks size/usage; `reload()` uses a generation counter so an older answer never overwrites a newer one and loading always ends; `_id_` has no drop/hide; both CSS files use only theme tokens (every token used is defined in all four theme blocks; no hex/rgb/hsl literals); form errors are tied to inputs with `aria-invalid`/`aria-describedby`, the select and icon buttons have accessible names, the disclosure uses `aria-expanded`. Validation rules checked against server behavior: sparse + partialFilterExpression, unique hashed, unique wildcard, TTL on compound/_id/non-1/-1 keys, TTL range, reserved name `*`, at most one hashed field, wildcardProjection only with `$**`, collation requires `locale` all match server refusals. The e2e (test/e2e/indexes.e2e.ts) covers the acceptance criterion and asserts the server-side specs via `listIndexes`; index-create-form.spec.ts covers the form validation criterion. The task file shows no recorded `verify` evidence yet; that is for the parent to record before `done`.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | Wildcard text index `{ "$**": "text" }` is refused by the form**
    - File: `packages/renderer/src/app/indexes/index-form.model.ts:139`
    - Category: Correctness
    - Problem: `buildIndex` gives every wildcard field (`$**`, `path.$**`) the error "A wildcard field is ascending or descending." unless its type is `1`/`-1`, and line 156 also refuses `hasWildcard && hasText`. `{ "$**": "text" }` (text index over all string fields) is a valid, documented MongoDB index, and SPEC M3 lists text indexes as a must. The user cannot create it from the form at all; the client blocks it before the server sees it.
    - Why it matters: A supported server feature in the SPEC's "text" option is made impossible by client validation that is stricter than the server.
    - Suggested fix: Allow `type === 'text'` on the `$**` field (and allow it alongside other text/ascending fields as the server does); keep refusing `2dsphere`/`2d`/`hashed` on wildcard fields. Do not offer `wildcardProjection` for it. Add a model/component test for `{ "$**": "text" }`.

- [ ] **CR-2 | No unit tests for IndexesView (list mapping, stats failure, drop/hide flows)**
    - File: `packages/renderer/src/app/indexes/indexes-view.ts:65` (also `toRows` line 122, `reload` line 205, `write` line 257)
    - Category: Tests
    - Problem: The commits add no `indexes-view.spec.ts`. `keyParts`, `formatBytes`, `toRows` (usage ratio, missing stats, collation/TTL/partial tags), the `idx.stats` failure path, the out-of-order guard in `reload()`, drop-cancel (`CANCELLED` shows no error) and the `busy` lock are exercised only by the one happy-path e2e, which does not cover stats failure, cancel, or a read error.
    - Why it matters: Regression-prone list/formatting and error-path behavior has no fast test. Not blocking the stated criteria, which name only form tests and the e2e. The test-writer may be adding this in parallel; if it does, this finding is resolved.
    - Suggested fix: Add a component/unit spec with `FakeThicketBridge` covering `toRows`/`keyParts` for text, 2dsphere, hashed and desc keys, a failing `idx.stats`, a failing `idx.list`, a cancelled drop, and a hide toggle.

## P3 Low

- [ ] **CR-3 | Some server refusals are not caught client-side, contrary to the documented intent**
    - File: `packages/renderer/src/app/indexes/index-form.model.ts:213` (collation), `:150` (2d position)
    - Category: Correctness
    - Problem: The model and docs/ARCHITECTURE.md say `buildIndex()` "refuses what the server would", but a collation on a key with a `text` or `2d` field passes (the server refuses: "Index type 'text' does not support collation"), and a `2d` field that is not first in the key also passes (server: "2d has to be first in index"). The server error is then shown in the form, so nothing breaks.
    - Why it matters: These cases surface as a generic server error instead of a message beside the field.
    - Suggested fix: Add `errors.collation` when `hasText` or `count('2d') > 0`, and an `errors.fields` when a `2d` field is not at index 0. Or tone down the docs wording.

- [ ] **CR-4 | Cancel stays enabled while a create is in flight; a committed create is then not reflected**
    - File: `packages/renderer/src/app/indexes/index-create-form.html:279`, `packages/renderer/src/app/indexes/index-create-form.ts:178`
    - Category: Correctness
    - Problem: While `saving()` is true, Cancel is still enabled. If clicked, `IndexesView` destroys the form (`creating.set(false)`); when `idx.create` then succeeds on the server, `created.emit()` runs on a destroyed output (Angular only warns and drops it), so the view neither shows "Created index ..." nor reloads.
    - Why it matters: The list stays stale until a manual Refresh, although the index exists. Index builds on large collections can take long, which makes this more likely.
    - Suggested fix: Disable Cancel while `saving()`, or have the view reload when the form is cancelled.

- [ ] **CR-5 | Text and wildcard options are not shown in the list; text keys show internal `_fts`/`_ftsx`**
    - File: `packages/renderer/src/app/indexes/indexes-view.ts:65` and `:97`
    - Category: Quality
    - Problem: `keyParts` renders the raw key, so a text index on `title` is listed as `_fts text  _ftsx ↑`, and `tagsOf` does not show `weights`, `default_language` or `wildcardProjection`, all of which the form can set. The user cannot see from the list which fields a text index covers.
    - Why it matters: The list shows options for TTL, partial, unique, sparse, hidden and collation, but text indexes created through this form cannot be identified.
    - Suggested fix: For keys with `_fts`, list the field names from `raw.weights` (with their weights as a tag title) and add tags for `default_language` and `wildcardProjection`.

## Review conclusion

Material issues found; fix before completing the task. CR-1 blocks a SPEC-listed index type. CR-2 should be closed by the test-writer's specs. CR-3 to CR-5 are small.

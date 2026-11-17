# Fix Report

Date: 2026-11-17

Task: conflict-ui - M1: Conflict resolution view

Scope: current task. Findings CR-1..CR-6 from `reviews/conflict-ui/review.md` and TW-1, O-1, O-2 from
`reviews/conflict-ui/tests.md` (TW-1 = CR-3, O-1 = CR-2, O-2 = CR-4). The task owner approved all of them and set
the fix direction for each. Changes are left uncommitted on `main` (base HEAD `b2a52e4`).

## Fixed findings

### CR-1 — Overwrite / merge under a nested (dotted) projection unsets hidden sub-fields

Files changed:
- `packages/renderer/src/app/document/document-actions.service.ts`
- `packages/renderer/src/app/document/conflict/conflict-view.ts`
- `packages/renderer/src/app/document/document-actions.service.spec.ts`
- `packages/renderer/src/app/document/document-editing.spec.ts`

Problem:
`resolveWith` filtered the server version to the loaded top-level fields only. Under a dotted projection
(`{"addr.city": 1}`) it therefore sent `$unset` for sub-fields the user never loaded. Under `$slice`/`$elemMatch` it
compared truncated arrays. The view's note claimed hidden fields stay untouched, which was not true in these cases.

Fix:
- New exported `isTopLevelProjection(projection)`. It returns true only when every key has no `.` and no leading
  `$`, and every value is a boolean or the number 0/1 (int, double or long). Operators, expressions and unparseable
  text return false.
- New public `DocumentActions.resolveBlocker(key)`, returning `'server-unknown' | 'projection' | null`. It returns
  `'projection'` when the document may be partial and either no projection is active now (edited under a
  since-cleared projection) or the active projection is not top-level-only.
- `overwrite()` and `saveMerged()` refuse in that case with a message: "Not saved: the document was loaded with a
  projection that hides parts of fields or is no longer active, ... Clear the projection, run the query again and
  edit again."
- The view hides Overwrite and Merge manually for a blocked conflict and shows a note (`conflict-note`) telling the
  user to clear the projection, run the query again and edit again. Keep server version stays available.
- The "Only the fields loaded with the query's projection are compared" note now appears only when it is true:
  partial, not blocked, and with edits left.
- The deleted-document path (re-insert refused under any projection) is unchanged.
- Test change: the existing test "overwrite of a document edited under a since-cleared projection still keeps hidden
  fields" contradicted the approved fix. It now asserts the refusal: no request sent, conflict and baseline kept.
- Test change: "overwrite with a projection compares only the loaded fields" only set the partial flag and had no
  active projection. That case is now refused, so the test sets the top-level projection it describes. Its
  assertions are unchanged.

Validation:
- `cd packages/renderer && npx ng test --include='src/app/document/**/*.spec.ts' --include='src/app/collection/**/*.spec.ts'`
  — Pass (9 files, 307 tests). New tests:
  - refusal under a dotted path, `$slice` and `$elemMatch`, including Keep server still working;
  - an exclusion top-level projection is allowed and the hidden field is not unset;
  - `isTopLevelProjection` accepts 5 inputs and refuses 8;
  - UI: "hides Overwrite and Merge under a projection of parts of fields, and says why".

### CR-2 (O-1) — `resolveWith` moved the baseline before the write

Files changed:
- `packages/renderer/src/app/document/document-actions.service.ts`
- `packages/renderer/src/app/document/edit-session.ts`
- `packages/renderer/src/app/document/edit-session.spec.ts`
- `packages/renderer/src/app/document/document-actions.service.spec.ts`

Problem:
`edits.resolve(key, base, local)` ran before `save()`. After a cancel, refusal or failure, the session was already
rebased onto the server version and the document's undo history was gone. A later plain Save then overwrote the
other client's change.

Fix:
- The write path of `save()` moved into a private `send(key, original, current, partial, saved)`. It computes the
  diff with `pendingSave` and does not touch the edit session. Only after the write succeeds and the document is
  read back does it call `saved()`.
- `save()` and `overwrite()` pass `rebase(key, sent)`, the same as the old save behaviour. Edits made while the
  write ran stay unsaved; without such edits the document ends unmodified and its undo/redo steps are dropped.
- `saveMerged()` passes `discard(key)`, because the merged document replaces the local edits.
- On cancel, read-only refusal, other failure or a new CONFLICT, the baseline, current version and undo history are
  unchanged.
- `DocumentEdits.resolve()` was added by this task only for the pre-write rebase. It is now unused, so it was
  removed together with its 5 unit tests in `edit-session.spec.ts`. Those tests covered only the removed method; the
  required behaviour is now covered by the service tests below.

Validation:
- Focused command above — Pass. New tests:
  - "cancelled, refused or failed overwrites leave the edit session as it was". It covers a production cancel for
    both overwrite and merge, a read-only refusal, a SERVER_ERROR and a new CONFLICT. It also checks that undo still
    works and that a later plain Save checks against the loaded version (`expected` total 10).
  - "a successful overwrite or merge leaves no unsaved edits and no undo steps for the document".

### CR-3 (TW-1) — An unreadable CONFLICT detail was shown and resolved as a deletion

Files changed:
- `packages/renderer/src/app/document/document-actions.service.ts`
- `packages/renderer/src/app/document/conflict/conflict-view.ts`
- `packages/renderer/src/app/document/document-actions.service.spec.ts`
- `packages/renderer/src/app/document/document-editing.spec.ts`

Problem:
A missing, malformed or non-EJSON `detail.current` became `current: null`, which the view treats as "deleted".

Fix:
- `SaveConflict.current` is now `BsonDocument | null | undefined`, where `undefined` means the server version is
  unknown.
- `failed()` is now async and awaited inside `write()`, so the document stays busy while it runs. When the detail
  has no readable version, it reads the document again with `docs.get` without a projection:
  - a document → that document is the server version;
  - `doc: null` (what the backend returns for a missing `_id`) or a `NOT_FOUND` error → deleted;
  - any other failure → unknown.
- The edit-bar message says "deleted" only when `current === null`.
- The view has three states: changed, deleted, and unknown. For unknown the title is "Changed on the server; its
  current version could not be read", a note says "Keep the server version to load it again, then edit again", and
  no diff table is shown. Only Keep server version is offered.
- `overwrite()` and `saveMerged()` refuse for unknown with a message.
- `keepServer` for unknown reads the document back with the query's projection. If that fails, the page keeps its
  loaded version: `readBack` no longer calls `documentChanged` when it has no fallback.
- Test change: the old service test "still reports a conflict whose detail is malformed" expected
  `{current: null}`. It is now "reads the server version again when the conflict detail is malformed" and also checks
  that `docs.get` was sent without a projection. The TW-1 component test was kept unchanged and now passes.

Validation:
- Focused command above — Pass. New service tests:
  - reread for no detail and for non-EJSON text;
  - deleted only when the reread finds no document (`doc: null` and `NOT_FOUND`);
  - unknown when the reread fails;
  - overwrite and merge refused while unknown, with Keep server leaving the page as loaded;
  - Keep server shows the document once it is readable.
- New UI tests: "reads the server version again for a malformed conflict detail and shows it", and "offers only
  Keep server version when the server version cannot be read".

### CR-4 (O-2) — Projection view showed the server version as `{}` once all edits were undone

Files changed:
- `packages/renderer/src/app/document/conflict/conflict-view.ts`
- `packages/renderer/src/app/document/document-editing.spec.ts`

Problem:
With a projection and no edit entry left, `visibleFields(server, [])` kept no field.

Fix:
When no edit entry is left, the server version is shown unfiltered, as the owner decided. The projection note is
hidden in that state because nothing is compared.

Validation:
- Focused command above — Pass. New UI test: "with a projection shows the whole server version once every edit was
  undone".

### CR-5 — Merge textarea id was only unique within one tab

Files changed:
- `packages/renderer/src/app/document/conflict/conflict-view.ts`
- `packages/renderer/src/app/collection/collection-view.html`
- `packages/renderer/src/app/document/document-editing.spec.ts`

Problem:
The id was `'merge-' + $index`, which is the same in every collection tab, and all tabs stay in the DOM.

Fix:
New `uid` input on `ConflictView` (default `'conflicts'`), following the `DraftDocuments` pattern. `collection-view.html`
passes `uid + '-conflicts'`, and the label and textarea use `uid() + '-merge-' + $index`.

Validation:
- Focused command above — Pass. New UI test: "gives the merge editor an id unique to the tab, and its label points
  to it". The id matches `coll-view-N-conflicts-merge-0` and the label's `for` equals it.

### CR-6 — Differing lines were not exposed to assistive technology

Files changed:
- `packages/renderer/src/app/document/conflict/conflict-view.ts`
- `packages/renderer/src/app/document/document-editing.spec.ts`

Problem:
The `+`/`−` marks are `aria-hidden`, so the difference was conveyed only by colour.

Fix:
Each differing cell now starts with visually hidden text: "Changed: ", "Only in your version: " or "Only on the
server: ". It uses a component-scoped `.sr-only` rule copied from `layout/tab-bar.css`. The visual marks are
unchanged, and identical lines and gap cells get no extra text.

Validation:
- Focused command above — Pass. New UI tests: "tells screen readers which lines differ and on which side" and
  "labels lines only one side has for screen readers".

## Not fixed

None.

## Validation summary

Focused tests:
- `cd packages/renderer && npx ng test --include='src/app/document/**/*.spec.ts' --include='src/app/collection/**/*.spec.ts'`
  — Pass: 9 files, 307 tests.
- `npm run test:e2e -- test/e2e/conflict.e2e.ts` (repo root, Electron app and MongoDB container) — Pass: 2 passed
  (3.4s).

Full test suite:
- `npm run check` (repo root) — Pass. This covers eslint, prettier `--check`, typecheck of all workspaces, root
  vitest (53 files, 3160 tests) and renderer `ng test` (69 files, 2024 tests).

Lint/type-check/build:
- Included in `npm run check` above — Pass. Prettier `--write` was run on all changed files.

`.taskcheck`:
- Pass. It runs `npm run check`, so this is the same run as above.

Remaining unresolved findings:
0

Notes for the parent worker:
- The task's recorded assumption says Overwrite/Merge "consider only the top-level fields the user loaded/edited"
  with a projection. That is still true, but they are now refused unless the projection is top-level-only. The
  parent may want to record this narrowing with `tasks.py assume`.
- `resolveBlocker` checks the projection active now. If a document was edited under a dotted projection and the
  user then ran a top-level-only projection while keeping the edits, its old baseline is not detected. This edge
  case follows the approved direction and was not changed.
- Coverage was not re-measured by the fixer. `tests.md` asks for a re-measurement after the TW-1 fix, which the next
  test-writer round should do.

## Final status

All validated findings fixed and validation passed.

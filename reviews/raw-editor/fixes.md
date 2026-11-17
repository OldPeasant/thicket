# Fix Report

Date: 2026-11-17

Task: raw-editor (CodeMirror raw editor in shell syntax and EJSON, applied into the edit session)

Scope: current task, finding CR-1 from `reviews/raw-editor/review.md` (base 60c8625c067dfcc3a145ef6e54293ea0b6662c9d, reviewed HEAD a9b5ba9)

## Fixed findings

### CR-1: A reused raw editor keeps another document's unapplied text when the list's documents change

Files changed:
- `packages/renderer/src/app/raw-editor/raw-editor.ts`
- `packages/renderer/src/app/raw-editor/raw-editor.spec.ts`

Problem:
The collection view tracks the document list by `$index`, so after paging the same `RawEditor` instance can get a different document through its `doc` input. The follow effect only checked `dirty()`. If the text had unapplied changes, it kept them, so the previous document's text, error and "Not applied" state appeared under the new document. Apply then failed with "The _id of a document cannot be changed". I confirmed this in the code at `raw-editor.ts:186-198`.

Fix:
The fix is inside `RawEditor`, so it protects every consumer, not only the collection view. The follow effect now also reads `doc()` and remembers which document the text belongs to. That identity is `documentKey(doc)`, or the document object itself when there is no `_id`. When the identity changes, the effect reprints the text from the new document, resets the baseline (so the text is no longer dirty) and clears the error and its diagnostics. A new object with the same `_id`, as after a re-query, has the same identity, so unapplied text is still kept in that case, as before. The format choice stays, because it is a view preference rather than document state. The collection view template is unchanged.

Regression spec (`raw-editor.spec.ts`, "shows another document instead of keeping unapplied text of the previous one"): it types dirty text and applies it, which shows an error. It then sets `host.doc` to a document with another `_id` and checks:
- the text is the new document;
- `dirty()` is false and "Not applied" is not shown;
- no error and no diagnostics are shown;
- Apply is disabled.

It then checks that a re-query with the same `_id` keeps unapplied text. Without the fix, the first value assertion would fail because the old effect keeps dirty text. I did not run the spec against the unfixed code: the sandbox blocked the commands that would have swapped the file temporarily. The file keeps calling `installJsdomLayoutStubs()`.

Validation:
- `npx prettier --write` on both changed files: Pass (the spec was reformatted)
- `cd packages/renderer && npx ng test --include='src/app/raw-editor/**/*.spec.ts'`: Pass (4 files, 327 tests)

## Not fixed

None.

## Validation summary

Focused tests:
- `cd packages/renderer && npx ng test --include='src/app/raw-editor/**/*.spec.ts'`: Pass (327 tests)

Full test suite:
- `npm run check` at the repo root: Pass (root vitest 2989 tests, renderer 1928 tests)

Lint/type-check/build:
- `npm run check` (eslint --max-warnings 0, prettier --check, tsc and ngc type checks): Pass

`.taskcheck`:
- `sh .taskcheck`: Pass

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.

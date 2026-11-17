# Code Review

Date: 2026-11-17

Task: raw-editor - M1: Raw editor in shell syntax and EJSON

Scope: Final pass on revision 49f7c9c. The task's own commits on top of base 60c8625c are 8c61ad5 (implementation), 278d8ae (test-writer specs and the first review), 1cb45a9 (CR-1 fix) and 49f7c9c (second test-writer pass). Production code has not changed since 1cb45a9: `git diff 1cb45a9..49f7c9c -- . ':!reviews'` touches only `raw-editor.spec.ts` (+56) and `raw-editor-collection.spec.ts` (+21). This pass reviews those spec additions and re-checks the earlier conclusions at HEAD. `git diff 60c8625c..HEAD` also contains io-basic-backend commits, which were merged to main from another task. They are out of scope and were not reviewed. In scope for the whole task: `packages/renderer/src/app/raw-editor/*`, `packages/renderer/src/app/collection/collection-view.{ts,html,css}`, the `eslint.config.mjs` no-eval block, the CodeMirror dependencies in `packages/renderer/package.json` / `package-lock.json`, and the raw-editor section of `docs/ARCHITECTURE.md`. Only committed changes were reviewed, and the working tree was clean.

Requirements:
- tasks/raw-editor.md acceptance criteria and recorded assumptions
- SPEC.md M1 "Raw editor" and §6 (no `eval`, parser only)
- docs/ARCHITECTURE.md
- docs/QUALITY.md (report contract)
- AGENTS.md
- reviews/raw-editor/fixes.md (the CR-1 fix)

Git range:
- Branch: main
- HEAD: 49f7c9c434211efcdbc180f41497efe3dceccf10
- Base/start: 60c8625c067dfcc3a145ef6e54293ea0b6662c9d
- Commits reviewed: 4 (8c61ad5, 278d8ae, 1cb45a9, 49f7c9c)

Summary: 0 P0, 0 P1, 0 P2, 1 P3

Commands and limits:
- `git show 49f7c9c -- packages` and `git diff 1cb45a9..HEAD --stat -- . ':!reviews'`: the change is spec-only.
- I read the follow effect, `apply()` and `setText` in `raw-editor.ts` at HEAD, the spec helpers, and the document-list template and raw-toggle state in `collection-view.{ts,html}`.
- `cd packages/renderer && npx ng test --include='src/app/raw-editor/**/*.spec.ts'` at HEAD -> 4 files, 331 tests passed (2.1 s). I could not repeat the run in a loop because the command was denied, so flakiness was judged by reading the code (below). I did not run the full `npm run check`. The parent must run it as part of `.taskcheck`.

## Review of the spec changes in 49f7c9c

`raw-editor.spec.ts`:
- `keeps the chosen format when another document comes in` (line 417): this test switches to EJSON, makes the text dirty, then switches `doc` to another `_id`. It asserts that the EJSON toggle stays pressed, `format()` is `ejson`, the text is the new document in EJSON, and the dirty marker is gone. It then applies EJSON text for the new document and checks that `edits.current(other)` is updated while `edits.current(DOC)` is unchanged. This exercises the `otherDocument` branch (`raw-editor.ts:197`) together with `printRaw(shown, this.format())`, and the `_id` guard in `apply()`. The assertions match the production behavior.
- `shows the unsaved edits of a document that comes in` (line 438): this test seeds a session edit for the other document, makes the current text dirty, and then switches. It asserts that the editor shows the edited version of the incoming document (via `shown()`), not its stored one, and that the editor is not dirty. The test is correct, and it covers that a switch uses the session state.
- `shows another document without _id instead of the unapplied text of the previous one` (line 453): this test covers the object-identity fallback (`documentKey(doc) ?? doc`) in two directions: from a document without `_id` to another one, and from a document without `_id` to one with an `_id`. It asserts the text, the dirty marker, the `raw-no-id` notice and `edits.modified() === false`. The test is correct.

`raw-editor-collection.spec.ts`:
- `shows each row's own document, not another's unapplied text, when the rows change order` (line 165): the document list uses `@for (...; track $index)`, and the raw toggles are stored by `_id` key (`collection-view.ts:236-258`). After the rows are reordered, both rows still show an editor, and Angular reuses the row-0 `RawEditor` instance with a different `doc` input. So this is a real end-to-end test of the CR-1 scenario in the collection tab. It asserts the text of both rows, that row 0 is not dirty and has no error, and that no change was counted.
- The last assertion, `not.toMatch(/[1-9] change/)`, is a loose way to say that the edit bar shows no changes. In this scenario at most one unapplied text exists and nothing is applied, so the assertion cannot give a false pass here. Not reported.

Flakiness: the new tests use the same `whenStable()` / `settle()` helpers as the existing specs. The fake `docs.find` answers on `setTimeout(0)`, and `settle()` drains five macrotask turns. The tests use no wall-clock timing, randomness or shared state between tests. I found no flakiness risk.

## Earlier conclusions re-checked at HEAD

- CR-1 (a reused editor kept another document's unapplied text) stays fixed. The production code is identical to 1cb45a9. The fix is the identity-tracking follow effect at `raw-editor.ts:188-211`, and the 49f7c9c specs now also cover it through the collection tab, the format preference, session edits and documents without `_id`.
- The guard in `apply()` that compares `documentKey` with `doc()` is unchanged.
- Acceptance criterion 1 (toggle preserves content, syntax error at line/column, apply updates the model) is covered by `raw-editor.spec.ts`, `raw-editor-collection.spec.ts` and `raw-text.spec.ts`. All of these passed in the run above.
- Acceptance criterion 2 (no `eval`/`new Function` in the editor's bundle path) is covered by `no-eval.spec.ts`, which walks the real import graph, and by the ESLint `no-eval`/`no-implied-eval`/`no-new-func` rules. No imports changed since the last review.
- The parent must record its own run evidence for both criteria with `tasks.py verify`.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-2 | Undo after the editor switches to another document brings back the previous document's text**
    - File: `packages/renderer/src/app/raw-editor/raw-editor.ts:197-201` (with `setText` at `raw-editor.ts:301-311`)
    - Category: Correctness
    - Problem: `setText` replaces the content with a normal transaction that only carries the `External` annotation. It does not set `Transaction.addToHistory.of(false)`, and it does not reset the history. So the replacement made in the "other document" branch is recorded in CodeMirror's undo history. If the user presses Ctrl+Z in a reused editor after it switched to document B, document A's text comes back, marked "Not applied". Apply then refuses it with "The _id of a document cannot be changed". No data is at risk, because the `_id` guard in `apply()` holds. The parent has accepted this as non-blocking. It is still open at 49f7c9c, and none of the new specs press undo after a switch.
    - Suggested fix: In the other-document branch, keep the replacement out of the history or start a fresh history. For example, dispatch it with `Transaction.addToHistory.of(false)`, or rebuild the state with `view.setState(...)` and the same extensions. Optionally, add an undo step after the switch to the regression spec.

## Review conclusion

No material issues found. The spec additions in 49f7c9c are correct, test what their names claim (the collection-tab test really reuses an editor instance for another document), and show no flakiness risk. The raw-editor specs pass at HEAD (331 tests). The earlier conclusions still hold, because the production code is unchanged since 1cb45a9. The only remaining finding is the P3 CR-2, which the parent accepted as non-blocking.

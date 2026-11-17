# Code Review

Date: 2026-11-17

Task: raw-editor - M1: Raw editor in shell syntax and EJSON

Scope: Second pass on the final revision. The task's own commits on top of base 60c8625c are 8c61ad5 (implementation), 278d8ae (test-writer specs and the first review) and 1cb45a9 (CR-1 fix). `git diff 60c8625c..HEAD -- . ':!tasks' ':!reviews'` also contains the io-basic-backend commits (apps/desktop dialogs, packages/backend/src/io, packages/contract, test/integration/io.int.spec.ts), which were merged to main from another task. They are out of scope and were not reviewed. In scope: `packages/renderer/src/app/raw-editor/*`, `packages/renderer/src/app/collection/collection-view.{ts,html,css}`, the `eslint.config.mjs` no-eval block, the CodeMirror dependencies in `packages/renderer/package.json` / `package-lock.json`, and the raw-editor section of `docs/ARCHITECTURE.md`. Only committed changes were reviewed, and the working tree was clean.

Requirements:
- tasks/raw-editor.md acceptance criteria and recorded assumptions
- SPEC.md M1 "Raw editor" and §6 (no `eval`, parser only)
- docs/ARCHITECTURE.md
- docs/QUALITY.md (report contract)
- AGENTS.md
- reviews/raw-editor/fixes.md (the CR-1 fix to verify)

Git range:
- Branch: main
- HEAD: 1cb45a93e9d767dfb59d35289e282f3cc5f6c557
- Base/start: 60c8625c067dfcc3a145ef6e54293ea0b6662c9d
- Commits reviewed: 3 (8c61ad5, 278d8ae, 1cb45a9)

Summary: 0 P0, 0 P1, 0 P2, 1 P3

Commands and limits:
- I read the diff and the full current `raw-editor.ts`, the regression spec added in 1cb45a9, the collection-view changes, and `documentKey`/`idOf` in `document/edit-session.ts`.
- I could not run tests in this session because the command was denied. For test results I rely on fixes.md: 327 raw-editor tests passed, and `npm run check` and `.taskcheck` passed. The parent should confirm these on HEAD.

## Status of the previous finding CR-1

CR-1 is fixed. The finding was that a reused raw editor kept another document's unapplied text. The fix is in `raw-editor.ts:188-211`:
- The follow effect now tracks `doc()` as well as `shown()`.
- It remembers the document's identity: `documentKey(doc)`, or the object itself when the document has no `_id`.
- When the identity changes, it resets the baseline and the text to the new document and clears the error and its diagnostics.
- The first run (`owner === undefined`) takes the normal path.
- A new object with the same `_id`, as after a re-query, has the same `documentKey` string, so its unapplied text is still kept, as before.
- The format is kept, which is reasonable because it is a view preference.

The guard in `apply()` that compares `documentKey` with `doc()` is unchanged, so a stale text can still never be applied to another document.

The regression spec at `raw-editor.spec.ts:390-415` covers both branches:
- a different `_id` resets the text, `dirty()`, the error and the diagnostics, and disables Apply;
- the same `_id` keeps the unapplied text, and the edit session stays unmodified.

The fix is only tracked through the `doc` input. A document without `_id` gets object identity, so a re-query would reset its text. This is harmless: such a document cannot be applied, and the collection view disables the Raw toggle for it (`collection-view.html`, `[disabled]="key(loaded) === null"`).

No regressions found:
- The new `this.doc()` read adds no extra triggers in practice, because `shown()` already depends on `doc()`.
- The `setText` call in the reset branch dispatches with the `External` annotation, so the update listener does not clear or re-set the error out of order.
- When there is no error, `showError(null)` returns early, and in that case there are no diagnostics to clear.

## Acceptance criteria (re-checked on the final revision)

1. **Component tests (toggle preserves content; syntax error at line/column; apply updates the model).**
   - `raw-editor.spec.ts` covers:
     - format round trips, unapplied text kept across the toggle, and unreadable text not switched;
     - shell and EJSON syntax errors with line/column, the diagnostic range, `aria-invalid`/`aria-describedby`, and the cursor moved to the error;
     - Apply through `DocumentEdits.edit`, including partial documents, undo/redo, a refused changed or missing `_id`, and read-only.
   - `raw-editor-collection.spec.ts` covers the integration in the collection tab, up to the Save diff.
   - `raw-text.spec.ts` covers the parse/print/describe helpers.
   - The criterion is met by the code. Its run evidence must be recorded by the parent with `tasks.py verify`.
2. **No `eval`/`new Function` in the editor's bundle path.**
   - `no-eval.spec.ts` walks the real import graph from `raw-editor/index.ts`, through CodeMirror, Lezer, core and `bson`. It has a positive control and a pattern self-test.
   - ESLint `no-eval`/`no-implied-eval`/`no-new-func` add a source-level guard.
   - The fix adds no new imports, so the graph is unchanged.

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
    - Problem: `setText` replaces the content with a normal transaction that only carries the `External` annotation. It does not set `Transaction.addToHistory.of(false)`, and it does not reset the history. So the replacement made in the new "other document" branch is recorded in CodeMirror's undo history. If the user presses Ctrl+Z in the reused editor after the list switched it to document B, the text from document A comes back, marked "Not applied". Apply then refuses it with "The _id of a document cannot be changed". No data is at risk, because the `_id` guard in `apply()` holds. But this partly brings back the CR-1 situation through the keyboard. Undo after the editor follows an edit of the same document is fine and arguably intended. The problem is the switch to another document.
    - Suggested fix: In the other-document branch, keep the replacement out of the history or start a fresh history. For example, dispatch it with `Transaction.addToHistory.of(false)` (which still leaves older entries reachable), or rebuild the state with `view.setState(...)` and the same extensions. Optionally, extend the regression spec to press undo after the switch.

## Review conclusion

No material issues found. CR-1 is fixed correctly and the fix introduces no regressions. Both acceptance criteria are met by the code and its tests. The remaining P3 (CR-2) is a minor, non-blocking edge case. Test runs could not be repeated in this review session, so the parent must record its own run evidence.

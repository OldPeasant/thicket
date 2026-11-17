# Code Review

Date: 2026-11-17

Task: raw-editor - M1: Raw editor in shell syntax and EJSON

Scope: `git diff 60c8625c..7ee020c` (the task commit). The parent named 6893d63; 7ee020c is the same change rebased. `git diff 6893d63 7ee020c` differs only in `tasks/raw-editor.md`, so the code is identical. Covers the new `packages/renderer/src/app/raw-editor/*`, `collection-view.{ts,html,css}`, `eslint.config.mjs`, `packages/renderer/package.json` / `package-lock.json` (CodeMirror 6 deps) and `docs/ARCHITECTURE.md`.

Requirements:
- tasks/raw-editor.md acceptance criteria and recorded assumptions
- SPEC.md M1 "Raw editor" (line 109-110) and §6 (no `eval`, parser only)
- docs/ARCHITECTURE.md (collection views, edit session, conventions)
- docs/QUALITY.md (report contract)
- AGENTS.md

Git range:
- Branch: main
- HEAD: 7ee020c7d4fb79817f8d6e576f36c0637ea1fdb6
- Base/start: 60c8625c067dfcc3a145ef6e54293ea0b6662c9d
- Commits reviewed: 1

Summary: 0 P0, 0 P1, 0 P2, 1 P3

Commands run (read-only):
- `cd packages/renderer && npx ng test --include='src/app/raw-editor/**/*.spec.ts'`: 3 files, 303 tests passed. This includes the per-file no-eval cases over the import graph.
- Inspected the existing build output `packages/renderer/dist` (built 2026-11-17 01:42). CodeMirror (`cm-lintRange`) is only in the lazy chunk `chunk-Cl4kdwT0.js` (~450 kB), not in `main-*.js`. Grepping that chunk for `eval(` / `new Function(` found nothing.
- `python tasks.py verify raw-editor` (listing only): both criteria are still unrecorded. The parent records them.
- I could not run ESLint in this session because the command was denied. I reviewed the `no-eval`/`no-implied-eval`/`no-new-func` block by reading it: the `files`/`ignores` scoping is correct for flat config.

Acceptance criteria assessment:
1. Component tests: covered by `raw-editor.spec.ts`:
   - toggle round trip, unapplied changes kept across the toggle, all BSON types round-tripped, unreadable text not switched;
   - shell and EJSON syntax errors with line/column, the CodeMirror diagnostic range, `aria-invalid`/`aria-describedby`, and the cursor moved to the error;
   - Apply goes through `DocumentEdits.edit`, including partial, undo/redo, refusal of a changed or missing `_id`, and read-only.

   `raw-editor-collection.spec.ts` covers the integration in the collection tab, up to the Save diff.
2. No eval: `no-eval.spec.ts` walks the real import graph from `raw-editor/index.ts`, through CodeMirror, Lezer, core and `bson`. It has a positive control (Ajv is flagged) and a pattern self-test. The ESLint rules add a source-level guard, and the built lazy chunk also has no `eval`/`new Function`.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | A reused raw editor keeps another document's unapplied text when the list's documents change**
    - File: `packages/renderer/src/app/collection/collection-view.html:285` (`@for ... track $index`), with `packages/renderer/src/app/raw-editor/raw-editor.ts:186-198`
    - Category: Correctness
    - Problem: The document list tracks `<li>` by `$index`, and the raw-editor state (`rawDocs`) is keyed by `_id` and outlives paging and re-queries. Suppose the document at index N is shown raw both before and after the page changes. For example: open Raw for doc A on page 1, go to page 2, open Raw for doc B (also at index N) and type, then go back. Angular keeps the `@if`/`@defer` view, so the same `RawEditor` instance only gets a new `doc` input. The follow effect sees `wasDirty === true` and keeps B's unapplied text, which is now shown under A's header as "Not applied". Apply is refused with "The _id of a document cannot be changed". The format and any error state carry over too.
    - Why it matters: No data is corrupted, because Apply checks the `_id` against `doc()`. But the user sees text for the wrong document and gets a confusing error. The other document's unapplied text is also silently lost.
    - Suggested fix: Tie the editor's lifetime to the document identity. Options: track the list by `key(loaded) ?? $index`; or wrap the editor in a construct keyed on the document key, such as `@for (k of [key(loaded)]; track k)`; or, in `RawEditor`, reset text, baseline and error when `documentKey(doc())` changes. Add a spec that changes `doc` to a different `_id` while the text is dirty.

## Review conclusion

No material issues found. The implementation meets both acceptance criteria with meaningful tests. The single P3 finding is a non-blocking edge case.

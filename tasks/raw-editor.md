---
title: M1: Raw editor in shell syntax and EJSON
status: done
owner: felix/agent-2
deps: [shell-syntax,bson-display]
touches: [packages/renderer/src/app/raw-editor]
prio: 2
lease_until: 
---
## Goal
Text editor for a whole document (CodeMirror 6) in shell syntax with a toggle to canonical EJSON; syntax errors with position; applying the text updates the edit session.

## Acceptance criteria
- [x] Component tests: toggle preserves content; syntax error highlighted at line/column; apply updates the model
  - verified (2026-11-17 02:01+0100 by felix/agent-2): cd packages/renderer && npx ng test --include='src/app/raw-editor/**/*.spec.ts' (jsdom, real CodeMirror 6 EditorView) -> 4 files, 331 passed: raw-editor.spec.ts format toggle (shell to EJSON and back keeps the document incl. unapplied changes, all-types fixture round trip, unreadable text not switched); syntax errors (shell error at line 3 column 6 marked with a CodeMirror lint diagnostic and .cm-lintRange-error, aria-invalid, cursor moved; EJSON error at line 3 column 10); apply (DocumentEdits.current equals the parsed text, change count, partial flag, undo/redo, _id refusal, read-only); raw-editor-collection.spec.ts Raw toggle in the collection tab, Apply, then Save sends the set diff
- [x] No `eval`/`new Function` in the bundle path used by the editor (lint rule or grep in test)
  - verified (2026-11-17 02:01+0100 by felix/agent-2): cd packages/renderer && npx ng test --include='src/app/raw-editor/no-eval.spec.ts' -> 279 passed: walks the editor's real import graph (raw-editor, core shellsyntax and bson, bson/lib/bson.mjs, @codemirror/*, @lezer/*; ESM, dynamic import, require) and greps each file for eval(, new Function(, Function(string), string timers -> no hits; control test flags Ajv's graph. Plus ESLint no-eval, no-implied-eval, no-new-func on renderer and core sources: npx eslint packages/renderer/src packages/core/src -> clean. npm run build -w packages/renderer: CodeMirror only in the lazy raw-editor chunk.

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 01:42+0100 by felix/agent-2): Raw editor lives per document in the collection tab's document list (a Raw toggle swaps the form for the editor); the page-wide Raw view stays read-only text. Apply records the text with DocumentEdits.edit (no server write); a changed or missing _id is refused at Apply.
- ASSUMPTION (2026-11-17 01:42+0100 by felix/agent-2): Errors are shown on Apply/format switch (not live while typing) and cleared when the user types; EJSON value errors (bad $oid etc.) carry no position because core's EJSON decoder has none; the EJSON syntax position is read from core's 'Invalid JSON at position N' message (no core change).
- ASSUMPTION (2026-11-17 01:42+0100 by felix/agent-2): No-eval criterion: a spec walks the editor's real import graph (renderer, core, bson, CodeMirror/Lezer; ESM/require/dynamic) and greps for eval/new Function/string timers, plus ESLint no-eval/no-implied-eval/no-new-func on renderer+core non-spec sources (codegen spec runs generated code on purpose). The editor is a lazy @defer chunk to keep CodeMirror (~450 kB) out of the initial bundle.
- done by felix/agent-2: `if [ -f package.json ]; then npm run check; else python3 tasks.py check; fi` passed in 83s on 22c8563df; criteria verified 2/2

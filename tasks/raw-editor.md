---
title: M1: Raw editor in shell syntax and EJSON
status: in_progress
owner: felix/agent-2
deps: [shell-syntax,bson-display]
touches: [packages/renderer/src/app/raw-editor]
prio: 2
lease_until: 2026-11-17T00:57:33Z
---
## Goal
Text editor for a whole document (CodeMirror 6) in shell syntax with a toggle to canonical EJSON; syntax errors with position; applying the text updates the edit session.

## Acceptance criteria
- [ ] Component tests: toggle preserves content; syntax error highlighted at line/column; apply updates the model
- [ ] No `eval`/`new Function` in the bundle path used by the editor (lint rule or grep in test)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 01:42+0100 by felix/agent-2): Raw editor lives per document in the collection tab's document list (a Raw toggle swaps the form for the editor); the page-wide Raw view stays read-only text. Apply records the text with DocumentEdits.edit (no server write); a changed or missing _id is refused at Apply.
- ASSUMPTION (2026-11-17 01:42+0100 by felix/agent-2): Errors are shown on Apply/format switch (not live while typing) and cleared when the user types; EJSON value errors (bad $oid etc.) carry no position because core's EJSON decoder has none; the EJSON syntax position is read from core's 'Invalid JSON at position N' message (no core change).
- ASSUMPTION (2026-11-17 01:42+0100 by felix/agent-2): No-eval criterion: a spec walks the editor's real import graph (renderer, core, bson, CodeMirror/Lezer; ESM/require/dynamic) and greps for eval/new Function/string timers, plus ESLint no-eval/no-implied-eval/no-new-func on renderer+core non-spec sources (codegen spec runs generated code on purpose). The editor is a lazy @defer chunk to keep CodeMirror (~450 kB) out of the initial bundle.

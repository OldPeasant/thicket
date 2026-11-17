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

# Fix Report

Date: 2026-11-16

Task: renderer-scaffold (M0: Angular renderer workspace)

Scope: current task; findings CR-1 and CR-2 from `reviews/renderer-scaffold/review.md`

## Fixed findings

### CR-1 — Root `engines` allows Node versions the new Angular toolchain rejects

Files changed:
- `package.json`
- `package-lock.json` (root package entry mirrors `engines`)
- `docs/ARCHITECTURE.md`

Problem:
The root declared `"node": ">=24 <25"`. Checked in node_modules: `@angular/core` 22.2.6 and
`@angular/build` 22.2.7 declare `^22.22.3 || ^24.15.0 || >=26.0.0`, `jsdom` 31.0.1 declares
`^22.22.2 || ^24.15.0 || >=26.0.0`. Node 24.0 to 24.14 passed the root range but not the toolchain's.

Fix:
Root range raised to `>=24.15.0 <25` (also in the lockfile's root entry so it stays in sync). The
"Install (development)" section of docs/ARCHITECTURE.md now says Node 24 LTS 24.15.0 or newer, and
the install table row reads "Node 24.15+".

Validation:
- `npm run check` (Node v24.21.0) — Pass

### CR-2 — The no-network guard misses Angular property bindings and `srcset`

Files changed:
- `packages/renderer/src/no-network.spec.ts`

Problem:
`REMOTE` did not match `[src]="'https://...'"` (binding with a quoted string literal) or
`srcset="https://..."`.

Fix:
The attribute alternative now allows an optional `]` before `=` and an optional single quote after
the optional opening quote (`\b(?:src|href)\]?\s*=\s*["']?'?`). A separate `srcset` alternative
matches a remote URL in the first or any later comma-separated candidate. Added positive cases:
`[src]` literal binding, `[attr.href]` protocol-relative binding, `srcset`, `srcset` second
candidate, `[srcset]` binding. Added negative cases: `[src]` bound to a field, `[src]` bound to a
local literal, local `srcset`. All existing positive and negative cases still pass.

Validation:
- `npm run check` (includes `ng test`: 2 files, 40 tests) — Pass

## Not fixed

None.

## Validation summary

Focused tests:
- `ng test` via `npm run check` — 2 files, 40 tests passed

Full test suite:
- `npm run check` — Pass (lint, typecheck including `ngc` strictTemplates, root vitest 4 files / 4 tests, renderer `ng test` 2 files / 40 tests)

Lint/type-check/build:
- Included in `npm run check` — Pass

`.taskcheck`:
- Pass (it runs `npm run check`)

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.

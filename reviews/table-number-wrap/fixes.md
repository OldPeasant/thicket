# Fix Report

Date: 2026-11-17

Task: table-number-wrap

Scope: current task, finding CR-1 from `reviews/table-number-wrap/review.md` (also the long-scalar edge case noted in `reviews/table-number-wrap/tests.md`), using the fix the parent worker approved.

## Fixed findings

### CR-1 — A long DBPointer value overflows its 60ch box into the next cell

Files changed:
- `packages/renderer/src/app/explorer/editable-value/editable-value.component.css`
- `packages/renderer/src/app/explorer/editable-value/editable-value.component.spec.ts`

Problem:
`.val.bson` sets `display: inline-block; max-width: 60ch`. `.val.bson.scalar` adds `white-space: nowrap`, so the text of a scalar value can no longer wrap. A scalar wider than 60ch, such as a DBPointer with a long namespace, therefore ran past its box and into the next table cell.

Fix:
Added `max-width: none` to `.val.bson.scalar`. A scalar value now widens its box and column, and the table scrolls horizontally instead of overlapping. DBPointer stays scalar, as the existing tests and the parent's instruction require. Non-scalar BSON values (regex, code, symbol, non-UUID binary) keep the 60ch cap and still wrap.

Regression tests (in `editable-value.component.spec.ts`):
- Every scalar in the existing `it.each(scalars)` table now also checks that the computed `max-width` is `none`.
- New test: a DBPointer whose display text is longer than 60 characters is scalar and has a computed `max-width` of `none`.
- Every value in the existing `it.each(wrapping)` table now checks that it still has a finite `max-width`. The browser reports the computed value in px (`390px`), not `60ch`, so the test checks for a positive value that is not `none` rather than the literal `60ch`.
- With `max-width: none` temporarily removed from the CSS, 16 tests in the editable-value spec failed. With the fix restored, they all pass.

Validation:
- `cd packages/renderer && npx ng test --include='src/app/explorer/editable-value/**/*.spec.ts' --include='src/app/explorer/json-table/**/*.spec.ts'` — Pass (2 files, 54 tests)
- Same editable-value spec without the CSS fix — Fail as expected (16 failed, 27 passed)
- `npx prettier --check` on both changed files — Pass

## Not fixed

None.

## Validation summary

Focused tests:
- `npx ng test --include='src/app/explorer/editable-value/**/*.spec.ts' --include='src/app/explorer/json-table/**/*.spec.ts'` (in packages/renderer) — 54 passed

Full test suite:
- `npm run check` via `.taskcheck` — 104 files, 3469 tests passed

Lint/type-check/build:
- `npm run check` (lint, type check, unit tests) — Pass
- `npx prettier --check` on the changed files — Pass

`.taskcheck`:
- Pass

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.

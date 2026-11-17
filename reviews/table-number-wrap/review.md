# Code Review

Date: 2026-11-17

Task: table-number-wrap - UI: numbers and short values never break mid-value in table cells

Scope: committed task changes `697cea79..HEAD`. After a rebase the task commits are beb62265 (production change and component spec) and 37266d2c (e2e test and screenshots). Their code is identical to the c5941bbd/0954df66 commits named by the parent; `git diff 0954df66..HEAD` only touches `tasks/*.md`.

Requirements:
- tasks/table-number-wrap.md (goal, 3 acceptance criteria, 2 recorded assumptions)
- SPEC.md, docs/ARCHITECTURE.md, AGENTS.md
- Parent instructions: check correctness, side effects on the form and lines layouts and on edit mode, and test quality

Git range:
- Branch: main
- HEAD: 37266d2cce1db30f5456e688cb873a06ff671da7
- Base/start: 697cea798176b184132e0850b7a78631a5c0dacb
- Commits reviewed: 2 task commits. The other commits in the range are heartbeat or assume commits that only touch `tasks/`. One uncommitted change exists (`editable-value.component.spec.ts`, probably from the test-writer). It is outside the committed scope and was not reviewed.

Summary: 0 P0, 0 P1, 0 P2, 1 P3

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | A long DBPointer value overflows its 60ch box into the next cell**
    - File: `packages/renderer/src/app/explorer/editable-value/editable-value.component.css:127` (with `editable-value.component.ts:74-89`)
    - Category: Correctness
    - Problem: `.val.bson` keeps `display: inline-block; max-width: 60ch`, and the new `.val.bson.scalar` adds `white-space: nowrap`. `scalar` returns true for every type in its `default` branch, DBPointer included. DBPointer is displayed as `DBPointer(<ref>, <24 hex>)` (`bson-value.util.ts:257`). With a namespace longer than about 23 characters, the text is wider than 60ch and can no longer wrap. The table cell sizes to the box, which is capped at 60ch, so the extra text spills over the cell border into the next column. The other scalar types stay well under 60ch (the longest is a Decimal128 at about 42 characters, then a Date with its zone).
    - Why it matters: Overlapping text in the table for a deprecated type. It is rare, but it is a visual defect this change introduced. Before, `pre-wrap` plus `overflow-wrap: anywhere` kept the text inside the box.
    - Suggested fix: Treat `dbPointer` like `regex` and `javascript` in the `scalar` switch, so it is not scalar. Another option is to drop `max-width` for `.val.bson.scalar` (`max-width: none`), so the box grows with its text.

## Review conclusion

No material issues found.

Verification notes:
- **Criterion 1:** The new `json-table.component.spec.ts` renders an orders-like collection in the `tables` layout, with nested `customer` and `items` columns. For the ObjectId, Int32, Int64, Double, Decimal128, Date and Boolean cells, it checks that `white-space` is `nowrap`, that `overflow-wrap` is not `anywhere`, and that the badge and value sit in a non-wrapping `inline-flex` host. The criterion allows this computed-style check. Most of these checks fail on the base CSS, because `.val.bson` used `pre-wrap` plus `overflow-wrap: anywhere`. The exception is the Boolean check: plain booleans already used `.val`, which has `nowrap`. I ran `npx ng test --include src/app/explorer/json-table/json-table.component.spec.ts` in packages/renderer: 11 passed.
- **Criterion 2:** The spec checks `pre-wrap`, `break-word` and that `word-break` is not `break-all` on long strings. This styling did not change in this task (`.val.str`), so the test guards against regressions rather than proving new behaviour. That is still adequate. Non-UUID binary data still wraps, and a test covers it.
- **Criterion 3:** Four PNGs are committed under reviews/table-number-wrap/: Business light and Tron dark, each unscrolled and scrolled. I looked at them. Int32 `10421`, Int64, Double, Decimal128 `149.90`, ObjectId and Date are each on one line with their badge, and the table shows a horizontal scrollbar. The scrolled shots reach the `note` column. The e2e test also measures the line boxes of every scalar value with `Range.getClientRects` (at least 84 values, no wrapped ones), which is stronger evidence than the component test.
- **Side effects:**
  - The class is only added in the read-only branch of `app-editable-value`. Edit mode (`app-bson-input` and the inputs) is unchanged.
  - The lines layout does not use `app-editable-value`, so it is unaffected.
  - In the form layout, scalars now stay on one line too. Their text is short, so nothing overflows (DBPointer aside, see CR-1).
  - Column hiding (`app-column-menu`) and the table markup are unchanged. The explorer has no column resize code (no `resiz` hits under `src/app/explorer`), so there was nothing to break.
- **Observation, not a finding:** in the screenshots, the `note` string column collapses to one word per line once the table is wider than the viewport, because `.tw` is `width: fit-content` and the table falls back to min-content widths. This meets criterion 2 (wrapping at word boundaries), and the second recorded assumption names it explicitly for human review.

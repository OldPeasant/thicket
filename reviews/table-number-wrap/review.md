# Code Review

Date: 2026-11-17

Task: table-number-wrap - UI: numbers and short values never break mid-value in table cells

Scope: round 2. The committed task changes are `git diff 887ef551..HEAD -- . ':!tasks'`. This round checks that round 1 finding CR-1 is resolved and reviews the full final change again. The task commits are 6bb0ca1b (production change and component tests), 64ae0638 (e2e test and screenshots), 1af13712 (classification tests and reports) and 57cc49ba (CR-1 fix). There are no uncommitted changes.

Requirements:
- tasks/table-number-wrap.md (goal, 3 acceptance criteria, 2 recorded assumptions)
- SPEC.md, docs/ARCHITECTURE.md, AGENTS.md
- Round 1 review (CR-1), reviews/table-number-wrap/fixes.md, and the parent's instructions for round 2

Git range:
- Branch: main
- HEAD: 57cc49ba7a70084710e5483fcc97c73522c27ce3
- Base/start: 887ef551 (`git merge-base HEAD origin/main`)
- Commits reviewed: 4

Summary: 0 P0, 0 P1, 0 P2, 0 P3

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

None.

## Round 1 finding status

- **CR-1 (P3): resolved.** A long DBPointer overflowed its 60ch box into the next cell. `.val.bson.scalar` now sets `max-width: none` (`editable-value.component.css:130-134`). Because scalar values cannot wrap, a long one now widens its box and column, and the table scrolls horizontally. Non-scalar BSON values keep the 60ch cap and keep `pre-wrap` / `overflow-wrap: anywhere`, because `.val.bson.scalar` only applies when the `scalar` class is present. The regression tests in `editable-value.component.spec.ts` check:
  - every scalar has a computed `max-width` of `none`;
  - a DBPointer whose text is longer than 60 characters has no cap;
  - every wrapping type still has a finite `max-width`.

  `fixes.md` records that 16 tests failed without the fix.

## Review conclusion

No material issues found.

Verification notes:
- **Criterion 1:** `json-table.component.spec.ts` renders an orders-like collection in the `tables` layout, with nested `customer` and `items` columns. For the ObjectId, Int32, Int64, Double, Decimal128, Date and Boolean cells, it checks:
  - the value has computed `white-space: nowrap` and is not `overflow-wrap: anywhere`;
  - the badge is `nowrap`;
  - the badge and value share an `inline-flex` host that does not wrap.

  The criterion allows this kind of `white-space` check. The CR-1 fix does not weaken it.
- **Criterion 2:** The component tests check `.val.str` for `pre-wrap`, `overflow-wrap: break-word` and a `word-break` other than `break-all`. The fix does not touch `.val.str`.
- **Criterion 3:** The four PNGs from round 1 are still committed under reviews/table-number-wrap/. The CR-1 fix only changes values wider than 60ch. No value in the seeded `orders` data is that wide (the longest scalar is a Date with its zone, about 30 characters), so the screenshots still show the final rendering. The e2e test measures the line boxes of every scalar value.
- **Classification (`scalar` getter, `editable-value.component.ts:74-89`):** It matches the first recorded assumption. Non-UUID binary, regex, code, code w/ scope, symbol and string wrap; everything else stays on one line. The class is only added in the read-only branch of the template, so edit inputs are unchanged.
- **New tests:** I read them. They check computed styles and the classification, not implementation internals. One test is named "a deprecated scalar keeps the one-line value in edit mode". It turns edit mode on with the `create` helper and checks the `scalar` and `deprecated` classes, so its name matches what it tests.
- **Limitation:** I could not re-run the focused tests in this round, because permission to run them was denied. I rely on the results recorded in `fixes.md`:
  - focused specs: 54 passed;
  - `.taskcheck`: 3469 tests passed.

  Round 1 ran the json-table spec independently: 11 passed.
- **For the parent:** `python tasks.py verify table-number-wrap` shows all three criteria still unrecorded. Record the evidence before running `done`.

# Code Review

Date: 2026-11-17

Task: table-number-wrap - UI: numbers and short values never break mid-value in table cells

Scope: round 3 (final). The committed task changes are `git diff 887ef551..25e528a9 -- . ':!tasks' ':!reviews'`. This round reviews the one code change since round 2 (57cc49ba..25e528a9, `test/e2e/table-number-wrap.e2e.ts` only) and confirms that nothing else in the task changed. The task commits are 6bb0ca1b (production change and component tests), 64ae0638 (e2e test and screenshots), 1af13712 (classification tests and reports), 57cc49ba (CR-1 fix) and 25e528a9 (e2e overflow and word-wrap checks, round 2 reports). The working tree has uncommitted changes to two screenshots (see "For the parent" below). This review covers committed changes only.

Requirements:
- tasks/table-number-wrap.md (goal, 3 acceptance criteria, 2 recorded assumptions)
- SPEC.md, docs/ARCHITECTURE.md, AGENTS.md
- Round 1 and round 2 reviews, and the parent's instructions for round 3

Git range:
- Branch: main
- HEAD: 25e528a9aee1c614c3da3dd31f399235ead32d07
- Base/start: 887ef551 (`git merge-base HEAD origin/main`)
- Commits reviewed: 5 (only 25e528a9 is new in this round)

Summary: 0 P0, 0 P1, 0 P2, 2 P3

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | The overflow check is labeled as a CR-1 regression test, but it would not have caught CR-1 and it can pass vacuously**
    - File: `test/e2e/table-number-wrap.e2e.ts:97-111, 211-212`
    - Category: Tests
    - Problem: The comment says the check covers round 1's CR-1, but CR-1 only affected scalar values longer than 60 characters, such as a long DBPointer. The seeded `orders` data has no value that long (the longest scalar is a Date of about 30 characters), so the check would have passed before the 57cc49ba fix too. Also, `overflowingScalars` skips any value without a `td` ancestor (`if (!cell) continue;`) and does not return how many values it checked. If the table markup stopped using `td`, the check would return `[]` without testing anything. The `wrappedScalars` count assertion does not prevent this, because it does not need a `td`.
    - Why it matters: Readers may believe the e2e test guards CR-1, but only the component tests in `editable-value.component.spec.ts` do. The overflow check is still useful as a general check against values spilling into the next cell.
    - Suggested fix: Return the number of values checked and assert that it is at least 12 * 7. Either reword the comment to describe a general overflow check, or seed one scalar longer than 60 characters, such as a DBPointer with a long namespace, so the check actually exercises the CR-1 case.

- [ ] **CR-2 | Layout is measured before the fonts have finished loading**
    - File: `test/e2e/table-number-wrap.e2e.ts:208-222`
    - Category: Tests
    - Problem: `wrappedScalars`, `overflowingScalars` and `stringWrap` measure line boxes before the test awaits `document.fonts.ready` (line 219). The await only happens before the screenshots. If a font is still loading during the measurement, the layout is measured with a fallback font. The new `maxLines > 1` and `splitWords` assertions depend on text width, so they are the most exposed.
    - Why it matters: This is a possible source of flakiness, or of assertions that pass against a layout the user never sees. Both runs passed, so this is not an observed failure.
    - Suggested fix: Move the `fonts.ready` await (and the short settle wait) above the first measurement.

## Round 3 diff review

- **`overflowingScalars`:** For each `.val.bson.scalar`, it compares the value's right edge with the right edge of the nearest `td`, with a 1px tolerance. In nested tables (`customer`, `items`), `closest('td')` returns the innermost cell, which is the correct one. The check does not depend on scroll position, because both rectangles are in viewport coordinates. Limitations are described in CR-1.
- **`stringWrap`:** This check is not vacuous. It asserts `count === 12`, so it finds every `note` value. It asserts `maxLines > 1`, so the string actually wraps in this layout and the split-word check is meaningful. Its split-word detection is correct: for each `\S+` token in each text node, it builds a Range and flags the token if its client rects have more than one distinct `top`. A word broken by `overflow-wrap: anywhere` or `break-all` would produce rects on two lines and be reported. A token that crosses a text-node boundary would not be detected, but the `note` value is rendered as plain text, so this does not apply here.
- **DOM typings:** The local `Rect`, `TextNode`, `El`, `Range` and `Doc` interfaces are extended minimally, in the same way as the existing file. This is consistent with the root tsconfig, which has no DOM lib.
- **Scope:** The parent reports `npm run test:e2e -- test/e2e/table-number-wrap.e2e.ts -> 2 passed`. I did not re-run it.

## Unchanged since round 2

`git diff --stat 57cc49ba..25e528a9` lists only `reviews/table-number-wrap/review.md`, `reviews/table-number-wrap/tests.md` and `test/e2e/table-number-wrap.e2e.ts`. The production code (`editable-value.component.{ts,html,css}`) and the component specs (`editable-value.component.spec.ts`, `json-table.component.spec.ts`) are byte-identical to the revision reviewed in round 2. The round 2 conclusions for them still apply:
- the classification getter matches the first recorded assumption;
- scalars are `nowrap` with `max-width: none` (round 1 CR-1, resolved);
- `.val.str` keeps word-boundary wrapping;
- criterion 3's screenshots are committed.

## Review conclusion

No material issues found.

The two P3 findings are optional test-hardening improvements. They do not block completion.

For the parent:
- The working tree has uncommitted changes to `reviews/table-number-wrap/table-number-wrap-business-light.png` and `table-number-wrap-tron-dark.png`, probably from the e2e re-run. Decide whether to commit the regenerated screenshots or restore them. If you commit them, they are the criterion 3 evidence for the final code.
- Check `python tasks.py verify table-number-wrap` and make sure all three criteria have recorded evidence before running `done`.

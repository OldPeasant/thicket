# Fix Report

Date: 2026-11-17

Task: m1-e2e - M1: End-to-end demo steps 2–7

Scope: current task; findings CR-1, CR-2 from `reviews/m1-e2e/review.md` and the step-4 filter gap
from `reviews/m1-e2e/tests.md` (coverage table), as supplied by the parent worker. Base
3882e6b4ff401fc9545f810630aaa05e309c7f5d. Only test code changed (`test/e2e/m1/demo.e2e.ts`).

## Fixed findings

### CR-1 — Step 4 sort not proven: the demo document was already first in `_id` order

Files changed:
- `test/e2e/m1/demo.e2e.ts`

Problem:
`DEMO_ID = new ObjectId()` ran at module load, before every seeded `_id`, so the demo document was
first in the default `_id` paging order and being first after the `{total: -1}` sort proved nothing.

Fix:
`DEMO_ID` is now generated inside `seed()` after the 39,999 other orders are inserted (the last
partial batch is flushed first), so it has the largest `_id`. `seed()` asserts this with the driver
(`find().sort({_id: -1}).limit(1)` must return the demo id). Step 4 checks in the Raw view that the
demo document is not on the unfiltered page 1, and after filter + sort that it is the first
document; the test-writer's "totals > 100 and descending" checks are kept. Steps 5–7 still use the
first document of page 1, which the sort makes the demo document.

Validation:
- `npm run test:e2e -- m1` — Pass (1 passed, run twice)

### TW-1 — `total: {$gt: 100}` part of the step-4 filter was not proven (tests.md coverage gap)

Files changed:
- `test/e2e/m1/demo.e2e.ts`

Problem:
With sort `{total: -1}` the first page only holds totals far above 100, so a filter that ignored
`$gt` would still pass.

Fix:
After the sort checks, the test computes the driver's
`countDocuments({status: 'open', total: {$gt: Decimal128("100")}})` and
`countDocuments({status: 'open'})`, asserts the first is smaller (so the check discriminates), clicks
"Count exactly" (`pager-count`) and expects `pager-rows` to contain
`of <count formatted en-US> documents` (observed: "1–50 of 7,500 documents"; 10,000 orders are
open). It then asserts the pager is still on page 1 ("1–50", page field 1) and that the demo
document is still the first in the raw text, so steps 5–7 start from the same state.

Validation:
- `npm run test:e2e -- m1` — Pass

### CR-2 — Step 3 and step 4 table screenshots were identical; step 2 did not show "Production"

Files changed:
- `test/e2e/m1/demo.e2e.ts`

Problem:
`step-4-table.png` was taken before any change from the step-3 state (byte-identical image), and
`step-2-connection-form.png` showed the top of the form with the Production checkbox below the fold.

Fix:
`step-4-table.png` is now taken after jumping to page 3 (rows "101–150", 50 table rows asserted).
Step 2 asserts the Production box is checked, scrolls it into view and takes an extra screenshot
`step-2-production.png`; the existing `step-2-connection-form.png` is unchanged. Screenshots go to
the default `test-results/m1`; all 9 PNGs now have distinct sha256 hashes, and the three changed or
new images were viewed (Production checked and visible; table on page 3 "101–150 of ~40,000";
filter/sort view "1–50 of 7,500 documents" with the demo document first).

Validation:
- `npm run test:e2e -- m1` — Pass
- `sha256sum test-results/m1/*.png` — 9 distinct hashes

### Checklist comment update (parent item 4)

Files changed:
- `test/e2e/m1/demo.e2e.ts`

Problem:
The checklist did not describe the new checks, and one step-2 line exceeded the line width.

Fix:
Step 2 mentions the Production screenshot; step 4 describes the demo document not being on the
default page 1, the page-3 screenshot, the return to page 1 after the query, and the exact count
against the driver's count. Comment reflowed.

Validation:
- `npx prettier --check test/e2e/m1` — Pass

## Not fixed

### CR-3 — Product defects seen in screenshots are only recorded as an assumption

Status:
Out of scope

Reason:
The review assigns this to the parent worker (filing a follow-up task with `tasks.py new`); it
requires no code change in this task and the fixer must not change TFP task state.

## Validation summary

Focused tests:
- `npm run test:e2e -- m1` — Pass (1 passed, 11.6s; run a second time: 1 passed, 11.8s)
- `npx eslint test/e2e/m1 --max-warnings 0` — Pass
- `npx prettier --check test/e2e/m1` — Pass

Full test suite:
- `npm run check` (via `.taskcheck`) — Pass (root: 64 files, 3530 tests; renderer: 80 files, 2418 tests). Full `npm run test:int` / full `npm run test:e2e` not run: only the M1 e2e file changed.

Lint/type-check/build:
- Included in `npm run check` — Pass; the e2e run rebuilt the app successfully.

`.taskcheck`:
- Pass

Remaining unresolved findings:
1 (CR-3, out of scope for the fixer; parent worker action)

Note for the parent worker: the run produces a new screenshot, `test-results/m1/step-2-production.png`,
and new content for `step-4-table.png` and `step-4-filter-sort.png`; the committed set in
`reviews/m1-e2e/` was not touched by the fixer.

## Final status

All validated findings fixed and validation passed.

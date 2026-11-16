# Fix Report

Date: 2026-11-16

Task: collection-view - M1: Collection tab: query bar, pager and result views

Scope: round 2. Finding CR-1 (P2) of `reviews/collection-view/review.md` and findings TW-3 and
TW-4 of `reviews/collection-view/tests.md`, at HEAD a13aa1f (base 71cae27). Production file:
`packages/renderer/src/app/collection/collection-results.service.ts`. `collection-view.ts` did not
need a change. Changes are uncommitted (the parent commits them). The round-1 report
(CR-1..CR-6, TW-1, TW-2) was replaced by this one. Its fixes are in commit 4a2a79a.

## Fixed findings

### CR-1 / TW-3 — Paging back from a last page of unknown position reaches page 1 misaligned, or shows "No documents match"

Files changed:
- `packages/renderer/src/app/collection/collection-results.service.ts`
- `packages/renderer/src/app/collection/collection-results.service.spec.ts`

Problem:
While the position was unknown, Previous read the rows `before` the shown page. A short answer
became page index 0 in paging-core, and the service cleared the unknown position. (a) When the
count is not a multiple of the page size, that page held, for example, rows 1-20 but was treated as
an aligned page 1. Next then read rows 21-70 but labelled them "51–100", so every later page was
offset. (b) When the count is a multiple of the page size, the answer was empty. The view then
showed "No documents match this query" for a query that matches documents. Both were confirmed in
the code at a13aa1f (`previous()` and `pageArrived`). The TW-3 service and component specs
failed.

Fix:
At the start of `pageArrived`, a `before` read that was made while the position is unknown
(`fromEndState() !== null`) and returned fewer rows than requested (none included) is not shown.
The service reads `firstPage(...)` instead: page 1 from the start, without bounds. That gives an
aligned page 1 with a known position. The shown page and its "from the end" name stay until page 1
arrives. Cancel or a failure of that read keeps the shown page, as with any read. A full `before`
answer is handled as before. Reads with a known position still use paging-core's `previousPage`
unchanged.
Spec changes: the existing spec `pages back by range all the way; a short page before a bound is
page 1` described the old behavior, where the short answer became page 1, and that behavior caused
CR-1(a). It is now `... a short page before a bound reads page 1 aligned`. It expects the re-read of
page 1 (no `before`/`after`/`skip`, limit 50) and that the shown page stays until it arrives. It
also checks the reviewer's case: Next then sends `after` row 50 and gives `firstRow` 50 at page
index 1. A new spec, `paging back from Last over a multiple of the page size never shows an empty
page`, covers case (b) for 100 documents (two pages). The test-writer's TW-3 specs (service and
component, one page of 50) were not changed and now pass.

Validation:
- `npm run test -w packages/renderer -- --include='src/app/collection/**/*.spec.ts'` — Pass (94/94)

### TW-4 — An exact count arriving while Previous/Next/jump runs from an unknown last page cancels the navigation

Files changed:
- `packages/renderer/src/app/collection/collection-results.service.ts`

Problem:
`applyCount(..., true)` always called `realign()`. While a user's page read was still running,
`fromEndState` still described the page shown before that read. `realign()` then used `load()` to
read that page again aligned, and `load()` unsubscribed the user's read. Previous, Next or a jump
was lost. Confirmed by the failing spec `an exact count answering while Previous runs from an
unknown last page keeps Previous`.

Fix:
`applyCount` calls `realign()` for an exact count only when no page read is running
(`this.find === null`). Otherwise it applies the count and updates the row numbers. `pageArrived`
already ends with `realign()`. The page the user navigated to is therefore placed once it arrives:
Previous from the last page gets pages-from-end 1 and is read again as page 24 of 25 (skip 1 150).
Next back to the last page is read again with the remainder. A jump by number already has a known
position, so it needs no further read. The existing spec `an exact count arriving during a
last-page read reads it again aligned`, and the specs where the count answers with no read
running, still pass.
Known limit: if the running read is then cancelled or fails, the shown page stays named "from the
end" with the exact count known. No re-read starts, because Cancel must not start a read. The
next navigation or count places it. This is consistent with "a cancelled read keeps the shown
page".

Validation:
- `npm run test -w packages/renderer -- --include='src/app/collection/**/*.spec.ts'` — Pass (94/94)

## Not fixed

None.

## Validation summary

Focused tests:
- `npm run test -w packages/renderer -- --include='src/app/collection/**/*.spec.ts'` — Pass: 3
  files, 94 tests (the 3 previously failing TW-3/TW-4 tests included)

Full test suite:
- `npm run check` (lint, Prettier check, type check, root Vitest, renderer `ng test`) — Pass, exit
  0: Prettier "All matched files use Prettier code style!", root Vitest 46 files / 2829 tests
  passed, renderer 55 of 55 files passed
- `npm run test:e2e -- test/e2e/collection.e2e.ts` (MongoDB fixture through Podman, built Electron
  app) — Pass: 1 passed (`filter and sort 10 000 documents, page, jump to the last page, count
  exactly`)

Lint/type-check/build:
- Part of `npm run check` — Pass

`.taskcheck`:
- Pass (`.taskcheck` runs `npm run check`; result above)

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.

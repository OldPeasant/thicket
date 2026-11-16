# Code Review

Date: 2026-11-16

Task: collection-view (M1: Collection tab: query bar, pager and result views), round 3

Scope: full task diff `37861d5..50ca032` (committed changes only; working tree clean), with focus on
the final `collection-results.service.ts`, the round-2 fix commit 50ca032, and regressions in the
paging state machine (unknown last-page position, counts, cancel, page size).

Requirements:
- tasks/collection-view.md acceptance criteria and recorded assumptions
- SPEC.md M1 Browsing (collection view, paging, result views)
- docs/ARCHITECTURE.md "Collection tab" (added by this task); paging-core contract
  (packages/core/src/paging/state.ts)
- AGENTS.md, docs/QUALITY.md (report contract)
- Round-2 review (previous version of this file), reviews/collection-view/tests.md (TW-3, TW-4),
  reviews/collection-view/fixes.md

Git range:
- Branch: main
- HEAD: 50ca032c06c69fe907f83292f9f2807afa487043
- Base/start: 37861d5742a384e7ee1663a4e76509cbb87c0a91 (origin/main, merge base)
- Commits reviewed: 8 (09f23c6, d7261c4, 2ad3606, 9931111, 3e0c46f, ffc1990, aebff7d, 50ca032)

Files read in full this round: collection-results.service.ts, collection-view.ts, paging-core
state.ts, api.service.ts (to confirm `stream` never completes synchronously, so `this.find` is
reliable as "a read is running"), the 50ca032 diff, the service spec "last page without a count" /
"estimated count" sections, the ARCHITECTURE.md diff, and the spec test lists.

Summary: 0 P0, 0 P1, 0 P2, 1 P3

Round-2 findings, checked in the current code:
- Round-2 CR-1 (review.md) resolved. `pageArrived` (collection-results.service.ts:346-352) drops a
  `before` answer made while the position is unknown that is shorter than requested (including
  empty) and reads `firstPage(...)` instead. Traced both cases:
  (a) 120 documents, size 50: Last shows 71-120 (from-end 0), Previous 21-70 (from-end 1), Previous
  gets 1-20, which is not shown; page 1 (1-50) is read, arrives with `pageIndex` 0, and
  `fromEndState` becomes `null` because the request has no bound (line 383 needs `after`/`before`).
  Next then sends `after` row 50 with `firstRow` 50. Covered by the spec at service spec line 583.
  (b) 100 documents: Previous from 1-50 sends `before` row 1, the empty answer is not shown, and
  page 1 is read again. "No documents match" can no longer appear. Covered by the spec at line 620
  and the component spec at line 626.
  The re-read cannot loop (`firstPage` has no bound). Cancel or failure during it keeps the shown
  page through the normal `load` paths. The condition reads `fromEndState` at arrival. That is
  safe because only `pageArrived` sets it, and there is only one read at a time.
- TW-4 (tests.md) resolved. `applyCount` (line 282) realigns on an exact count only when no read
  runs. Otherwise `pageArrived` realigns when the user's read arrives (line 394). Traced Previous
  (full answer, from-end 1, then a skip read of page 24 of 25), Next back to the last page (from-end
  0, then a remainder read), a short Previous (re-read of page 1, no realign needed), and a jump
  (`fromEnd` becomes `null`). The spec at service spec line 795 covers Previous.
- TW-3 specs are unchanged and pass according to fixes.md. The spec renamed at line 583 now asserts
  the aligned behavior, not the old misaligned one. That rename is a correct change of expected
  behavior, not a weakened test.

Regression checks with no finding: setPageSize from an unknown position (firstPage, so `fromEnd`
is cleared on arrival); a user limit (fromEnd reads become skip reads in `clipToLimit`, so
`fromEndState` cannot be set and the new branch is not reached); skip mode (`previous()` takes the
`before` path only in range mode, and Last counts first); an estimate (only `updateFirstRow`, the
view hides `firstRow` while the position is unknown, html:274); a superseded count or read
(generations unchanged by the fix); and the Last-after-count flow (`lastAfterCount` is not affected
by the new early return, because a fromEnd position cannot exist in skip mode or with a limit).

Evidence note (not a finding): all three acceptance criteria in tasks/collection-view.md are still
unticked. The parent must record them with `tasks.py verify` before `done`. Criterion 2 needs the
e2e run against the 10 000-document fixture that fixes.md reports.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | An exact count that arrives during a read, which is then cancelled or fails, leaves the page named "from the end", contrary to the documented behavior**
    - File: `packages/renderer/src/app/collection/collection-results.service.ts:282`
    - Category: Quality
    - Problem: when the exact count arrives while a page read is running, `applyCount` does not
      call `realign()`. It relies on `pageArrived` to do it. If that read is then cancelled
      (`cancel()`, lines 226-245) or fails (error handler, lines 335-340), nothing realigns. The
      shown page keeps `pagesFromEnd` set while the exact count is known. The pager then shows
      "Last 50" (or "N pages before the last") with an exact total, and the jump field stays
      empty. `docs/ARCHITECTURE.md` ("once counted exactly the page is read again aligned") and
      the comment at collection-view.ts:153-156 say otherwise. fixes.md records this as a known
      limit. Navigation still works correctly from that state, because Previous, Next, a jump and
      Last all place the page.
    - Why it matters: the pager shows a mixed state. The documentation describes a guarantee that
      does not hold on this path.
    - Suggested fix: the smallest fix is to state the exception in the ARCHITECTURE.md bullet and
      the view comment. Another option is to realign in the read's error handler only, and not on
      Cancel, which must not start a read. A short service spec for the cancel case would pin
      down whichever behavior is chosen.

## Review conclusion

No material issues found.

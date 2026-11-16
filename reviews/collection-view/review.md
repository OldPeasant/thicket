# Code Review

Date: 2026-11-16

Task: collection-view (M1: Collection tab: query bar, pager and result views), round 2

Scope: task diff `71cae27..HEAD` (committed changes only), focus on the final code after the fixer
commit, and the round-1 findings CR-1..CR-6 against `reviews/collection-view/fixes.md`.

Requirements:
- tasks/collection-view.md acceptance criteria and recorded assumptions
- SPEC.md M1 Browsing (collection view, paging, result views)
- docs/ARCHITECTURE.md "Collection tab"; paging-core contract (packages/core/src/paging/state.ts)
- AGENTS.md, docs/QUALITY.md (report contract)
- Round-1 review (previous version of this file) and reviews/collection-view/fixes.md

Git range:
- Branch: main
- HEAD: 4a2a79ae7189c8599727c5ad33402d81f4dbb693
- Base/start: 71cae27070db670e50570be2d61c938826b9016f
- Commits reviewed: 6 (152a8c6, cff8792, 49f01f0, 233cea5, 213c021, 4a2a79a)

Scope note: the parent named commits 78bdc38..43c756d. The reflog (`.git/logs/HEAD`) shows these were
rebased onto 71cae27 right afterwards, with the same subjects, as 152a8c6..4a2a79a. The current HEAD
is 4a2a79a, and that is what this review covers. Bash was not available to this reviewer, so
`git diff` could not be run. Instead, the final versions of the materially changed files were read in
full: collection-results.service.ts, collection-results.service.spec.ts, collection-view.ts,
collection-view.html, and paging-core state.ts for context. The CSS, query.util.ts, the component
spec, the e2e test and the docs were not re-read in this round. The fixer reports no CSS change.

Summary: 0 P0, 0 P1, 1 P2, 0 P3

Round-1 findings, checked in the current code:
- Round-1 CR-1 resolved. `previous()` (collection-results.service.ts:123-140) builds a `before`
  request from `page.first` while the position is unknown. `jump()` (166-173) and `realign()`
  (288-296) call `jumpToPage` with `page: null`, so they never take the neighbour shortcuts. Covered
  by the specs at service spec lines 506-576.
- Round-1 CR-2 resolved for the last page itself. In `pageArrived` (361-372), a `fromEnd` page is
  aligned only when the request was sized from an exact count. `applyCount` with an estimate no
  longer places it (273-281). `positionUnknown` is `pagesFromEnd() !== null`. Specs at lines 489-504
  and 578-621 cover this. CR-1 of this round describes a remaining mislabel on the way back to page 1.
- Round-1 CR-3 resolved. An empty page with `pageIndex > 0` or an unknown position gets the "result
  ends before it" text (collection-view.html:246-256). A page beyond the limit sets a notice and
  returns false (service 312-319), and the view resets the field.
- Round-1 CR-4 resolved. `setPageSize` sends a locally computed request and applies the size in
  `pageArrived`. The specs at lines 699-736 cover cancel, failure and limit.
- Round-1 CR-5 resolved. The view's `cancel()` focuses `#runButton` (collection-view.ts:271-274).
- Round-1 CR-6 was already fixed in commit 233cea5 (rebased 595cc83), as fixes.md says.

Evidence note (not a finding): all three acceptance criteria in tasks/collection-view.md are still
unticked. The parent must record them with `tasks.py verify` before `done`.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | Paging back from a last page of unknown position reaches page 1 misaligned, or ends on an empty "No documents match" page**
    - File: `packages/renderer/src/app/collection/collection-results.service.ts:127`
    - Category: Correctness
    - Problem: while the position is unknown, Previous sends `before: page.first` with a
      placeholder index of at least 1 (lines 127-137). When the user pages back to the start,
      one of two things happens:
      (a) The count is not a multiple of the page size. The final `before` read comes back short.
      paging-core makes it page index 0 (state.ts:275), and `pageArrived` clears `fromEndState`
      (line 373), so the page counts as aligned. Example: 120 matching documents, page size 50,
      Last then Previous twice. This is the spec at service spec line 521. Page 1 holds rows 1-20.
      Next sends `after` row 20 and reads rows 21-70, but `firstRow` is `1 * 50`, so the pager shows
      "51–100" and the document list numbers them from 51. Every later page is off by 30 rows. With
      an estimate (1 234 documents), the last page reached this way is shown as "1,201–1,250 of
      ~1,234". That is the same symptom round-1 CR-2 described, reached by a different path.
      (b) The count is a multiple of the page size, for example a filter matching 100 documents.
      Last shows rows 51-100. Previous shows rows 1-50, which is a full page, so the placeholder
      index stays 1 and Previous and First stay enabled. Previous again sends `before` row 1. It
      returns 0 rows, which becomes page index 0 with an empty page. Because `emptyPastStart` is
      false (collection-view.ts:159-161), the view shows "No documents match this query. Change the
      filter or press Reset…" for a query that matches 100 documents. Previous is then disabled.
    - Why it matters: SPEC.md Paging requires correct first/previous/next navigation. The common
      filtered flow (Last, then page back) ends with wrong row numbers, or with a message that
      wrongly says the query matches nothing. The spec at line 521 stops right after the short
      page, so neither case is covered.
    - Suggested fix: when a `before` read made while the position is unknown comes back short
      (including empty), do not keep it as page 1. Read `firstPage` instead, which gives an aligned
      page 1 with a known position; the `fromEnd`/placeholder logic can stay as it is. Add specs:
      after the short page in the line-521 scenario, Next gives `firstRow` 50 with rows 51-100; and
      with exactly 100 documents, paging back from Last never shows an empty page.

## P3 Low

None.

## Review conclusion

Material issues found; fix before completing the task.

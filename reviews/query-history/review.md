# Code Review

Date: 2026-11-17

Task: query-history - M1: Query history and favorites

Scope: re-review after fixes, final code at e3701a6. Requested range `git diff fa76101..e3701a6 -- . ':!tasks' ':!reviews'`. That range also contains commits of other tasks merged from main (readme, conflict-partial-docs: `README.md`, `docs/user/*`, `conflict-view*`, `document-actions.service*`); they are not part of this task and were not reviewed. Reviewed: the query-history commits 3045006 (contract), d7f5204 (store), 46e4aef (dropdown), 47573ce (tests), e3701a6 (fixes TW-1, CR-1..CR-4), with the fix commit read line by line and the changed files read in full.

Requirements:
- tasks/query-history.md acceptance criteria and recorded assumptions
- SPEC.md sections 3, 5, 6; docs/ARCHITECTURE.md; docs/QUALITY.md; AGENTS.md
- Earlier reports: reviews/query-history/review.md (CR-1..CR-4, previous revision), tests.md (TW-1), fixes.md

Git range:
- Branch: main
- HEAD: e3701a6ff6705783d6312f72dfd07f3d2ab05b58
- Base/start: fa76101757695f9e1a2be5acdb8940ec705749ed
- Commits reviewed: 5 (query-history commits in the range; other tasks' commits excluded)
- Uncommitted changes: none

Summary: 0 P0, 0 P1, 0 P2, 0 P3

## Commands run

- `npx vitest run apps/desktop/src/history packages/contract/src apps/desktop/src/main/handlers.spec.ts` -> 7 files, 859 tests passed
- `cd packages/renderer && npx ng test --watch=false --include src/app/collection` -> 7 files, 269 tests passed
- `npx eslint --max-warnings 0 apps/desktop/src/history packages/renderer/src/app/collection/history` -> clean
- `npx prettier --check apps/desktop/src/history packages/renderer/src/app/collection/history` -> clean
- Read-only inspection: `git show e3701a6`, `git log`, `grep`, full reads of store.ts, handlers.ts, query-history.service.ts, query-history-menu.ts/.html, contract history.ts

## Acceptance criteria check

1. Unit tests for the store (limit, dedupe, per collection): `apps/desktop/src/history/store.spec.ts` covers limit (custom and default), dedupe after trimming (moved to top), separation per collection and profile, plus persistence, corrupt/unknown-field files and serialized ordering. Met.
2. Component test (run -> appears in history; save favorite; re-run fills the query bar): `packages/renderer/src/app/collection/history/query-history.spec.ts` drives the real `CollectionView` through these flows with a fake bridge. Met.

## Verification of the fixes

- TW-1 (stale `history.list` overwriting a newer `history.add`): fixed in two places. Main: `HistoryStore.list` reads entries and favorites in one serialized operation, so main answers in request order (`store.spec.ts` "answers history.list from the state before an add sent after it"). Renderer: each request takes `seq = ++this.sent` synchronously before `api.request` is called, so the numbers follow send order; `setEntries`/`setFavorites` drop an answer only for the list that already shows a newer answer, so a `history.list` answer can still apply its entries while its favorites are dropped (and the reverse). Failed requests do not advance the counters. After a collection switch, the target check in `call` still drops answers for the old collection, and `load` does not need to reset the counters because they only increase. No regression found.
- CR-1 (focus): `pick()` focuses the toggle, which stays in the DOM, before emitting `apply`. `remove()` waits for the delete and returns early if it failed (favorite still listed) or the panel was closed; otherwise `afterNextRender` focuses the favorite at the same index, the previous one when the last was removed, or the name field when none is left (`buttons[-1]` is `undefined`, so the `??` fallback is correct). Covered by three component tests, including the failed-delete case.
- CR-2: `aria-haspopup` removed; `aria-expanded` + `aria-controls` kept. Covered by a test.
- CR-3 (outside press): `(document:pointerdown)` host listener, which Angular removes on destroy. It does nothing while the panel is closed and ignores targets inside the host, so the toggle's own pointerdown does not race with its click toggle. Covered by a test of inside, outside and reopen.
- CR-4 (lenient parsing): `storedQuery = z.object(savedQuerySchema.shape)` keeps the field rules but strips unknown keys (zod 4), and is used only for files; contract params stay strict. Unknown fields are dropped on the next write, which the class doc states. Covered by a test that checks no `.corrupt-*` file is created.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

None open. Status of the findings from the earlier review:

- [x] **CR-1 | Keyboard focus is lost after picking an entry or deleting a favorite**: fixed in e3701a6 (`query-history-menu.ts:98-101`, `:122-136`), verified.
- [x] **CR-2 | `aria-haspopup="true"` announces a menu that is not a menu**: fixed in e3701a6 (`query-history-menu.html:1-11`), verified.
- [x] **CR-3 | Panel only closes via the toggle, Escape or a pick**: fixed in e3701a6 (`query-history-menu.ts:43-46`, `:90-96`), verified.
- [x] **CR-4 | Strict query schema makes a newer-layout file "corrupt" and moves it aside**: fixed in e3701a6 (`apps/desktop/src/history/store.ts:45-49`), verified.
- [x] **TW-1 (tests.md) | A late `history.list` answer overwrites a newer `history.add` result**: fixed in e3701a6 (`apps/desktop/src/history/store.ts:169-175`, `handlers.ts:13-19`, `query-history.service.ts:30-118`), verified.

## Review conclusion

No material issues found. Both acceptance criteria are implemented and covered by passing tests. The fixes for TW-1 and CR-1 to CR-4 are correct, and I found no regressions in the request sequencing, the outside-pointerdown listener, focus handling or the lenient file parsing.

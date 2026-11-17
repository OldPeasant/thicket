# Code Review

Date: 2026-11-17

Task: query-history - M1: Query history and favorites

Scope: committed changes `git diff fa76101..HEAD -- . ':!tasks' ':!reviews'` (commits d7a046d, c03b0ca, ee1d4f6). An uncommitted change to `apps/desktop/src/history/store.spec.ts` was present in the working tree at review time (presumably the concurrent test-writer) and was not reviewed.

Requirements:
- tasks/query-history.md acceptance criteria and recorded assumptions (`python tasks.py assumptions`)
- SPEC.md section 3 (collection view: history of recent queries per collection, favorites), section 5 (`history/`, `favorites.json`), section 6 (security)
- docs/ARCHITECTURE.md (main-process stores, contract routing, the new query-history bullet)
- docs/QUALITY.md, AGENTS.md

Git range:
- Branch: main
- HEAD: ee1d4f64afa5240c5e30c96273022633c431323f
- Base/start: fa76101757695f9e1a2be5acdb8940ec705749ed
- Commits reviewed: 3

Summary: 0 P0, 0 P1, 0 P2, 4 P3

## Commands run

- `npx vitest run apps/desktop/src/history packages/contract/src` -> 5 files, 803 tests passed
- `cd packages/renderer && npx ng test --watch=false --include src/app/collection/history/query-history.spec.ts` -> 1 file, 9 tests passed
- Read-only inspection: `git diff`, `git log`, `grep` over the changed files and their neighbours.

## Acceptance criteria check

1. Unit tests for the store (limit, dedupe, per collection): `apps/desktop/src/history/store.spec.ts` covers limit (custom and default 50), dedupe by trimmed fields (move to top, every field distinguishes), per collection/profile separation, unambiguous hashed file names, persistence, corrupt files moved aside, wrong-collection file ignored, serialized writes, failed write keeps state, unreadable file fails, favorites per collection with case-insensitive replace and delete. Met.
2. Component test (run -> appears in history; save favorite; re-run fills the query bar): `packages/renderer/src/app/collection/history/query-history.spec.ts` drives the real `CollectionView` with a fake bridge: a run is sent to `history.add` and listed, picking an entry fills filter/sort/limit and runs `docs.find`; saving a favorite sends the trimmed name and bar text, and picking it refills the bar and runs it. Met.

Security: the renderer only sends `profileId/db/coll` and query text; file names are a SHA-256 of `[profileId, db, coll]` computed in main (`historyFileName`), so no renderer-controlled path segments reach the file system. No secrets are stored or logged; logs contain file paths only. Contract params are strict objects with length limits. Writes are atomic (tmp + rename) and serialized; a hash collision or copied file is guarded by comparing the stored key. Stale answers after a tab switches collection are dropped in `QueryHistory.call` via the target identity.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | Keyboard focus is lost after picking an entry or deleting a favorite**
    - File: `packages/renderer/src/app/collection/history/query-history-menu.ts:80`
    - Category: Quality
    - Problem: `pick()` closes the panel, which removes the focused pick button from the DOM, but does not move focus (unlike `closeAndFocus` for Escape). Likewise `remove()` (line 102) deletes the list item holding the focused `×` button. Focus falls back to `document.body`.
    - Why it matters: keyboard and screen-reader users lose their place in the query bar after the main action of the dropdown and must tab in from the start of the page.
    - Suggested fix: after `pick`, focus the toggle button (or the Run button / filter field); after deleting a favorite, focus the next favorite, the name field or the toggle.

- [ ] **CR-2 | `aria-haspopup="true"` announces a menu that is not a menu**
    - File: `packages/renderer/src/app/collection/history/query-history-menu.html:7`
    - Category: Quality
    - Problem: `aria-haspopup="true"` is equivalent to `"menu"`, but the controlled element is a `role="region"` panel with a form field and buttons, not a `role="menu"` with menu items.
    - Why it matters: assistive technology announces a menu and may expect menu keyboard semantics (arrow keys) that the panel does not provide.
    - Suggested fix: drop `aria-haspopup` (the `aria-expanded` + `aria-controls` disclosure pattern already describes the button), or use `"dialog"` if the panel is treated as a non-modal dialog.

- [ ] **CR-3 | Panel only closes via the toggle, Escape or a pick**
    - File: `packages/renderer/src/app/collection/history/query-history-menu.ts:40`
    - Category: Quality
    - Problem: the panel is an absolutely positioned overlay (`query-history-menu.css:42-51`, `z-index: 20`, up to 60vh) with no outside-click or focus-out handling; clicking into the query bar fields or the results leaves it open over the results.
    - Why it matters: a dropdown that stays over the result table after the user moves on is unexpected and hides content until the user goes back to the History button.
    - Suggested fix: close on a pointerdown outside the host element (and optionally on focus leaving the host), keeping Escape as is.

- [ ] **CR-4 | Strict query schema makes a newer-layout file "corrupt" and moves it aside**
    - File: `apps/desktop/src/history/store.ts:50` and `apps/desktop/src/history/store.ts:59`
    - Category: Correctness
    - Problem: the file schemas reuse the contract's `savedQuery`, a `z.strictObject`. The `version` check deliberately accepts newer versions (`min(1)`), like `SettingsStore` which reads newer files leniently, but a later version that adds one query field (e.g. `hint`) fails the strict parse, so `readJson` renames the whole `favorites.json` or history file to `.corrupt-<time>` and the store continues empty.
    - Why it matters: running an older build after a newer one hides all favorites of every collection (they are only recoverable by hand from the backup file), which contradicts the lenient-version intent shown by the `version` check.
    - Suggested fix: parse stored queries with a non-strict object (unknown keys stripped) in the file schemas, keeping the strict schema for contract params; or refuse to touch files whose `version` is greater than `HISTORY_VERSION`.

## Review conclusion

No material issues found. Both acceptance criteria are implemented and covered by tests that pass; the four P3 findings are non-blocking accessibility/UX and forward-compatibility improvements.

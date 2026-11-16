# Code Review

Date: 2026-11-16

Task: safety-ui - M1: Safety UI: production accent, read-only state, confirm dialog service

Scope: `git diff 95e744c HEAD -- packages test docs` at reviewed revision 24cd7c440cebf708e410319fdbb0d7be287b5520 (final round, after the fixes for CR-1..CR-6 of the first round). The fix commit was also reviewed on its own (`git diff 9f22957 24cd7c4`). Committed changes only; one uncommitted working-tree change was found and is reported as CR-1.

Requirements:
- tasks/safety-ui.md (goal, three acceptance criteria, four recorded assumptions)
- SPEC.md M1 "Safety" (confirm dialog showing the operation, `confirmed` flag, type-to-confirm over 1 000 documents, production accent, read-only)
- docs/ARCHITECTURE.md "Write safety in the renderer"
- docs/QUALITY.md (report contract)
- reviews/safety-ui/fixes.md (claimed fixes for the first round)

Git range:
- Branch: main
- HEAD: 24cd7c440cebf708e410319fdbb0d7be287b5520
- Base/start: 95e744c3e2dacf3953e50db9852e363213a1ab56 (`git merge-base HEAD origin/main`)
- Commits reviewed: 4 (ecfa408 WriteGuard, confirm dialog, read-only control, production accent; 971aea8 dev page, e2e screenshots, architecture notes; 9f22957 test-writer tests and first review; 24cd7c4 fixes for CR-1..CR-6)

Summary: 0 P0, 0 P1, 1 P2, 1 P3

## Earlier round (reviewed revision b98c2fb, same code as ecfa408 + 971aea8 after rebase)

| Finding | Title | Status at 24cd7c4 |
| --- | --- | --- |
| CR-1 (P2) | Dialog not keyboard-modal | Fixed in code: `AppShell` sets `inert` on sidebar, splitter, `.work` and status bar while `ConfirmService.current()` is set and still consumes Ctrl/Cmd+W, Ctrl+Tab, Ctrl+PageUp/PageDown without touching tabs; the dialog has `tabindex="-1"`, the backdrop `mousedown` keeps or restores focus in it, a `document:keydown` fallback handles Escape/Tab from outside, and the Tab trap ignores Ctrl/Meta/Alt+Tab. AppShell regression test committed; the dialog-level regression tests are not committed (see new CR-1). |
| CR-2 (P3) | `aria-label` replaced the description | Fixed (`aria-label` removed from `#confirm-operation`); its test is not committed (see new CR-1). |
| CR-3 (P3) | Aborted write left dialog open | Fixed: `ConfirmService.confirm(request, signal?)` withdraws the entry on abort (shown or waiting), resolves `false`, resets the typed text, and detaches the listener on answer (`once: true` covers the abort path, so no listener leak). `WriteGuard.approve` passes its signal. Tests committed. |
| CR-4 (P3) | `agg.run` / `agg.createView` options missing | Fixed with tests. |
| CR-5 (P3) | `WriteControl` removed host `title` | Fixed via a `title` input; static and bound titles tested. |
| CR-6 (P3) | Splitter comment misplaced | Fixed. |

What was checked in this round and holds:
- Shortcut handling while modal: Escape inside the dialog stops propagation, so neither `AppShell` nor the explorer's `document:keydown.escape` listener sees it; all other keys from inside the dialog are ignored by `onDocumentKeydown` (`dialog.contains(target)`); `AppShell` consumes the tab shortcuts but leaves tabs alone while `modal()` is true. No other global keydown listeners exist in the renderer besides the explorer column menu (inside the inert `.work`).
- Focus return after close: the inert attributes are removed during change detection, before `afterRenderEffect` restores focus, so the return target is focusable again.
- `ConfirmService` queue: withdrawing index 0 shows the next request and resets `typed`; withdrawing a waiting entry leaves the shown one untouched; an abort after an answer is a no-op; an already aborted signal never enqueues. `answer(true)` still cannot bypass type-to-confirm.
- `WriteGuard`: read-only refusal before any request, caller `confirmed` stripped, `confirmed: true` only after confirmation and when not aborted; unchanged apart from passing the signal.
- `describeWrite` option output matches the contract field names for `agg.run` / `agg.createView`.
- Focused tests run by this reviewer: `cd packages/renderer && npx ng test --include='src/app/safety/**/*.spec.ts' --include='src/app/layout/**/*.spec.ts' --watch=false` -> 12 files, 232 tests passed (working tree, including the uncommitted spec change).
- Acceptance-criterion evidence is not yet recorded (`python tasks.py verify safety-ui` shows #1-#3 unticked); that is the parent worker's next step, not a finding. The 12 screenshots in `reviews/safety-ui/screenshots/` predate the fix commit; the fix only adds `.dialog:focus { outline: none }` and does not affect the accent.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | Dialog regression tests for the CR-1/CR-2 fixes are not in the reviewed revision**
    - File: `packages/renderer/src/app/safety/confirm-dialog.spec.ts:279-395` (working tree only; `git status` shows the file modified, `git diff --stat` +118 lines against HEAD)
    - Category: Tests
    - Problem: `reviews/safety-ui/fixes.md` lists `confirm-dialog.spec.ts` as changed and describes tests for backdrop click plus Escape, backdrop refocus, Tab from `<body>`, no handling without a request, Ctrl+Tab not trapped and the accessible description, but commit 24cd7c4 does not contain any change to that file (`git diff 9f22957 24cd7c4 --stat` omits it). The tests exist only as an uncommitted working-tree change (they pass, see above). At the reviewed revision, the new `onDocumentKeydown`, `onBackdropMousedown`, the modifier check in the Tab trap and the removed `aria-label` have no committed test; only the AppShell-level inert/shortcut test is committed.
    - Why it matters: The fix report and the quality evidence claim coverage the repository does not hold; a later change can regress the modal focus handling unnoticed, and `done` would ship the code without these tests.
    - Suggested fix: Commit the `confirm-dialog.spec.ts` changes (after any in-progress test-writer run finishes) together with the review evidence. Test-only changes keep this review fresh under docs/QUALITY.md "Freshness".

## P3 Low

- [ ] **CR-2 | ARCHITECTURE.md still documents the old `ConfirmService.confirm` signature and omits the modal behavior**
    - File: `docs/ARCHITECTURE.md:293-294` (section "Write safety in the renderer")
    - Category: Quality
    - Problem: The section says `ConfirmService.confirm(request) → Promise<boolean>`; since 24cd7c4 it is `confirm(request, signal?)`, where aborting the signal withdraws the request and closes the dialog, and `AppShell` makes the rest of the window inert while a request is shown. Neither is mentioned.
    - Why it matters: Later write UIs that call `ConfirmService` directly (not via `WriteGuard`) would not know to pass their abort signal, reintroducing the stale-dialog problem fixed by the earlier CR-3.
    - Suggested fix: Update the line to `confirm(request, signal?)` with one sentence on withdrawal on abort and the inert background.

## Review conclusion

Material issues found; fix before completing the task. The code at 24cd7c4 correctly fixes all six earlier findings and introduces no new correctness, focus or listener-leak problems that could be verified; the core safety guarantees still hold and are tested. CR-1 (commit the dialog regression tests the fix report claims) should be resolved before `done`; CR-2 is a small documentation update.

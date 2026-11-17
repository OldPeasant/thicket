# Code Review

Date: 2026-11-17

Task: shell-ui - M4: mongosh console (round 3, final revision 40db3c6)

Scope: `git diff 944f76d..40db3c6` excluding `tasks/` and `reviews/` (commits 977cdd1, edecbd7, 317fb7c, e962c42, 40db3c6). Round 3 focuses on the delta `e962c42..40db3c6`. Only committed changes; the working tree is clean.

Requirements:
- tasks/shell-ui.md acceptance criteria and recorded assumptions (history kept in memory, one tab per connection, Enter/Shift+Enter/Ctrl+Enter, one plain-text switch)
- SPEC.md demo step 11, M0 theme tokens, M4 "Shell"
- docs/ARCHITECTURE.md, docs/mongosh.md, packages/contract/src/shell.ts
- packages/backend/src/shell/split.ts (used to check the regex heuristic, not reviewed)
- AGENTS.md, docs/QUALITY.md
- Round 1 review (CR-1..CR-5), reviews/shell-ui/fixes.md, round 2 review (CR-6)

Git range:
- Branch: main
- HEAD: 40db3c69762f42c587ca4d6996e9c8dcfe5e36f9
- Base/start: 944f76ddb91c9c188a353bd9944070a1ddc4c99d
- Commits reviewed: 5

Summary: 0 P0, 0 P1, 0 P2, 1 P3 (CR-6, carried over from round 2, open and accepted as non-blocking)

## Round 3: delta e962c42..40db3c6

Scope check:
- `git diff e962c42 40db3c6 --stat` lists only `packages/renderer/src/app/console/console-input.spec.ts` (+11), `packages/renderer/src/app/console/shell-console.spec.ts` (+137/-1), `reviews/shell-ui/review.md` and `reviews/shell-ui/tests.md`. No production code, configuration, dependency or e2e file changed.
- `git diff 944f76d..40db3c6 --stat -- . ':!tasks' ':!reviews'` lists the same 14 files as the round 2 scope. Only the two spec files above differ from the round 2 revision e962c42. So the production code reviewed in round 2 is the final code.

New tests, checked against the current production code:
- `console-input.spec.ts:103-113`: ten more `isInputComplete` table rows for regex literals (escaped `]` in a class, flags followed by a bracket, a line comment after a regex, an unterminated regex at a line end and at the end of the input, whitespace, line breaks and block comments before a regex, a regex after `[`, division after an identifier, division then a line comment). The expected values match the documented behavior in `console-input.ts` (an unterminated literal ends at its line, or at the end of the input and is sent to mongosh).
- `shell-console.spec.ts:363-380`: an open failure shows the `role="alert"` block outside the transcript, with no "opening" note and an empty live region. A non-NOT_FOUND run error is announced as `Run failed: ...` and keeps the session (no `shell-failed`). Both match `open()` (`shell-console.ts:225-228`) and the stream error path (`:258-268`).
- `shell-console.spec.ts:677-740`: completion list closes on a `select` event that moves the selection away from the requested caret (`onCaret`, `:446-453`). A mousedown on an option prevents the default (the input keeps focus, `shell-console.html:141`) and applies the completion at the requested caret, not at a moved one (`choose`, `:430-440`). Enter with a changed input text closes the list without applying or running (`choose`, `:435-437`). Escape drops `aria-controls` and `aria-activedescendant`, and a later caret event with no list does nothing.
- `shell-console.spec.ts:854-895`: direct unit tests of the exported `announce()` (`shell-console.ts:100-110`): a stopped run, the first error after a result, the 200-character limit at the boundary and above it, and the result type or plain "Run finished". `announce`, `Run` and `ShownOutput` were already exported at e962c42.

Assertions test observable behavior (DOM, attributes, input value, caret, eval requests), not internals. The mocks are the project's `FakeThicketBridge`, used the same way as the existing specs.

Flakiness: the "moved without a caret event" test calls `setSelectionRange(1, 1)`. jsdom queues a `select` event as a task for this (`HTMLTextAreaElement-impl.js` `_dispatchSelectEvent`). The `mousedown` is dispatched synchronously before that task runs, so `choose()` always runs first, and the late `select` hits `onCaret` with no open list and does nothing. The result is deterministic. No timers, real time or ordering across tests are involved.

Run: `npx ng test --watch=false --include 'src/app/console/**/*.spec.ts'` in `packages/renderer` -> 2 files, 105 passed. Run 4 times in total, 105 passed each time.

No new findings in round 3.

## Status of round 1 findings (from round 2)

- **CR-1 (P2), completion applied at a moved caret: fixed.** `complete()` stores the requested `{ code, cursor }` in `completionAt` (`shell-console.ts:413`). `choose()` applies the completion at that stored cursor and closes the list when the text changed (`:430-440`). `onCaret` runs on `keyup`, `click` and `select` (`shell-console.html:120-122`) and closes the list when the caret, the selection or the text differs (`:446-453`). `closeCompletions()` clears the stored position. The single-completion path also uses the requested cursor (`:409`). The keys the list doesn't handle (ArrowLeft/Right, Home, End) fall through and then close the list on keyup. A caret move with no event still gives the correct text. The specs at `shell-console.spec.ts:598-648` cover keyup, click, a move with no event, and a keyup that leaves the caret in place. Round 3 adds the `select`, mousedown and changed-text cases.
- **CR-2 (P3), regex literals: fixed.** `isInputComplete` now tracks the last significant character and skips regex literals (`console-input.ts:47-51`, `:69-97`). It uses the same `regexMayStart` set as the backend splitter (`split.ts:177-179`), so the frontend and backend agree on where an input ends. Escapes, `[...]` classes, flags and an unterminated literal at a line end are handled. The table cases (`console-input.spec.ts:95-113`) cover both examples from round 1, division, and a leading regex.
- **CR-3 (P3), reopen button out of view: fixed.** The `shell-failed` alert now sits between the transcript and the input row, outside the scroll container (`shell-console.html:84-92`), and uses only danger tokens (`shell-console.css:167-176`). The spec asserts that the transcript does not contain it.
- **CR-4 (P3), ARIA: fixed.** `aria-controls` is `null` while the list is closed (`shell-console.html:110`). `aria-live` is no longer on the transcript, and a visually hidden `role="status"` region announces a summary (`:93-95`). The new live region has a small gap, see CR-6 below.
- **CR-5 (P3), tests and e2e path: fixed.** The lifecycle specs exist: late open after destroy, an older open overtaken by a newer one, an older failure after a newer success, and Ctrl+C with and without a selection. The e2e opens the console from the connection menu and runs `use shell_e2e` then `db.orders.countDocuments()` (`test/e2e/shell.e2e.ts:87-100`). The read-only test keeps the database-menu path.

What was re-checked across the whole task in round 2 and found sound (production code unchanged since):
- Session lifecycle: `openSeq` and `closed` close late `shell.open` answers. Destroy cancels the eval stream and any completion and closes the session. On NOT_FOUND the session moves to `failed` and can be reopened. History stays across a reopen.
- Stop and Ctrl+C unsubscribe the stream, so a stopped run can't be written by later output. A second run can't start while one is running.
- Completion: stale answers are dropped (aborted, or the input changed), and CANCELLED is not shown.
- CSS uses only `var(--...)` tokens, with no hard-coded colors. The production accent comes from the tab flag or the profile, and the read-only banner from `ProfileSafetyService`.
- Results render in the read-only explorer, each with its own services. All text is interpolated, never inserted as HTML. There are no security concerns in scope.
- Contract use matches `packages/contract/src/shell.ts`.
- Acceptance criteria: the e2e covers demo step 11 against the real backend and the Mongo fixture. `shell-console.spec.ts` covers history navigation, the completion popup and the read-only banner. The parent worker must record the evidence with `tasks.py verify`.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-6 | The live region stays silent when a run ends with the same summary as the previous run** (round 2; labelled CR-1 in the round 2 report; status: open, accepted by the parent as non-blocking)
    - File: `packages/renderer/src/app/console/shell-console.ts:296` (with `:165`, `shell-console.html:93-95`)
    - Category: Quality
    - Problem: `finishRun` calls `this.announcement.set(announce(finished))`. Angular signals compare with `Object.is`, so setting the same string again changes nothing. The DOM text of the `role="status"` region stays the same, and a screen reader announces nothing. Repeated runs often have the same summary. For example, `db.orders.countDocuments()` run twice gives "Run finished" both times (a scalar has no `type`). Any two cursor queries give "Run finished: Cursor", and the same error twice gives the same text. The second and later runs are then silent. Round 3 does not change this; the new `announce()` specs test the summary text only.
    - Why it matters: The fix for round 1 CR-4 made this region the only way a screen-reader user learns that a run ended. Without it, they can't tell whether a repeated command ran.
    - Suggested fix: Make every announcement differ, for example by clearing the region before setting the new text (set `''`, then set the summary after a microtask or the next render), or by adding the run number (`Run 12 finished: Cursor`). Add a spec that runs the same input twice and expects the region to update.

## Review conclusion

Round 2: all five round 1 findings (CR-1..CR-5) are fixed correctly and fully. The only new finding was a P3 accessibility gap in the new live region (CR-6). It doesn't affect an acceptance criterion and doesn't block completion.

Round 3 (final revision 40db3c6): the delta since e962c42 contains only test additions in two spec files. They are correct against the production code, deterministic, and pass (105/105, 4 runs). The task's production scope is the same code reviewed in round 2. CR-6 stays open and non-blocking.

No material issues found.

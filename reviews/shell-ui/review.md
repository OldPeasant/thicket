# Code Review

Date: 2026-11-17

Task: shell-ui - M4: mongosh console (round 2, final revision)

Scope: `git diff 944f76d..HEAD` excluding `tasks/` and `reviews/` (commits 977cdd1, edecbd7, 317fb7c, e962c42). Only committed changes; the working tree is clean.

Requirements:
- tasks/shell-ui.md acceptance criteria and recorded assumptions (history kept in memory, one tab per connection, Enter/Shift+Enter/Ctrl+Enter, one plain-text switch)
- SPEC.md demo step 11, M0 theme tokens, M4 "Shell"
- docs/ARCHITECTURE.md, docs/mongosh.md, packages/contract/src/shell.ts
- packages/backend/src/shell/split.ts (used to check the regex heuristic, not reviewed)
- AGENTS.md, docs/QUALITY.md
- Round 1 review (CR-1..CR-5) and reviews/shell-ui/fixes.md

Git range:
- Branch: main
- HEAD: e962c42895d90d9ac1fa0b5a268643976ab0141e
- Base/start: 944f76ddb91c9c188a353bd9944070a1ddc4c99d
- Commits reviewed: 4

Summary: 0 P0, 0 P1, 0 P2, 1 P3

## Status of round 1 findings

- **CR-1 (P2), completion applied at a moved caret: fixed.** `complete()` stores the requested `{ code, cursor }` in `completionAt` (`shell-console.ts:413`). `choose()` applies the completion at that stored cursor and closes the list when the text changed (`:430-440`). `onCaret` runs on `keyup`, `click` and `select` (`shell-console.html:120-122`) and closes the list when the caret, the selection or the text differs (`:446-453`). `closeCompletions()` clears the stored position. The single-completion path also uses the requested cursor (`:409`). The keys the list doesn't handle (ArrowLeft/Right, Home, End) fall through and then close the list on keyup. A caret move with no event still gives the correct text. The specs at `shell-console.spec.ts:598-648` cover keyup, click, a move with no event, and a keyup that leaves the caret in place.
- **CR-2 (P3), regex literals: fixed.** `isInputComplete` now tracks the last significant character and skips regex literals (`console-input.ts:47-51`, `:69-97`). It uses the same `regexMayStart` set as the backend splitter (`split.ts:177-179`), so the frontend and backend agree on where an input ends. Escapes, `[...]` classes, flags and an unterminated literal at a line end are handled. The table cases (`console-input.spec.ts:95-102`) cover both examples from round 1, division, and a leading regex.
- **CR-3 (P3), reopen button out of view: fixed.** The `shell-failed` alert now sits between the transcript and the input row, outside the scroll container (`shell-console.html:84-92`), and uses only danger tokens (`shell-console.css:167-176`). The spec asserts that the transcript does not contain it.
- **CR-4 (P3), ARIA: fixed.** `aria-controls` is `null` while the list is closed (`shell-console.html:110`). `aria-live` is no longer on the transcript, and a visually hidden `role="status"` region announces a summary (`:93-95`). The new live region has a small gap, see CR-1 below.
- **CR-5 (P3), tests and e2e path: fixed.** The lifecycle specs exist: late open after destroy, an older open overtaken by a newer one, an older failure after a newer success, and Ctrl+C with and without a selection (`shell-console.spec.ts:363-391`, `:662-747`). The e2e now opens the console from the connection menu and runs `use shell_e2e` then `db.orders.countDocuments()` (`test/e2e/shell.e2e.ts:87-100`). The read-only test keeps the database-menu path.

What was re-checked across the whole task and found sound:
- Session lifecycle: `openSeq` and `closed` close late `shell.open` answers. Destroy cancels the eval stream and any completion and closes the session. On NOT_FOUND the session moves to `failed` and can be reopened. History stays across a reopen.
- Stop and Ctrl+C unsubscribe the stream, so a stopped run can't be written by later output. A second run can't start while one is running.
- Completion: stale answers are dropped (aborted, or the input changed), and CANCELLED is not shown.
- CSS uses only `var(--...)` tokens, with no hard-coded colors. The production accent comes from the tab flag or the profile, and the read-only banner from `ProfileSafetyService`.
- Results render in the read-only explorer, each with its own services. All text is interpolated, never inserted as HTML. There are no security concerns in scope.
- Contract use matches `packages/contract/src/shell.ts`.
- Acceptance criteria: the e2e covers demo step 11 against the real backend and the Mongo fixture. `shell-console.spec.ts` covers history navigation, the completion popup and the read-only banner. Both criteria are still unticked in `tasks/shell-ui.md`. The parent worker still has to record the evidence with `tasks.py verify`.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | The live region stays silent when a run ends with the same summary as the previous run**
    - File: `packages/renderer/src/app/console/shell-console.ts:296` (with `:165`, `shell-console.html:93-95`)
    - Category: Quality
    - Problem: `finishRun` calls `this.announcement.set(announce(finished))`. Angular signals compare with `Object.is`, so setting the same string again changes nothing. The DOM text of the `role="status"` region stays the same, and a screen reader announces nothing. Repeated runs often have the same summary. For example, `db.orders.countDocuments()` run twice gives "Run finished" both times (a scalar has no `type`). Any two cursor queries give "Run finished: Cursor", and the same error twice gives the same text. The second and later runs are then silent.
    - Why it matters: The fix for round 1 CR-4 made this region the only way a screen-reader user learns that a run ended. Without it, they can't tell whether a repeated command ran.
    - Suggested fix: Make every announcement differ, for example by clearing the region before setting the new text (set `''`, then set the summary after a microtask or the next render), or by adding the run number (`Run 12 finished: Cursor`). Add a spec that runs the same input twice and expects the region to update.

## Review conclusion

Round 2: all five round 1 findings (CR-1..CR-5) are fixed correctly and fully. The only new finding is a P3 accessibility gap in the new live region (CR-1 above). It doesn't affect an acceptance criterion and doesn't block completion.

No material issues found.

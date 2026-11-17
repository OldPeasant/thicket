# Code Review

Date: 2026-11-17

Task: shell-ui - M4: mongosh console

Scope: `git diff 17f4bd0..HEAD` excluding `tasks/` (commits 81c88fa, f9c9726); committed changes only, working tree clean

Requirements:
- tasks/shell-ui.md acceptance criteria and recorded assumptions (history in memory, one tab per connection, Enter/Shift+Enter/Ctrl+Enter, one plain-text switch)
- SPEC.md section 2 demo step 11, M0 theme tokens, M4 "Shell"
- docs/ARCHITECTURE.md, docs/mongosh.md, packages/contract/src/shell.ts
- backend behavior in packages/backend/src/shell/ (context only, not reviewed)
- AGENTS.md, docs/QUALITY.md

Git range:
- Branch: main
- HEAD: f9c972687f8bb69b797c37c94f07edd999a0675b
- Base/start: 17f4bd01fce62c1c2fe17dde7672d91aabb5b574
- Commits reviewed: 2

Summary: 0 P0, 0 P1, 1 P2, 4 P3

What was checked and found sound:
- Session lifecycle: `openSeq` plus the `closed` flag close a late `shell.open` answer after a reopen or after destroy; destroy unsubscribes the eval stream, aborts completion and closes an open session; tabs stay mounted while hidden (`app-shell.ts` `[hidden]`), so switching tabs keeps the session.
- Stop/Ctrl+C unsubscribe the stream, and `ApiService.stream` then cancels it on the server, which interrupts the backend run. The backend queues the next eval behind the interrupt.
- Completion answers are dropped when the input changed or a newer request aborted them, and CANCELLED is not shown.
- Every CSS value is a `var(--...)` token. The tokens used (`--production*`, `--readonly*`, `--accent-*`, `--bg-*`, `--shadow-pop`, ...) are defined in all four `data-style` x `data-theme` blocks of `theme/tokens.css`. No hard-coded colors.
- Results render through the read-only explorer with per-result services, and text is interpolated (no innerHTML). There are no security concerns in scope.
- Contract use matches `shell.ts` (params, `cursor`, `db` output kind, NOT_FOUND for a lost session).
- Acceptance criteria are covered: `test/e2e/shell.e2e.ts` runs `db.orders.countDocuments()` against the real backend and Mongo fixture. `shell-console.spec.ts` covers history navigation (draft, oldest bound, multi-line caret), the completion popup (single/multi, arrows, Enter, Escape, mouse, empty) and the read-only banner. Evidence is not yet recorded with `tasks.py verify` (both criteria still unticked); the parent worker has to record it.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | Open completion list is applied at a caret that moved since the request, corrupting the input**
    - File: `packages/renderer/src/app/console/shell-console.ts:340` (also `:287`, `:401-406`)
    - Category: Correctness
    - Problem: `completionKey` only handles ArrowUp/ArrowDown/Enter/Tab/Escape. ArrowLeft/ArrowRight/Home/End, or a click inside the textarea, move the caret without an `input` or `blur` event, so the list stays open. `choose()` then calls `applyCompletion(el.value, el.selectionStart, completion)` with the new caret. mongosh completions contain the whole input up to the caret where they were requested (`db.or` -> `db.orders`), so the result is wrong. For example, `db.or`, Tab (list `db.orders`, `db.orgs`), ArrowLeft, Enter gives `db.ordersr` because `applyCompletion("db.or", 4, "db.orders")` keeps the trailing `r`.
    - Why it matters: Normal editing keys silently corrupt the user's code. In a shell that can write to production data, a mangled command may still parse and do something unintended.
    - Suggested fix: Store the `code` and `cursor` the completions were requested for, together with the list. Apply at that stored cursor, or close the list on any caret move (close on keys other than the handled ones, and on `click`/`selectionchange`). Add a spec for "caret moved, then Enter".

## P3 Low

- [ ] **CR-2 | Regex literals with brackets or `//` keep Enter from running the input**
    - File: `packages/renderer/src/app/console/console-input.ts:18-45`
    - Category: Correctness
    - Problem: `isInputComplete` doesn't recognise regex literals. `db.c.find({ name: /^\(/ })` leaves `(` on the stack. `db.c.find({ p: /\// })` treats `//` as a line comment and drops the closing `})`. In both cases Enter inserts a newline instead of running.
    - Why it matters: Regex filters are common in mongosh. The user gets a newline and no feedback. Ctrl/Cmd+Enter works, so this is not blocking.
    - Suggested fix: Treat `/` as the start of a regex literal when the previous non-space token is an operator, `(`, `,`, `:`, `[`, `{`, `=`, `!`, `&`, `|`, `?` or the start of input, and skip to the closing unescaped `/` (honouring `[...]` classes). Add the two cases above to the `it.each` table.

- [ ] **CR-3 | "Open new session" ends up out of view after the backend loses the session**
    - File: `packages/renderer/src/app/console/shell-console.html:48-55` (with `shell-console.ts:174-178`, `:237-243`)
    - Category: Quality
    - Problem: The `failed` block, with the only reopen button, renders at the top of the transcript, before the runs. On NOT_FOUND the transcript auto-scrolls to the newest run and the input is disabled. In any transcript taller than the viewport, the recovery action is scrolled away and the user sees a disabled input.
    - Why it matters: Recovery after a backend restart is possible but hard to find.
    - Suggested fix: Render the failure/reopen note after the runs, or next to the input row, while the state is `failed`. Or scroll it into view when the state becomes `failed`.

- [ ] **CR-4 | Combobox/live-region ARIA details**
    - File: `packages/renderer/src/app/console/shell-console.html:107` and `:43`
    - Category: Quality
    - Problem: `aria-controls` always points to `<uid>-completions`, but that listbox exists only while completions are open, so most of the time it references a missing id (flagged by axe `aria-valid-attr-value`). Also, `aria-live="polite"` sits on the whole transcript, including the explorer tables, so a screen reader reads the full rendered document grid of every result.
    - Why it matters: These are accessibility defects in a keyboard-centric component that the task asked to make a combobox.
    - Suggested fix: Bind `[attr.aria-controls]` to `null` while the list is closed. Move the live region to a small element that announces a summary (for example "Result: Cursor, 3 documents", errors, prints) instead of the whole transcript.

- [ ] **CR-5 | Session race paths and Ctrl+C have no tests; e2e opens the shell from the database, not the connection**
    - File: `packages/renderer/src/app/console/shell-console.spec.ts:330-335`; `test/e2e/shell.e2e.ts:49-50`
    - Category: Tests
    - Problem: No spec covers destroying the console while `shell.open` is pending, which should close the late session (`shell-console.ts:193-197`). No spec covers a reopen whose older open answers late, or Ctrl+C stopping a run (`:328-336`). SPEC demo step 11 says "open the mongosh console on the connection", but the e2e uses the database item's "Open shell", so the connection menu entry (`sidebar-tree.ts:412-417`) is never exercised.
    - Why it matters: These are the regression-prone lifecycle paths the design relies on. A leaked backend session (a worker plus a `MongoClient`) would go unnoticed.
    - Suggested fix: Add specs with a deferred `shell.open` (destroy before it resolves, then expect `shell.close` for the late id) and a Ctrl+C keydown while running (expect a cancel). In the e2e, open the shell from the connection node's menu, or add a short second path for it.

## Review conclusion

Material issues found; fix before completing the task. CR-1 (P2) can corrupt shell input and should be fixed. CR-2 to CR-5 are low-priority improvements.

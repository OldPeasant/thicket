# Code Review

Date: 2026-11-16

Task: safety-ui - M1: Safety UI: production accent, read-only state, confirm dialog service

Scope: `git diff 2524a5c b98c2fb -- packages test docs` (task code at reviewed revision b98c2fb; HEAD adb7096 has no differences in `packages`, `test` or `docs` against b98c2fb)

Requirements:
- tasks/safety-ui.md (goal, three acceptance criteria, four recorded assumptions)
- SPEC.md M1 "Safety" and section 4 (write requests carry `profileId` and `confirmed`)
- docs/ARCHITECTURE.md "Write safety in the renderer" and the status bar notes
- docs/QUALITY.md (report contract)
- packages/contract (write method params, `confirmed`, `WriteKind`)
- AGENTS.md project notes (theme tokens, no hard-coded colors)

Git range:
- Branch: main
- HEAD: adb7096a134954e92809fac066ff262a1e989a12 (reviewed revision b98c2fb, same code)
- Base/start: 2524a5ced5e53202286ca7221f0ad8d72d3c6132
- Commits reviewed: 2 (84ca9f2 WriteGuard, confirm dialog, read-only control, production accent; b98c2fb dev page, e2e screenshots, architecture notes)

Summary: 0 P0, 0 P1, 1 P2, 5 P3

What was checked and holds:
- `WriteGuard.approve` refuses read-only profiles with `READ_ONLY` before any request, strips a caller-supplied `confirmed`, adds `confirmed: true` only after `ConfirmService.confirm` resolves `true` and the signal is not aborted; non-confirming writes are sent without `confirmed`. Covered with the fake API in `write-guard.service.spec.ts` (production, bulk on non-production, pre-set `confirmed`, abort, read-only, `approve()`).
- Type-to-confirm: `count > 1000` (strictly above, 1 000 itself excluded and tested) for `docs.deleteMany`, from `count` or `expectedCount`; enforced both in the dialog (button disabled, Enter guarded) and in `ConfirmService.answer`, so `answer(true)` cannot bypass it (tested).
- `describeWrite` matches the contract params of all write methods that have required fields (checked against `packages/contract/src/*.ts`); EJSON goes through `printShellSyntax`.
- Production accent uses only `--production*` tokens, defined in all four theme blocks of `theme/tokens.css`; the dialog CSS uses only tokens (`color-mix` with a token and `transparent`). The 12 committed screenshots in `reviews/safety-ui/screenshots/` show the accent on tab, sidebar edge and status bar in all four combinations; the e2e test also asserts the computed colors.
- `@thicket/core/shellsyntax` export points at a module that imports only `bson` and `../bson/*`, the same dependency surface as the already-used `./bson` export.
- Acceptance criteria evidence is not yet recorded (`python tasks.py verify safety-ui` shows all three unticked); that is the parent worker's next step, not a finding.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | Confirm dialog is not modal for the keyboard: app shortcuts act behind it and focus can leave it**
    - File: `packages/renderer/src/app/safety/confirm-dialog.ts:37` (keydown only on the dialog element), `:170-201`; `packages/renderer/src/app/layout/app-shell.ts:51`, `:157-175`
    - Category: Correctness
    - Problem: Only Escape stops propagation. Ctrl/Cmd+W, Ctrl+Tab and Ctrl+PageUp/PageDown pressed inside the open dialog bubble to `AppShell`'s `(document:keydown)` handler, which closes or switches the tab behind the modal (Ctrl+Tab additionally runs `trapFocus`, since it only checks `key === 'Tab'`). Separately, the backdrop has no handler and the background is not `inert`: clicking the backdrop moves focus to `<body>`, after which the dialog's `(keydown)` listener no longer receives events, so Escape does nothing and Tab walks into the sidebar/tabs behind the dialog.
    - Why it matters: The task asks for a confirm dialog with focus trap and Escape. A user can close the tab whose write is waiting for confirmation (the dialog then stays open for a write whose UI is gone, see CR-3) or interact with the app behind a production confirm. `aria-modal="true"` is announced, but the background stays operable.
    - Suggested fix: Handle keydown at the document level while a request is shown (or stop propagation of all keydown events from the dialog) so `AppShell` shortcuts are ignored while the dialog is open; make the rest of the shell `inert` while `confirm.current()` is set (or return focus into the dialog on `focusin` outside / backdrop `mousedown`). Add component tests: Ctrl+W inside the dialog does not close a tab; Escape still cancels after a backdrop click.

## P3 Low

- [ ] **CR-2 | `aria-label="Operation"` on the operation block replaces the alert dialog's description**
    - File: `packages/renderer/src/app/safety/confirm-dialog.ts:33`, `:58-63`
    - Category: Quality
    - Problem: The `alertdialog` is described by `#confirm-operation` (`aria-describedby`), but that `<pre>` has `aria-label="Operation"`. In accessible-description computation the referenced element's `aria-label` takes precedence over its text content, so screen readers announce "Operation" instead of the shell operation.
    - Why it matters: SPEC requires the dialog to show the operation; non-visual users get only the label when the dialog opens.
    - Suggested fix: Drop the `aria-label` from the `<pre>` (or put a visible "Operation" label in a separate element and keep `aria-describedby` pointing at the text-only node).

- [ ] **CR-3 | An aborted write leaves its confirm dialog open**
    - File: `packages/renderer/src/app/safety/write-guard.service.ts:122-124`; `packages/renderer/src/app/safety/confirm.service.ts:41`
    - Category: Correctness
    - Problem: When the caller's `AbortSignal` fires while the dialog is open (tab closed, component destroyed, e.g. `SafetyDemo`'s `onDestroy`), the request stays queued in `ConfirmService`; the dialog remains visible and confirming it only produces a silent `CANCELLED`. `ConfirmService` has no way to withdraw a pending request.
    - Why it matters: The user sees and may confirm a write that will not happen, and further queued confirmations wait behind it.
    - Suggested fix: Pass the signal into `confirm()` (or return a withdraw handle) and remove the pending entry / resolve `false` on abort; add a test that aborting closes the dialog.

- [ ] **CR-4 | `describeWrite` omits options for `agg.run` and `agg.createView`**
    - File: `packages/renderer/src/app/safety/operation.ts:318-325`
    - Category: Correctness
    - Problem: `agg.run` prints only the pipeline, dropping `collation`, `hint`, `allowDiskUse`, `maxTimeMS` (and `batchSize`); `agg.createView` drops `collation`. Other cases (`updateMany`/`deleteMany` collation, `insertMany` ordered) do print their options.
    - Why it matters: The dialog is meant to show the exact operation; a collation changes which documents a `$out`/`$merge` pipeline or view matches.
    - Suggested fix: Append an options document (`{ collation: ..., hint: ..., allowDiskUse: true, maxTimeMS: ... }`) when present, as done for `updateMany`; add a test case.

- [ ] **CR-5 | `WriteControl` removes a control's own `title` tooltip**
    - File: `packages/renderer/src/app/safety/write-control.directive.ts:357`
    - Category: Quality
    - Problem: The host binding `'[attr.title]': 'readOnly() ? hint : null'` evaluates to `null` on writable profiles, and Angular removes an attribute bound to `null`, so a static `title` on the host (e.g. `title="Save (Ctrl+S)"`) is deleted.
    - Why it matters: The directive is meant for every write control; tooltips on those controls would silently disappear once later tasks use it.
    - Suggested fix: Add an optional `title` input that the binding falls back to (`readOnly() ? hint : title()`), or document that hosts must pass their tooltip through the directive.

- [ ] **CR-6 | Splitter comment now sits above the production rule**
    - File: `packages/renderer/src/app/layout/app-shell.css:46-52`
    - Category: Quality
    - Problem: The new `:host(.production) .sidebar` rule was inserted between the existing "The splitter is a 5px hit area..." comment and the `.splitter` rule, so that comment now describes the wrong block.
    - Why it matters: Misleading comments in the layout stylesheet.
    - Suggested fix: Move the production rule (with its comment) above the splitter comment.

## Review conclusion

Material issues found; fix before completing the task. No acceptance criterion is violated and the core safety guarantees (no `confirmed: true` without confirmation, read-only refusal, type-to-confirm above 1 000) hold and are tested; CR-1 (dialog not keyboard-modal) should be fixed, the P3 items may be fixed or accepted with a note.

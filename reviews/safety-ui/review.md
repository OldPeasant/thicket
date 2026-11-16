# Code Review

Date: 2026-11-16

Task: safety-ui - M1: Safety UI: production accent, read-only state, confirm dialog service

Scope: `git diff 0239837 fdf5869` restricted to the task's changes (packages/renderer, packages/core/package.json, test/e2e, docs/ARCHITECTURE.md, reviews/safety-ui), reviewed revision fdf58691787965e2dac03ec5a937dc58fc39ac0b (third round). The two commits after the previous round (b1f5b98, fdf5869) were also reviewed on their own (`git diff e894462 fdf5869`). Committed changes only; the working tree was clean at review time.

Requirements:
- tasks/safety-ui.md (goal, three acceptance criteria, four recorded assumptions)
- SPEC.md M1 "Safety"
- docs/ARCHITECTURE.md "Write safety in the renderer"
- docs/QUALITY.md (report contract)
- reviews/safety-ui/fixes.md (claimed fixes for round 2)

Git range:
- Branch: main
- HEAD: fdf58691787965e2dac03ec5a937dc58fc39ac0b
- Base/start: 0239837 (`git merge-base HEAD origin/main`)
- Commits reviewed: 6 (2544986 WriteGuard, confirm dialog, read-only control, production accent; 40d0392 dev page, e2e screenshots, architecture notes; f158e95 test-writer tests and first review; e894462 fixes for round-1 CR-1..CR-6; b1f5b98 final test-writer tests and reports; fdf5869 ARCHITECTURE.md update and fix report)

Summary: 0 P0, 0 P1, 0 P2, 0 P3

## Earlier round (reviewed revision 24cd7c4, rebased as e894462)

| Finding | Title | Status at fdf5869 |
| --- | --- | --- |
| CR-1 (P2) | Dialog regression tests for the CR-1/CR-2 fixes not committed | Resolved in b1f5b98: `confirm-dialog.spec.ts` (+118 lines) now covers the accessible description without `aria-label`, backdrop mousedown refocus plus Escape, backdrop click keeping focus on an inner control, Escape and Tab on `<body>`, other keys and Ctrl+Tab on `<body>` ignored, no handling without a dialog, Ctrl/Meta/Alt+Tab not trapped, and Escape cancelling only the shown request. Further tests in `confirm.service.spec.ts` (typed text reset on withdrawal of the shown request, kept on withdrawal of a waiting one, last request withdrawn), `operation.spec.ts` (falsy `agg.run` options, no options object, `agg.createView` without collation) and `write-control.directive.spec.ts` (empty bound title). |
| CR-2 (P3) | ARCHITECTURE.md documented the old `confirm` signature | Resolved in fdf5869: `docs/ARCHITECTURE.md:293-296` now documents `ConfirmService.confirm(request, signal?)`, withdrawal on abort (dialog closes or never opens, resolves `false`) and the inert background with ignored tab shortcuts. Matches `confirm.service.ts` and `app-shell.ts`. |

What was checked in this round:
- Production code unchanged since the previous round: `git diff --stat 24cd7c4 e894462 -- packages/renderer packages/core test/e2e docs/ARCHITECTURE.md` is empty, and `git diff e894462 fdf5869` touches only spec files, `docs/ARCHITECTURE.md` and `reviews/safety-ui/`. The new tests only add assertions; no existing test was removed or weakened.
- Re-read with fresh eyes: `confirm.service.ts`, `write-guard.service.ts`, `confirm-dialog.ts`, `write-control.directive.ts`, `profile-safety.service.ts`, `safety.types.ts`, `layout/app-shell.ts`. The safety guarantees hold: read-only refused with `READ_ONLY` before any request; caller-supplied `confirmed` stripped; `confirmed: true` only after the user confirms and the signal is not aborted; cancel rejects with `CANCELLED` and sends nothing; type-to-confirm is enforced in `ConfirmService.answer` (the dialog cannot bypass it) for `docs.deleteMany` over 1 000 documents; abort withdraws shown or waiting requests and detaches the listener on answer; the queue shows one request at a time and resets the typed text per request.
- New tests assert behavior (focus, `defaultPrevented`, resolved values, rendered text), not implementation details.
- Focused tests run by this reviewer on the clean tree at fdf5869: `cd packages/renderer && npx ng test --include='src/app/safety/**/*.spec.ts' --include='src/app/layout/**/*.spec.ts' --watch=false` -> 12 files, 237 tests passed.
- Acceptance-criterion evidence is not yet recorded (`python tasks.py verify safety-ui` shows #1-#3 unticked). Recording it, including the e2e screenshot run for criterion #3, is the parent worker's next step before `done`, not a finding against the code. The committed screenshots in `reviews/safety-ui/screenshots/` cover the four theme combinations; the later fixes only touch dialog focus styling and do not affect the accent.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

None.

## Review conclusion

No material issues found. Both round-2 findings are resolved at fdf5869 (dialog regression tests committed in b1f5b98, ARCHITECTURE.md signature and modal behavior documented in fdf5869), the production code is identical to the previously reviewed revision, and the focused safety and layout suites pass (237 tests).

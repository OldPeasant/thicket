# Code Review

Date: 2026-11-17

Task: saved-pipelines - M3: Save and reopen aggregation pipelines (pipelines.json)

Scope: `git diff c65b0cd..73e3511` excluding `tasks/` (commits a2aa12c, 1788862, d216dfb, 73e3511): contract `pipelines.*`, `apps/desktop/src/pipelines/` store and handlers plus wiring in `main`, the "Saved…" panel in `packages/renderer/src/app/aggregation/`, and the SPEC/ARCHITECTURE docs.

Requirements:
- `tasks/saved-pipelines.md` acceptance criteria and recorded assumptions
- `SPEC.md` (M3 "save pipelines", section 4 method groups, section 5 data on disk)
- `docs/ARCHITECTURE.md` (desktop stores, contract layout, aggregation tab)
- `AGENTS.md`
- Existing conventions: `apps/desktop/src/profiles/store.ts`, `apps/desktop/src/settings/store.ts`
- Parent instructions: check EJSON text fields, route `main`, atomic write and corrupt-file handling, stale responses on target change, text mode, accessibility, no secrets or paths sent to the renderer

Git range:
- Branch: main
- HEAD: 73e3511
- Base/start: c65b0cd7a672b9f6acd3866fa41e45c460221e6d
- Commits reviewed: 4 (excluding the `assume:` commit c65b0cd, which is the base)

Summary: 0 P0, 0 P1, 0 P2, 3 P3

Verification run during the review (read-only):
- `npx vitest run apps/desktop/src/pipelines packages/contract/src`: 5 files, 808 tests passed
- `npx ng test --include src/app/aggregation/aggregation-view.spec.ts` (packages/renderer): 113 tests passed

Criteria check:
- Criterion 1 (store unit tests for missing/corrupt file and atomic write, plus contract samples) is met. `store.spec.ts` covers the missing file, ten kinds of corrupt file (moved to `.corrupt-<time>`, the store then starts empty), EACCES (fails and never overwrites), a file from a newer version (read-only), writes through a flushed temp file plus rename, a failed rename (previous file and in-memory state kept, temp file removed), and removal of a stale temp file. `index.spec.ts` and `methods.spec.ts` have valid and invalid samples for all four methods, and the route test includes `pipelines`.
- Criterion 2 (component test) is met. The test "saves a pipeline with a disabled stage and reopens it in a new builder tab" destroys the fixture, creates a new builder, opens the saved pipeline and checks that the parsed stages and enabled flags are the same (and that Run skips the disabled stage).
- The store follows `ProfilesStore` (connections.json) closely: the same load, corrupt, read-only and write paths, and serialized operations. Store errors map to NOT_FOUND, CONFLICT and UNSUPPORTED. Stages are canonical EJSON text (`ejsonDocument`). All four methods use route `main`. The renderer receives no file paths or secrets beyond the generic `Unexpected error:` message, which works the same way as the existing profiles handlers.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | Panel messages and list errors from the previous collection stay visible after the tab's target changes**
    - File: `packages/renderer/src/app/aggregation/aggregation-view.ts:284-292` (also `:735-747`, `:791`)
    - Category: Correctness
    - Problem: When the target changes, the effect resets `savedList`, `renaming` and `deleting`, but not `savedListError` or `savedMessage`. The template checks `savedListError()` before `savedList()`. So a list error from the old collection stays on screen for the new one until the new `pipelines.list` call succeeds, and a status message like `Deleted "Gone".` or `Saved "X".` stays indefinitely. The same thing happens when `savePipeline` finishes after a target change: it sets its success message and `savedName` on the new collection's panel. Separately, `replaces` (line 791) is computed from `savedList()`, which is `null` before the first load finishes, so the message can say "Saved" when it actually replaced a pipeline.
    - Why it matters: The user can see a message about a different collection, or a misleading "Saved"/"Replaced" message. Nothing is lost.
    - Suggested fix: In the target-change effect, also clear `savedListError` and `savedMessage`. In `savePipeline`, only set the message and name when `sameTarget(target)` is still true after the await. Optionally, base the "Replaced" wording on whether `saved.pipelineId` was already in the list.

- [ ] **CR-2 | Inline Rename and Delete lose keyboard focus, and Delete can be sent twice**
    - File: `packages/renderer/src/app/aggregation/aggregation-view.html:391,401,419`; `packages/renderer/src/app/aggregation/aggregation-view.ts:839-875`
    - Category: Quality
    - Problem: "Rename" and "Delete…" each replace the button that was just activated (`@if` swaps in the rename form or the confirm buttons). Nothing moves focus to the new input or the confirm button, so keyboard and screen-reader users end up on `<body>`. Other components in this codebase manage focus explicitly (for example `confirm-dialog.ts`, `sidebar-tree.ts`, `collection-view.ts`). Also, the confirm "Delete" button stays enabled while `pipelines.delete` is in flight, so a double click sends a second delete, and its NOT_FOUND error message replaces the "Deleted" confirmation.
    - Why it matters: SPEC section 1 asks for clear focus. The double delete shows a misleading error after a delete that worked.
    - Suggested fix: Focus the rename input or the confirm button after the swap (for example with a `viewChild` and `afterNextRender`), and disable the confirm button or ignore clicks while a delete is pending.

- [ ] **CR-3 | No component test for the stale-response guard on target change**
    - File: `packages/renderer/src/app/aggregation/aggregation-view.spec.ts:1843-2101` (code under test: `aggregation-view.ts:735-752`)
    - Category: Tests
    - Problem: `loadSaved` drops a `pipelines.list` result (or error) when the tab's target has changed while the request was running (`sameTarget`), and the target-change effect reloads the list. No test points the tab at another collection while a list request is pending, so the guard and the reload are not covered.
    - Why it matters: Out-of-order async results are easy to break in a regression, and the existing tests would not catch it.
    - Suggested fix: Add a test that holds back the `pipelines.list` response, changes the tab input to another collection, releases the old response, and checks that the panel shows only the new collection's pipelines.

## Review conclusion

No material issues found. Both acceptance criteria are met and the tests pass. The three P3 findings are optional polish.

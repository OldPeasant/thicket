# Code Review

Date: 2026-11-17

Task: saved-pipelines - M3: Save and reopen aggregation pipelines (pipelines.json)

Scope: re-review of `git diff c51222cd..7724ccb` excluding `tasks/`. This covers the full task: the contract `pipelines.*`, the `apps/desktop/src/pipelines/` store and handlers and their wiring in `main`, the "Saved…" panel in `packages/renderer/src/app/aggregation/`, and the SPEC/ARCHITECTURE docs. Since the first review (at 73e3511), the following changed: the fixer commit 4dcf170 (CR-1, CR-2), the test-writer tests (6513a0e), and the merge of origin/main (query-history, `history.*`) in 7724ccb. The conflicts in `apps/desktop/src/main/{handlers,index}.ts` and `packages/contract/src/{index.ts,index.spec.ts,methods.spec.ts}` were resolved in that merge.

Reviewed revision: 7724ccbe3cd8608a9724fddec0b666db3535ceb1

Requirements:
- `tasks/saved-pipelines.md` acceptance criteria and recorded assumptions
- `SPEC.md` (M3 "save pipelines", section 4 method groups, section 5 data on disk)
- `docs/ARCHITECTURE.md` (desktop stores, contract layout, aggregation tab)
- `AGENTS.md`
- `reviews/saved-pipelines/fixes.md` (fixer claims verified against the code)
- Parent instructions: verify fixes, conflict resolutions and acceptance criteria

Git range:
- Branch: main
- HEAD: 7724ccbe3cd8608a9724fddec0b666db3535ceb1
- Base/start: c51222cd89bc7fdcf665aa3528de920aac1daf40 (merge-base with origin/main)
- Commits reviewed: 7 (a2aa12c, 1788862, d216dfb, 73e3511, 6513a0e, 4dcf170, merge 7724ccb)
- Uncommitted changes: none at the start of the review

Summary: 0 P0, 0 P1, 0 P2, 0 P3

Verification run during the review (read-only):
- `npx vitest run apps/desktop/src/pipelines packages/contract` (repo root): 6 files, 856 tests passed
- `npx ng test --include src/app/aggregation` (packages/renderer): 2 files, 129 tests passed

Conflict resolutions (`git show --cc 7724ccb`):
- `apps/desktop/src/main/handlers.ts`: both `historyHandlers` and `pipelinesHandlers` are imported, the `history?` and `pipelines?` dependencies are both declared, and both handler sets are spread into `mainHandlers`. Their method names do not overlap. Correct.
- `apps/desktop/src/main/index.ts`: `pipelinesStore()` (`userData/pipelines.json`) and `historyStore()` are both kept and both passed to `mainHandlers`. Correct.
- `packages/contract/src/index.ts`: both `export *` lines and both method spreads are kept. Correct.
- `packages/contract/src/index.spec.ts`: both sample sets are kept, the group list includes `history` and `pipelines` in alphabetical order, and the route test now expects `profiles`, `history`, `pipelines` and `app` to go to `main`. Correct, and the test passes.
- `packages/contract/src/methods.spec.ts`: both result sample sets are kept. Correct.
- `SPEC.md` and `docs/ARCHITECTURE.md` merged without conflicts, and the `pipelines.*` row and the store description are intact.

Criteria check:
- Criterion 1 (store unit tests for missing or corrupt file and atomic write, plus contract samples): met. `apps/desktop/src/pipelines/store.spec.ts` and the contract samples for all four methods pass.
- Criterion 2 (component test: save a pipeline with a disabled stage and reopen it in a new builder tab, with the same stages and enabled flags): met. See `aggregation-view.spec.ts:1950`, which passes.

## Status of earlier findings

- **CR-1 (P3) Panel messages and list errors from the previous collection stay visible after a target change: Fixed.** The target-change effect now also clears `savedListError` and `savedMessage` (`aggregation-view.ts:300-301`). `savePipeline`, `renameSaved` and `deleteSaved` capture the target and return early on success and on failure when `sameTarget(target)` is false (`:828`, `:838`, `:896`, `:902`, `:927`, `:933`). "Replaced" is now based on whether the returned `pipelineId` was already in the list before the save. Tests at `aggregation-view.spec.ts:2227`, `:2248` and `:2322` cover this.
- **CR-2 (P3) Inline Rename and Delete lose focus, and Delete can be sent twice: Fixed.** An `afterRenderEffect` focuses the control named by `savedFocus` (`:308-322`), with the save name input as the fallback. `savedBusy` disables the rename submit and delete confirm buttons (`aggregation-view.html`), and `renameSaved` and `deleteSaved` ignore re-entry; this also covers Enter in the rename form. `savedBusy` is reset in `finally`. On a failed delete, focus goes to the confirm button. That button is still disabled when `savedFocus` is set, but `finally` re-enables it in the same synchronous run, before the render, so focusing works. Tests at `:2331` and `:2358` cover this.
- **CR-3 (P3) No test for the stale-response guard on target change: Fixed (by the test-writer).** `aggregation-view.spec.ts:2102` holds back `pipelines.list`, points the tab elsewhere, and checks that both a late success and a late failure are ignored.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

None.

Observation, not reported as a finding: `savedBusy` is not reset when the target changes. If a rename or delete is still running when the user switches collection, the new panel's confirm and rename buttons stay disabled until that local IPC call answers. This is temporary, loses no data, and resetting it safely would need a per-request token. It is left as is.

## Review conclusion

No material issues found. All three earlier findings are fixed and covered by tests, the merge conflict resolutions are correct, both acceptance criteria are met, and the requested test runs pass.

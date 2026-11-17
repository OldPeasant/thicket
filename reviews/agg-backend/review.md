# Code Review

Date: 2026-11-17

Task: agg-backend - M3: Aggregation run, stage preview, explain, views

Scope: second review on the final code, `git diff b292300..be1062bf028e0760b54d0d623f6d04d83147e39d` (whole task change), with the fix commit be1062b checked in detail against the first review's findings CR-1 to CR-4. Unit specs being edited at the same time by the test-writer are not reviewed as such; they were only run.

Reviewed revision: be1062bf028e0760b54d0d623f6d04d83147e39d

Requirements:
- tasks/agg-backend.md acceptance criteria and recorded assumptions (natural-order `$limit` sample instead of `$sample`; explain defaults to executionStats and allows `$out`/`$merge` only with queryPlanner; previewStage refuses `$out`/`$merge`)
- SPEC.md M3 aggregation and section 4 (`agg.*` methods, streamed long operations)
- docs/ARCHITECTURE.md, AGENTS.md
- packages/backend/src/guard/guard.ts, packages/backend/src/docs/query/ (existing pattern)
- First review (this file, previous revision) and reviews/agg-backend/fixes.md

Git range:
- Branch: main
- HEAD: be1062bf028e0760b54d0d623f6d04d83147e39d
- Base/start: b292300 (merge base with origin/main)
- Commits reviewed: 4 (659163d handlers; 567761f integration tests; 643a41a unit tests and reports; be1062b review fixes)
- Uncommitted changes: none at review time

Commands run:
- `npx vitest run --root packages/backend src/agg` -> 2 files, 93 tests passed
- `npx vitest run --config test/integration/vitest.config.ts agg.int` (container fixtures) -> 1 file, 15 tests passed, including the new `$text` preview case

Verification of the earlier findings:
- CR-1 (preview `$limit` before a `$text` `$match`): fixed. `mustComeFirst` (agg.ts:91) keeps a leading `$match` with a top-level `$text` in front of the sample `$limit`. A unit test covers the built pipeline, and the int test previews a text-search pipeline on a text-indexed collection. One edge case remains, see CR-1 below.
- CR-2 (writing stages defined twice): fixed. `WRITING_STAGES` is exported only from guard.ts:52, and agg.ts:13 imports it. There is no import cycle, because guard.ts imports only the contract and `server/rpc`.
- CR-3 (self-referencing import): fixed. agg.ts:4 now imports from `'../browse/browse'`.
- CR-4 (duplicated `isOpenClient`): fixed. It is exported once from connections/manager.ts:341 and used by both handler modules. Behavior is unchanged.

Acceptance criteria check (final code):
- AC1 (preview of stage 2 of 3 matches running the first 2 stages; explain returns winning plan): `agg.int.spec.ts` "preview of stage 2 of 3 matches running the first 2 stages", "explains a find and returns the winning plan (index used)" and "explains an aggregate and returns the winning plan" passed in the run above.
- AC2 (`$out` on read-only refused; on production requires confirmed): `aggHandlers` are wired into `startBackend` inside `guardWrites` (backend.ts), and `agg.run` is a conditional write through `pipelineWrites`. The int tests cover read-only refusal with and without `confirmed`, `CONFIRMATION_REQUIRED` for `$out` and `$merge` on production, and the confirmed run writing the target. They passed.

Summary: 0 P0, 0 P1, 0 P2, 1 P3

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | `$text` nested in a leading `$match` (`$and`/`$or`) still gets the sample `$limit` in front**
    - File: `packages/backend/src/agg/agg.ts:95`, `packages/backend/src/agg/agg.spec.ts` ("a $match without a top-level $text keeps the sample first")
    - Category: Correctness
    - Problem: `mustComeFirst` only checks for a top-level `$text` key. MongoDB accepts `$text` inside `$and`, or inside `$or` when every clause is indexed, but the `$match` that contains it must still be the first stage. A preview of `[{ $match: { $or: [{ $text: ... }, ...] } }, ...]` therefore runs `[{ $limit }, { $match: ... }]`, and the server rejects it. The fix report says MongoDB does not allow that position for the first-stage exception, but the rule applies to any `$match` that contains `$text`. The new unit test asserts the current behavior for the nested `$or` case.
    - Why it matters: this is rare (most text searches put `$text` at the top level), but the stage preview of such a pipeline shows a server error, while `agg.run` works.
    - Suggested fix: treat a leading `$match` as must-be-first when `$text` appears at the top level or inside a top-level `$and`/`$or` array, recursively. Then update the unit test so the nested case expects the sample after the `$match`. This is optional and does not block the task.

## Review conclusion

No material issues found. The four earlier findings are fixed, both acceptance criteria are met and pass the integration tests run against the container fixtures, and the remaining CR-1 is a low-priority edge case that may be fixed or deferred.

# Code Review

Date: 2026-11-17

Task: agg-backend - M3: Aggregation run, stage preview, explain, views

Scope: `git diff ba696c99c3ba716ce6d844e1faa810eaff2ccc9f..bb56df6065edfe7490d71a276c1431e6c73f8ea5` (packages/backend/src/agg/agg.ts, handlers.ts, index.ts; wiring in packages/backend/src/server/backend.ts and packages/backend/src/index.ts; test/integration/agg.int.spec.ts). Unit specs under packages/backend/src/agg/*.spec.ts being written in parallel by the test-writer are excluded as instructed.

Requirements:
- tasks/agg-backend.md acceptance criteria and recorded assumptions (natural-order `$limit` sample instead of `$sample`; explain defaults to executionStats and refuses `$out`/`$merge` unless queryPlanner; previewStage refuses `$out`/`$merge`)
- SPEC.md M3 aggregation (pipeline builder preview, create view, `$out`/`$merge` ask first, explain for find and aggregate) and section 4 (`agg.*` methods, streamed long operations)
- docs/ARCHITECTURE.md, AGENTS.md
- Contract packages/contract/src/agg.ts; guard packages/backend/src/guard/guard.ts; existing pattern packages/backend/src/docs/query/

Git range:
- Branch: main
- HEAD: bb56df6065edfe7490d71a276c1431e6c73f8ea5
- Base/start: ba696c99c3ba716ce6d844e1faa810eaff2ccc9f
- Commits reviewed: 2 (a0a1ffa agg: run, previewStage, explain, createView handlers; bb56df6 agg: integration tests)
- Uncommitted changes: none at review time

Commands run:
- `npx vitest run --config test/integration/vitest.config.ts agg.int` (Podman fixtures) -> 1 file, 14 tests passed

Acceptance criteria check:
- AC1 (preview of stage 2 of 3 matches running the first 2 stages; explain returns winning plan): implemented in `previewStage`/`previewPipeline` and `explain`/`buildExplained`; covered by `agg.int.spec.ts` "preview of stage 2 of 3 ..." and the two explain tests (find shows IXSCAN in winningPlan; aggregate winningPlan for classic and SBE layouts). Passed in the run above.
- AC2 (`$out` on read-only refused; on production requires confirmed): `agg.run` is `write: 'conditional'` and `aggHandlers` are wrapped by `guardWrites` in `startBackend` (backend.ts:53-68); the int test wires the same `guardWrites(aggHandlers(...))` and covers read-only refusal (with and without `confirmed`), production `CONFIRMATION_REQUIRED` for `$out` and `$merge`, and the confirmed run writing the target collection. Passed.

Summary: 0 P0, 0 P1, 1 P2, 3 P3

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | Preview inserts `$limit` before a `$match` with `$text`, which must be the first stage**
    - File: `packages/backend/src/agg/agg.ts:32` (FIRST_STAGES) and `packages/backend/src/agg/agg.ts:166`
    - Category: Correctness
    - Problem: `previewPipeline` puts the sample `{ $limit: sampleSize }` before every stage except those listed in `FIRST_STAGES`. MongoDB only accepts a `$match` that uses `$text` as the first stage of a pipeline. For a pipeline such as `[{ $match: { $text: { $search: "x" } } }, ...]`, the preview runs `[{ $limit: 100 }, { $match: { $text: ... } }, ...]`, and the server rejects it. The stage preview then fails for text-search pipelines, while `agg.run` of the same pipeline works.
    - Why it matters: SPEC.md M3 needs a preview for each stage of the builder. Text search is a common first stage, and every stage preview of such a pipeline would show a server error instead of output.
    - Suggested fix: treat a leading `$match` whose filter has a top-level `$text` as a must-be-first stage, so the sample `$limit` goes after it, the same way `$geoNear` is handled. Add a unit test for the pipeline that `previewPipeline` builds, and an int test if a text index fixture is cheap.

## P3 Low

- [ ] **CR-2 | `$out`/`$merge` stage list defined twice (guard and agg)**
    - File: `packages/backend/src/agg/agg.ts:26`, `packages/backend/src/guard/guard.ts:49`
    - Category: Architecture
    - Problem: `agg.ts` exports its own `WRITING_STAGES`, and `guard.ts` keeps a private copy with the same contents. The guard (write check for `agg.run`) and the agg module (preview/explain refusal) now each own the rule about which stages write.
    - Why it matters: if a writing stage is added in only one place, the guard and the preview/explain refusal stop agreeing. That is the kind of safety rule that should have one owner.
    - Suggested fix: export the list from one module (for example the guard) and import it in `agg.ts`.

- [ ] **CR-3 | Odd self-referencing import path**
    - File: `packages/backend/src/agg/agg.ts:4`
    - Category: Quality
    - Problem: `import { canonical, toBrowseError } from '../../src/browse/browse'` goes up to `packages/backend` and back down into `src`. It resolves, but every other module uses a direct relative path (`docs/query/query.ts` uses `'../../browse/browse'`, so here it would be `'../browse/browse'`).
    - Why it matters: it is inconsistent and fragile if the package layout or build root changes.
    - Suggested fix: change it to `'../browse/browse'`.

- [ ] **CR-4 | `isOpenClient` copied from docs/query handlers**
    - File: `packages/backend/src/agg/handlers.ts:8`
    - Category: Quality
    - Problem: the function is an exact copy of `packages/backend/src/docs/query/handlers.ts:15`, and the `agg.run` stream wrapper repeats the `docs.find` one.
    - Why it matters: this is minor duplication. A future change to how closed connections end streams has to be made in both places.
    - Suggested fix: optionally move `isOpenClient` (or a small "stream on the profile's client" helper) into `connections/manager` and use it from both handlers. This is not blocking.

## Review conclusion

Material issues found; fix before completing the task. Both acceptance criteria are met and verified by the passing integration tests. CR-1 is a medium correctness defect in the stage preview: it does not block the acceptance criteria but should be fixed or explicitly deferred. CR-2 to CR-4 are low-priority cleanups.

# Fix Report

Date: 2026-11-17

Task: agg-ui-polish - Aggregation builder: stage-named preview announcements, no previews in text mode

Scope: P3 findings CR-2 and CR-3 from `reviews/agg-ui-polish/review.md` (round 2), on top of HEAD aeb6233151127b6e40d9fda2cf5f039c50ac2437. The parent instructions were: no production code changes, CR-1 accepted as is.

## Fixed findings

### CR-2 — On return, a failed preview is read again; the docs said only changed prefixes are read

Files changed:
- `docs/ARCHITECTURE.md`

Problem:
The "Aggregation builder" previews paragraph said that after returning from full-text mode only stages whose prefix changed are read again. A stage whose preview failed is also read again, because the failed run is forgotten (`aggregation-view.ts`), the same retry rule that applies in stage mode.

Fix:
Added one clause: "only stages whose prefix changed, or whose preview failed, are read again". Rewrapped the following line to keep the paragraph's line width. Production code is unchanged.

Validation:
- `npx prettier --check docs/ARCHITECTURE.md` (repo root) — Pass (`*.md` is in `.prettierignore`, so the line was wrapped by hand)

### CR-3 — The failed-preview round-trip test does not assert what is read on return

Files changed:
- `packages/renderer/src/app/aggregation/aggregation-view.spec.ts`

Problem:
The test "a failed preview is not asked again in text mode, and the good ones are kept on return" only asserted that `$match` and `$match $group` were not sent. It would also pass if nothing, or extra pipelines, were sent.

Fix:
Replaced the two `not.toContain` assertions with `expect(sentSince(before)).toEqual(['$match $group $sort'])`, which checks that exactly the failed stage 3 is read again. Added a check that stage 3's live region then reads `Stage 3: 3 documents from a sample`.

Validation:
- `cd packages/renderer && npx ng test --include src/app/aggregation/aggregation-view.spec.ts` — Pass (104 passed)
- `npx prettier --check packages/renderer/src/app/aggregation/aggregation-view.spec.ts` (repo root) — Pass

## Not fixed

### CR-1 — Renumbering a stage makes its live region announce an unchanged result again

Status:
Requires decision (accepted by the parent worker)

Reason:
The parent worker accepted this as is and said not to fix it. It is recorded in the CR-8 disposition.

## Validation summary

Focused tests:
- `cd packages/renderer && npx ng test --include src/app/aggregation/aggregation-view.spec.ts` — 104 passed

Full test suite:
- Not run. Only one spec file and one doc paragraph changed; the parent runs `.taskcheck`.

Lint/type-check/build:
- `npx prettier --check docs/ARCHITECTURE.md packages/renderer/src/app/aggregation/aggregation-view.spec.ts` (repo root) — Pass

`.taskcheck`:
- Not run (left to the parent worker)

Remaining unresolved findings:
1 (CR-1, accepted by the parent worker)

## Final status

All validated findings fixed and validation passed.

# Code Review

Date: 2026-11-16

Task: bson-display - M1: Explorer shows BSON types

Scope: round 2, final revision. `git diff 66ecb35..8f6277a -- packages` (implementation 497b8ca,
test-writer tests f77d5d6, fixes 8f6277a). Round-1 findings re-checked against the fixes in
reviews/bson-display/fixes.md. Only committed changes were reviewed. While this review ran, the working
tree had uncommitted edits to `bson-display.spec.ts` and `bson-value.util.spec.ts` that were not
made by this reviewer; they are outside this scope.

Requirements:
- tasks/bson-display.md (goal, 3 acceptance criteria, 6 recorded assumptions including the CR-1 deferral)
- SPEC.md "Documents and BSON"
- docs/ARCHITECTURE.md, AGENTS.md, docs/QUALITY.md
- Parent dispositions: CR-1 deferred to bson-inputs (assumption recorded), CR-2 resolved by test-writer
  edit-mode tests, CR-3 accepted

Git range:
- Branch: main
- HEAD: 8f6277a4bc83f0115011a3fa007780b5b0d764ea
- Base/start: 66ecb35f86973277474b1a4f7fb01c67bb9680a2
- Commits reviewed: 3 task commits (497b8ca, f77d5d6, 8f6277a); the other commits in the range only
  change `tasks/` (heartbeats, app-layout assumption)

Summary: 0 P0, 0 P1, 0 P2, 1 P3

Validation run by this review:
- `cd packages/renderer && npx ng build` -> success, no CommonJS / whatwg-url warning
  (initial 707.59 kB raw, lazy explorer-demo chunk 439.29 kB)
- `cd packages/renderer && npx ng test --include='src/app/explorer/bson-*.spec.ts'` -> 2 files, 55 tests passed
- `npx eslint packages/renderer/src/app/explorer/bson-value.util.ts packages/core/src/bson` -> clean;
  `npx prettier --check` on `bson-value.util.ts` and `packages/core/package.json` -> clean

Acceptance criteria (final revision):
1. All-types fixture renders with the correct badge per value: met. `bson-display.spec.ts` renders
   `ALL_TYPES_EJSON` from `@thicket/core/testing` and checks every badge, including the badge colors
   and the deprecated marking.
2. No precision loss (Int64 9007199254740993, Decimal128 with 34 digits): met. Text comes from
   `bigint.toString()` and the Decimal128 model string, and tests cover both.
3. Search across BSON values: met. `FilterService` matches the shown text; tests cover Int64,
   Decimal128, ObjectId, UUID, local/UTC dates, nested values, context mode, and the out-of-range date
   fallback.

Round-1 findings and fixes:
- CR-1 (field order of documents in the explorer tree): not changed in code. Deferred as the parent
  decided, and recorded as an assumption in tasks/bson-display.md. It names bson-inputs as the owner
  of an order-preserving container that must exist before edits are saved. Nothing in this task writes
  explorer trees back to the server (`fromExplorerValue` has no callers outside tests), so there is no
  data-loss path in this revision.
- CR-2 (edit-mode read-only behavior): resolved. `bson-display.spec.ts:214-252` turns on edit mode
  through the toolbar. It checks: no `input`/`textarea`/`select` in BSON leaf cells; badges and exact
  text stay; a lock on the four deprecated types only, in both the form and tables layouts; and no
  lock outside edit mode. A test that leaf identity survives a sibling edit is still missing. That is
  minor now that editors cannot be reached, so it is not reported again.
- CR-3 (`fromExplorerValue`): accepted by the parent. The test-writer added round-trip and Int32/Double
  boundary tests (`bson-value.util.spec.ts:44-92`), so it is no longer untested.
- CR-4 (Intl formatter per date): fixed. `bson-value.util.ts:281-309` resolves the system zone once and
  caches one formatter per zone. The output is unchanged, and the date display tests pass.
- TW-1 (Code w/ scope badge token): fixed. `badgeColorVar` maps `javascriptWithScope` to
  `--bson-javascript` (`bson-value.util.ts:185-193`), and the "only names tokens every theme defines"
  test passes.
- TW-2 (RangeError near the JS date limits): fixed. `bson-value.util.ts:274` now also falls back to
  UTC when the local time is not finite. In that branch `t` is always within ±8.64e15, so
  `new Date(t).toISOString()` cannot throw. Covered by unit and component tests.
- Parent P-1 (renderer bundle pulled the CommonJS connection-string code): fixed. A `./bson` subpath
  export was added to `packages/core/package.json`. The renderer's only production import
  (`bson-value.util.ts:12`) and the specs use `@thicket/core/bson`. No renderer file imports the core
  root anymore. The subpath index (`packages/core/src/bson/index.ts`) only reaches the ESM `bson`
  package, and the production build above confirms there is no warning.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-5 | The system time zone is cached for the process lifetime**
    - File: `packages/renderer/src/app/explorer/bson-value.util.ts:281`
    - Category: Correctness
    - Problem: The CR-4 fix stores the system zone in a module variable (`systemZone ??= ...`) the
      first time a date is formatted and never reads it again. Before the fix, every call read
      `Intl.DateTimeFormat().resolvedOptions().timeZone`.
    - Why it matters: In the desktop app, if the user changes the OS time zone while Thicket runs (for
      example after travel), dates keep the old zone name and offset until a restart. The
      result is labelled with that zone, so it is not silently wrong, but it no longer means "local
      time". The impact is small.
    - Suggested fix: Keep the per-zone formatter cache, but read the system zone on each call, which is
      cheap compared with building a formatter. Or document that the zone is fixed for the session.
      This can wait for a later task that adds a time zone setting.

## Review conclusion

No material issues found.

All three acceptance criteria are met by the final revision and covered by passing tests. The
renderer production build succeeds without bundle warnings. The round-1 findings are fixed or were
dispositioned by the parent as recorded. CR-5 is a low-priority note and does not block completion.

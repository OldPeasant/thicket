# Code Review

Date: 2026-11-17

Task: schema-analysis - M3: Schema analysis

Scope (round 3, current): the task's 7 commits `git log f733a778..738dbc16` on top of base f733a778 (121c52a0, dca190ba, b3bb08c2, 2d7dbca4, e471003b, 921fe01f, 738dbc16). Round 2 reviewed the code up to the fix commit, which is now e471003b after the rebase onto the current main (the round-2 hashes f0f755d0 and earlier were the pre-rebase ones). Round 3 confirms that the production code has not changed since e471003b, reviews the tests added in 921fe01f and 738dbc16, and rechecks CR-6. Only committed code was reviewed. The working tree was clean.

Requirements:
- tasks/schema-analysis.md acceptance criteria and recorded assumptions (lines 19-25)
- SPEC.md M3 (schema analysis Must; "click a field type to build a filter" Could)
- docs/ARCHITECTURE.md (stack table, API conventions, Schema analysis section)
- AGENTS.md (evidence, no secrets)
- reviews/schema-analysis/fixes.md (fixer's claims, verified in round 2)

Git range:
- Branch: main
- HEAD: 738dbc166c2b4b1d1ea271d8abc8506307b2d599
- Base/start: f733a77819cd805195c7dc4eb3b5677cfdd6a941
- Commits reviewed: 7 task commits; round 3 focuses on 921fe01f and 738dbc16

Summary: 0 P0, 0 P1, 0 P2, 0 P3 (round 3; CR-6 from round 2 is resolved, see "Round 2 findings, status")

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

None.

## Round 3 verification

- **Production code is unchanged since round 2.** `git diff --stat e471003b..HEAD -- . ':!tasks' ':!reviews'` lists only `packages/backend/src/schema/analyze.spec.ts` (+67 lines). The full `e471003b..HEAD` diff adds only that spec, `reviews/schema-analysis/review.md` and `reviews/schema-analysis/tests.md`. The round-2 conclusions about `analyze.ts`, the renderer panel, `collection-view` and the dependency change still apply as written.
- **New tests in `analyze.spec.ts`.** I checked each one against `isCut` (`analyze.ts:84-97`) and the installed analyzer (`node_modules/@mongodb-js/mongodb-schema/dist/schema-analyzer.js`: `cropString`, `getCappedValue`, `getBSONType`):
    - *Binary and code just below the thresholds* (`:274`): Binary of `limit - 1` bytes is never cut (the cut applies only when `> limit`), and `isCut` drops it only at `>= limit`, so it is kept. Code of `limit - 2` is kept. Code of `limit - 1` is never cut by the analyzer, but it is indistinguishable from a surrogate-pair cut, so `isCut` drops it. The expected values match. The test pins both boundaries of the Binary and Code rules, which round 2 had only covered from above.
    - *Code cut short at a surrogate pair* (`:295`): `limit - 1` plus an emoji gives 1001 code units. `cropString` sees a high surrogate at index 999 and returns 999 characters, which are then dropped, while the type count stays 2. This test would also pass if the analyzer cut to a full `limit`, since that is dropped too. It therefore guards the result (no cut example) rather than the exact cut path. That is the behavior that matters.
    - *Long CodeWScope kept* (`:306`): `getBSONType` returns `CodeWScope` for Code with a scope, and `getCappedValue` passes that through uncapped. Keeping a 5000-character example with its scope is therefore correct, and the test documents that `isCut` deliberately ignores it.
    - *Dropped values take no example slot* (`:316`): 7 cut strings followed by 6 short ones still give 5 one-character examples and a count of 13. This confirms that `continue` before the cap check in `mergeTypes` (`analyze.ts:115-116`) does not let cut values use up the 5 slots.
    - *analyzeCollection with a long server value* (`:588`): raw BSON buffers go through the real decode path, and the 3000-character string is counted but not offered as an example. This is a useful end-to-end check of the unit pipeline.
    - All assertions are on the public result (`fields`, counts, EJSON examples) and not on private state. No existing test was removed or weakened.
    - `npx vitest run src/schema/analyze.spec.ts` (in `packages/backend`) -> 1 file, 63 tests passed.
- **CR-6, resolved.** `tasks/schema-analysis.md:23-25` now records the three decisions: examples are full values only, with the 1000 limit and anything possibly cut dropped (correcting the "200 chars" in assumption line 22); the `@mongodb-js/mongodb-schema` dependency; and the ignored collation (CR-3). The outdated line 22 remains, but line 23 explicitly corrects it. Agents cannot edit earlier notes, so this is the correct way to record the change.

## Round 2 findings, status

- CR-6 (P3) Task assumptions no longer matched the code: resolved (assumptions recorded at `tasks/schema-analysis.md:23-25`).

## Round 1 findings, status

- CR-1 (P2) Truncated examples become equality filters that match nothing: fixed (e471003b, pre-rebase f0f755d0). Round 3 adds boundary tests for it.
- CR-2 (P2) No unit tests for the new pure logic and the panel: fixed (2d7dbca4, pre-rebase 11724df3).
- CR-3 (P3) The query bar's collation is ignored by the analysis: accepted as out of scope and recorded as an assumption (`tasks/schema-analysis.md:25`).
- CR-4 (P3) Deprecated `mongodb-schema` dependency: fixed (e471003b).
- CR-5 (P3) `aria-pressed` on the Schema button: fixed (e471003b).

## Round 2 verification of round-1 fixes (unchanged, still applies)

- CR-1: `isCut` matches the analyzer's `getCappedValue`. Strings and Code count as possibly cut at `>= limit - 1`, and Binary at `>= limit`. CodeWScope and all other types are not capped. The `_bsontype` check is sound because the lock file has a single hoisted `bson`.
- CR-2: `schema-analysis.model.spec.ts`, `schema-panel.spec.ts`, `analyze.spec.ts` and `collection-view.spec.ts` cover the filter merge, older answers arriving out of order (including failures), cancellation, error then retry, and the wiring.
- CR-4: the dependency is `@mongodb-js/mongodb-schema@^12.8.20`. The old package is gone from the lock file and from all imports.
- CR-5: there is no `aria-pressed` on the Schema button, and the spec asserts that.

## Notes (not findings)

- Evidence: `python tasks.py verify schema-analysis` still shows both acceptance criteria unrecorded (`#1 [ ]`, `#2 [ ]`). Before `done`, the parent must run the integration test (`test/integration/schema.int.spec.ts` against the MongoDB container) and the e2e test (`test/e2e/schema-analysis.e2e.ts` via Playwright/Electron) on the final code, and record them with the commands and results. This review did not run those suites. The production code has not changed since round 2, so a run on any commit from e471003b onward is valid for the final code.
- The integration with query-history in `collection-view.{ts,html}` (round 2 notes) is unchanged.

## Review conclusion

No material issues found. The production code is unchanged since the round-2 review, and the five new tests are correct against the code and the installed analyzer and add real boundary coverage. CR-6 is resolved by the recorded assumptions. The only remaining item before `done` is the parent's acceptance-criterion evidence (integration and e2e runs, recorded with `tasks.py verify`).

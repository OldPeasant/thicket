# Code Review

Date: 2026-11-16

Task: bson-inputs - M1: Explorer edits BSON values without changing types (round 2, final code after fixes)

Scope: `git diff 0960ae4..HEAD -- . ':!tasks' ':!reviews'`. This covers task commits 57ea653, e596035, ba4f4d0, c3aa44c (fixes) and efebada (round-2 tests). The fix commit c3aa44c was read in full against the round-1 findings.

Requirements:
- tasks/bson-inputs.md acceptance criteria and recorded assumptions
- SPEC.md "Documents and BSON"
- docs/ARCHITECTURE.md, AGENTS.md project notes
- packages/core/src/bson/convert.ts and iso-date.ts (bson-model conversion table, ISO parser)
- Round-1 reports: reviews/bson-inputs/review.md (CR-1..CR-6), fixes.md, tests.md

Git range:
- Branch: main
- HEAD: efebada9b9c9952dc387869a76c782f9e04cda52
- Base/start: 0960ae48e45e9a930ed13f45d31c222c327ddba2
- Commits reviewed: 5. There were no uncommitted changes when the review started.

Commands run:
- `cd packages/renderer && npx ng test --include=<bson-input.util, bson-input.component, bson-inputs, editable-value.component, bson-value.util specs>`: 5 files, 212 tests passed

Summary: 0 P0, 0 P1, 1 P2, 1 P3

Round-1 findings, checked against the current code:
- CR-1 (date text round trip): resolved. `commit` skips parsing when the text equals `partText(part)`. `parseDate` reads `±HH:MM:SS` offsets: the base is parsed as UTC and the offset is subtracted, with the sign handled correctly. It also reads bare epoch milliseconds within the Int64 range. Tests cover pre-1894 Zurich and out-of-range dates. The bare-millisecond path adds a new issue, reported as CR-1 below.
- CR-2 (type-dropdown cost): resolved. Options are memoized by value identity and by the schema's `typesFor` array, which `SchemaService.typeCache` keeps stable. The template reads them once through `@let`. Non-empty containers are checked with an empty shell of the same type, so subtrees are no longer copied. Core `convert` decides object and array conversions by type alone, so the result does not change. Tests compare the options with `convertValue`.
- CR-3 (number default ownership): partly resolved. `fromExplorerValue` accepts the setting, but no production caller passes it, and the badge still ignores it. See CR-2 below.
- CR-4 (stale error): resolved. `ngOnChanges` clears the error and rewrites the input that held the invalid text. Tests cover both.
- CR-5 (move buttons with schema order): resolved. Move buttons are hidden when the schema declares this object's keys. `keyIndex` is memoized with the fields, which removes the O(n²) cost. A test covers it.
- CR-6: not fixed, by recorded parent decision (explorer data in Thicket is BSON). Not re-raised.

Criteria check:
- Int64 stays Int64, overflow shows an error, invalid ObjectId is rejected: met. Component tests are in bson-inputs.spec.ts and bson-input.component.spec.ts.
- Dropdown follows bson-model `convert`, and impossible conversions are disabled with a reason: met. `typeOptions` and its tests cover it. The empty-value exception is a recorded assumption.
- New numbers follow the setting, and fields can be moved: met for typed numbers (`NumberDefaultService`, `commitNumber`) and for `moveEntry` and the form move buttons, with tests. The gap is CR-2.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | Date input silently reads any bare integer as epoch milliseconds (typing a year gives a 1970 date)**
    - File: `packages/renderer/src/app/explorer/bson-input.util.ts:152-156`
    - Category: Correctness
    - Problem: the CR-1 fix added `if (INT_TEXT.test(t)) return ok({ type: 'date', ms: BigInt(t) })` ahead of ISO parsing, for every date. Before, text like `2024` or `20240501` was rejected with "is not an ISO-8601 date", because core `parseIsoDate` needs `YYYY-MM-DD`. Now it is accepted and saved as `1970-01-01T00:00:02.024Z` or `1970-01-01T05:37:20.501Z`, with no error. The placeholder still says `ISO-8601`. The bare form is only needed for dates outside the JS date range, which `formatDate` shows as their millisecond count. Fix (a) in `commit` already covers the unchanged case, because the shown text is never parsed.
    - Why it matters: a plausible user input, a year or a compact date, is turned into a wrong date without a warning. The task's typed inputs exist so that edits are validated and do not change values unexpectedly.
    - Suggested fix: accept a bare integer only when its magnitude is outside the JS date range (`|ms| > 8_640_000_000_000_000`). Otherwise keep the ISO error, or ask for an explicit form. Add a test that `2024` is rejected, or not read as milliseconds.

## P3 Low

- [ ] **CR-2 | The integer-default setting is still not applied to plain numbers that were not edited (badge and type dropdown)**
    - File: `packages/renderer/src/app/explorer/bson-value.util.ts:123-133` (`bsonTypeOf`), `:78` (`fromExplorerValue`); `packages/renderer/src/app/explorer/bson-input.util.ts:325` (`convertValue` calls `fromExplorerValue(value)` without the setting)
    - Category: Integration
    - Problem: the CR-3 fix added an `integers` parameter to `fromExplorerValue`. Nothing in production passes it: the only caller is `convertValue`, which uses the default `'int32'`. `bsonTypeOf`, and through it `currentTarget`, the badge and the dropdown's selected type, still labels a plain integer as Int32 whatever `defaultIntegerType` is. With the setting `double`, a schema-seeded `5` shows Int32 until it is edited, then becomes a Double. Fixes.md states this openly. The document save path does not exist yet, so nothing is stored wrongly today.
    - Why it matters: the type shown is not the type that a setting-aware save would write, and the setting still has no single owner. Once a save path exists, it has to remember to pass the setting.
    - Suggested fix: when the save or serialize path is added (a later task), route it through `NumberDefaultService.integers()`. Better, turn seeded plain numbers into `BsonLeaf`s through `NumberDefaultService` when they are inserted, so the badge, the dropdown and the saved type agree. Otherwise, record the gap as an assumption on the task.

## Review conclusion

Material issues found; fix before completing the task. CR-1 to CR-5 from round 1 are resolved, CR-3 only partly (see CR-2 here), and the tests pass. The one P2, CR-1 (bare integers read as epoch milliseconds in the date input), is a regression from the round-1 date fix and should be fixed or explicitly accepted by the parent worker. CR-2 is low priority and can be recorded as an assumption or follow-up.

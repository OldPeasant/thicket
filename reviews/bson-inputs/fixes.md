# Fix Report

Date: 2026-11-16

Task: bson-inputs - M1: Explorer edits BSON values without changing types (round 2)

Scope: current task. Round-2 findings CR-1 (P2) and CR-2 (P3) from `reviews/bson-inputs/review.md` (reviewed HEAD efebada), as approved by the parent worker. Changes are limited to `packages/renderer/src/app/explorer`. They are left uncommitted in the working tree for the parent worker to commit.

Round 1 (summary): fixed CR-1/TW-1/TW-2 (date text round trip: unchanged text is not re-parsed, plus `±HH:MM:SS` offsets and bare milliseconds), CR-2 (type-dropdown options memoized, containers checked with an empty shell), CR-3 (`fromExplorerValue` takes the integer setting), CR-4 (stale error cleared on outside change), and CR-5 (move buttons hidden under schema key order). CR-6 was not fixed, by parent decision. Commit c3aa44c.

## Fixed findings

### CR-1 — Date input silently reads any bare integer as epoch milliseconds (typing a year gives a 1970 date)

Files changed:
- `packages/renderer/src/app/explorer/bson-input.util.ts`
- `packages/renderer/src/app/explorer/bson-value.util.ts` (only exports the existing `DATE_LIMIT_MS` constant)
- `packages/renderer/src/app/explorer/bson-input.util.spec.ts`
- `packages/renderer/src/app/explorer/bson-input/bson-input.component.spec.ts`

Problem:
`parseDate` accepted every bare signed integer as epoch milliseconds. So `2024` was saved as `1970-01-01T00:00:02.024Z` and `20240501` as a 1970 date, with no error.

Fix:
A bare integer is still checked against Int64 first and gets the "overflows" error outside it. It is now accepted only when it lies outside the JS Date range (`|ms| > DATE_LIMIT_MS`, i.e. 8_640_000_000_000_000). Otherwise it is rejected with `"<text>" is not an ISO-8601 date`, as it was before round 1. `editText`/`formatDate` show bare milliseconds only for dates outside that range, so every shown text still parses back. The component also skips parsing when the text has not changed (round-1 fix (a)). `DATE_LIMIT_MS` is reused from `bson-value.util.ts` (now exported) rather than duplicated. The doc comment on `parseDate` was updated.

Test changes:
- `reads a bare signed integer ... as milliseconds`: removed `1700000000000` (now rejected by the approved rule). Added `±8640000000000001`. The Int64 ends and overflow cases are kept.
- `accepts the lowest Int64 milliseconds ...`: removed `parseDate('-0')` → `0n`, which contradicts the rule (0 is within range). It is now asserted as rejected in the new test.
- New test `rejects a bare integer within the JS date range as not ISO-8601`: `2024`, `20240501`, `1700000000000`, `0`, `-0`, `±8640000000000000`, in UTC and Zurich.
- Round-trip test for bare ms shown for out-of-range dates: added `±8640000000000001`.
- New component test: typing `2024` into a date input shows the ISO-8601 error and emits nothing.

Validation:
- `cd packages/renderer && npx ng test`: Pass (52 files, 1224 tests)

## Not fixed

### CR-2 — The integer-default setting is not applied to plain numbers that were not edited (badge and type dropdown)

Status:
Out of scope (would need broad plumbing; deferred as the reviewer suggested)

Reason:
Passing the setting only to the `fromExplorerValue(value)` call in `convertValue` is not a safe local change. `currentTarget` → `bsonTypeOf` would still call a plain `5` Int32 while `convertValue` treats it as Int64 or Double. With the setting `int64`, choosing "Int64" would then hit the `converted === from && currentTarget(value) !== target` guard and be wrongly disabled ("it already is one"). Choosing "Int32" would convert a value the badge already shows as Int32. A consistent fix has to thread the setting through `bsonTypeOf`, `badgeOf`, `currentTarget`, `convertValue`, `typeOptions` and the `EditableValueComponent` badge and options memo, whose key would also need the setting. That is 2 util files plus the component. Today it only affects the label of unedited plain numbers, and no save path exists yet. The reviewer's own suggestion is to handle it when the save/serialize path is added, or to seed plain numbers as `BsonLeaf`s through `NumberDefaultService`. The parent worker should record this as an assumption or follow-up.

## Validation summary

Focused tests:
- `cd packages/renderer && npx ng test`: Pass, 52 files, 1224 tests

Full test suite:
- `npm run check` (repo root): Pass. eslint with `--max-warnings 0` and prettier `--check` ran, then the type check, then core/other tests (46 files, 2829 tests) and renderer tests (52 files, 1224 tests), all passed.

Lint/type-check/build:
- Included in `npm run check`: Pass

`.taskcheck`:
- Pass (it runs `npm run check`, above)

Remaining unresolved findings:
1 (CR-2, P3, deferred: out of scope for a minimal fix)

## Final status

All validated findings fixed and validation passed. The P2 is fixed. The P3 (CR-2) is deliberately not fixed because it would need broad plumbing, and the parent worker should record it as an assumption or follow-up.

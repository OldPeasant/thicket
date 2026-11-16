# Fix Report

Date: 2026-11-16

Task: bson-inputs - M1: Explorer edits BSON values without changing types

Scope: current task. Findings CR-1..CR-6 from `reviews/bson-inputs/review.md` and TW-1, TW-2 from `reviews/bson-inputs/tests.md`, fixed as the parent worker approved. The code under fix is HEAD 362a402 (task commits ba71ffa, b47a8f5, 362a402 on base fc84d7a). All changes are uncommitted working-tree changes: the fixer does not stage files, so the parent worker commits them.

## Fixed findings

### CR-1 / TW-1 / TW-2 — Date text input reports an error for unchanged dates (LMT offsets, dates outside the JS range)

Files changed:
- `packages/renderer/src/app/explorer/bson-input/bson-input.component.ts`
- `packages/renderer/src/app/explorer/bson-input.util.ts`
- `packages/renderer/src/app/explorer/bson-input.util.spec.ts`

Problem:
`commit` parsed every blur, and `parseDate` could not read two forms that `editText` shows: offsets with seconds (`+00:34:08`, local mean time) and the bare millisecond count shown for dates outside the JS range. Tabbing through such an input showed an error, and that text could not be edited.

Fix:
- (a) `BsonInputComponent.commit` does nothing when the input text equals the text shown for that part: no parse and no emit. If this input is the one holding the current error, the error is cleared, since the text is valid again.
- (b) `parseDate` reads a bare signed integer as epoch milliseconds, range-checked against Int64 with an "overflows" error. It also reads a `±HH:MM:SS` offset: the rest of the text is parsed as UTC and the offset is subtracted. Hours must be below 24 and minutes/seconds below 60; calendar validation still happens in core `parseIsoDate`.
- Test change: the test-writer's `parseDate > rejects text that is not ISO-8601` listed `'1700000000000'` as invalid. That contradicts approved requirement (b), so I replaced that case with `'1.5'` and `'1e3'` (still rejected). New tests cover bare milliseconds (including Int64 bounds and overflow) and seconds offsets (including invalid ones). No other assertion was weakened.

Validation:
- `cd packages/renderer && npx ng test`: Pass. The 3 TW tests (`editText > the shown date text parses back when the offset has seconds`, `leaving an untouched input > Date before 1894 in Zurich`, `> Date outside the JS date range`) now pass.

### CR-2 — Type dropdown deep-converts every container's subtree on each change detection

Files changed:
- `packages/renderer/src/app/explorer/editable-value/editable-value.component.ts`
- `packages/renderer/src/app/explorer/editable-value/editable-value.component.html`
- `packages/renderer/src/app/explorer/bson-input.util.ts`
- `packages/renderer/src/app/explorer/bson-input.util.spec.ts`, `editable-value/editable-value.component.spec.ts`

Problem:
The `typeOptions` getter ran twice per render, and each run called `convertValue` 18 times, deep-copying container subtrees each time.

Fix:
- `EditableValueComponent.typeOptions` is memoized by value identity (`Object.is`) and by the schema's allowed-type list. The template reads it once per render with `@let types = typeOptions`.
- `typeOptions()` in bson-input.util checks a non-empty document or array by converting an empty one of the same type. Core `convert` decides object and array conversions by type alone, so the result and reason text are the same, and the subtree is never copied. Empty containers still use `convertValue` (empty-value rule).
- New tests: options for filled documents and arrays equal what `convertValue` allows, reason text included. The memo returns the same array while the value and schema types are unchanged, and it recomputes when either changes.

Validation:
- `cd packages/renderer && npx ng test`: Pass

### CR-3 — `defaultIntegerType` not applied by `fromExplorerValue`

Files changed:
- `packages/renderer/src/app/explorer/bson-value.util.ts`
- `packages/renderer/src/app/explorer/bson-input.util.ts`
- `packages/renderer/src/app/explorer/bson-value.util.spec.ts`

Problem:
`fromExplorerValue` always turned plain JS numbers into Int32 or Double, whatever the integer-default setting said.

Fix:
- `newNumber` and `IntegerDefault` moved into `bson-value.util.ts`. bson-input.util already imports bson-value.util, so this avoids a circular import. bson-input.util re-exports both, so existing imports keep working.
- `fromExplorerValue(value, integers = 'int32')` maps plain numbers with `newNumber(value, integers)` and passes `integers` down to nested values. With the default `'int32'` the result is the same as before (existing tests unchanged).
- New test: int32, int64 and double settings, a large safe integer under int64, a fraction, nested containers, and an existing BsonLeaf keeping its type.
- Note for the parent worker: no production caller passes the setting yet. Today the only caller is `convertValue`, and the document save path is outside this package's explorer. Callers that serialize documents can now pass `NumberDefaultService.integers()`. The badge (`bsonTypeOf`) for an unedited plain number still shows Int32/Double. The parent did not ask for a badge change.

Validation:
- `cd packages/renderer && npx ng test`: Pass

### CR-4 — Stale error and invalid text remain after the value changes elsewhere

Files changed:
- `packages/renderer/src/app/explorer/bson-input/bson-input.component.ts`
- `packages/renderer/src/app/explorer/bson-input/bson-input.component.spec.ts`

Problem:
`error` and the invalid DOM text stayed after an outside change (type dropdown, undo) when the shown text was the same as before, because the `[value]` binding did not rewrite the DOM.

Fix:
- The component remembers which input (and part) holds the invalid text.
- `ngOnChanges` on later `value` changes clears the error and writes the new part text into that input if it is still connected.
- `revert` and successful commits clear the same state through `clearError()`.
- New tests:
  - Int64 `7`, type `abc`, then set the value to Int32 `7` from outside: no error, input shows `7`, no `invalid` class, nothing emitted.
  - Retyping the shown text after an error clears the error without emitting.

Validation:
- `cd packages/renderer && npx ng test`: Pass

### CR-5 — Move buttons use document order while the form shows schema order

Files changed:
- `packages/renderer/src/app/explorer/json-form/json-form.component.ts`
- `packages/renderer/src/app/explorer/json-form/json-form.component.html`
- `packages/renderer/src/app/explorer/bson-inputs.spec.ts`

Problem:
With schema-declared keys the rows are in schema order, but moves used document order. `fieldIndex` also called `orderedKeys` once per row, which is O(n²).

Fix:
- Move buttons are shown only when `schema.declaredKeys(uid)` is empty (`canMove`). The delete button stays.
- The field memo (now a named `FieldMemo` interface, reached through a private `memo` getter that `fields` uses) also holds a `keyIndex` map built once per value from `orderedKeys`. `fieldIndex` and `fieldCount` read that map.
- New test: with schema `{"properties":{"b":{},"a":{}}}` and data `{a,b}`, the rows show `b, a`, there are no move buttons, and delete is still present. The existing field-order tests (no schema) still pass.

Validation:
- `cd packages/renderer && npx ng test`: Pass

## Not fixed

### CR-6 — Plain-JSON number edits now serialize as canonical EJSON

Status:
Out of scope (not fixing, parent decision)

Reason:
The parent worker decided to leave this as it is. Explorer data in Thicket is BSON, and plain JS numbers only come from schema seeds and defaults. No code was changed for this finding.

## Validation summary

Focused tests:
- `cd packages/renderer && npx ng test` after the CR-1 code change: 1 failure. It was the test-writer's `'1700000000000'` rejection case, which conflicts with approved requirement (b), and I changed that test as described above.
- `cd packages/renderer && npx ng test` (final): Pass, 50 files, 1028 tests (1020 before + 8 new), 0 failed

Full test suite:
- `sh .taskcheck` (`npm run check`): Pass. Core and other workspaces: 46 files, 2829 tests. Renderer: 50 files, 1028 tests.

Lint/type-check/build:
- `npm run typecheck -w packages/renderer`: Pass
- `npm run lint` (repo root, ESLint + Prettier check): Pass. `npx prettier --write` was run on all changed files.

`.taskcheck`:
- Pass

Remaining unresolved findings:
1 (CR-6, deliberately not fixed per the parent worker)

## Final status

All validated findings fixed and validation passed. CR-6 is not fixed by parent decision.

# Code Review

Date: 2026-11-16

Task: bson-inputs - M1: Explorer edits BSON values without changing types

Scope: production code of task commits ba71ffa and b47a8f5 on top of base fc84d7a (`git diff fc84d7a..b47a8f5 -- packages`); test-writer changes made at the same time are not part of this review.

Requirements:
- tasks/bson-inputs.md acceptance criteria and recorded assumptions
- SPEC.md "Documents and BSON"
- docs/ARCHITECTURE.md, AGENTS.md (project notes, quality sub-agent boundaries)
- packages/core/src/bson/convert.ts and iso-date.ts (bson-model conversion table and ISO parser)

Git range:
- Branch: main
- HEAD: b47a8f5b94e74e0751097848c20381a3f23a8be4
- Base/start: fc84d7a400ffc80511c5e7337fabf160126c7369
- Commits reviewed: 2 (ba71ffa, b47a8f5); no uncommitted changes at review start

Commands run:
- `cd packages/renderer && npx ng test --include=src/app/explorer/bson-inputs.spec.ts` -> 1 file, 22 tests passed
- `node -e` with `Intl.DateTimeFormat` for Europe/Berlin at 1800-01-01T00:00Z -> wall clock `00:53:28` (offset with seconds, used for CR-1)

Summary: 0 P0, 0 P1, 3 P2, 3 P3

Criteria check:
- Int64 stays Int64, overflow error, invalid ObjectId rejected: met (`parseInt64`/`parseInt32` use BigInt range checks, `parseObjectId` checks 24 hex; component tests in bson-inputs.spec.ts).
- Dropdown follows core `convert`, impossible ones disabled: met (`typeOptions` enables an option exactly when `convertValue` succeeds; the empty-value exception is a recorded assumption).
- New numbers per setting, fields movable, order kept with integer-like keys: met on the tested paths (`NumberDefaultService`, `moveEntry`, `KEY_ORDER` in key-order.util.ts). CR-3 covers a gap in the number default.
- No `eval`/`Function` anywhere in the change; ObjectId/UUID generation uses `crypto.getRandomValues`.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | Date text input reports an error for unchanged dates with an LMT offset or outside the JS date range**
    - File: `packages/renderer/src/app/explorer/bson-input.util.ts:145` (with `editText` at line 218 and `formatOffset` in `bson-value.util.ts:317`)
    - Category: Correctness
    - Problem: `editText` shows `formatDate(...)`. For historical dates in local mode the offset has seconds (Europe/Berlin before 1893 is `+00:53:28`, checked with `Intl.DateTimeFormat`), so the input shows e.g. `1800-01-01T00:53:28.000+00:53:28 Europe/Berlin`. `parseDate` removes the zone name, the text does not match `WALL_TIME`, and core `parseIsoDate` only accepts `±HH:MM` offsets. The parse fails. Dates outside the JS range show only the millisecond count (`8640000000000001`), which `parseDate` also rejects. `commit` runs on every blur, so focusing the input and tabbing away without typing shows "is not an ISO-8601 date". The user can't apply a text edit in the text form shown for these dates, and dates outside the JS range have no picker either.
    - Why it matters: the criterion says editing never fails on a valid value. Imported historical data such as birth dates in LMT zones gives a false error and blocks ISO text editing.
    - Suggested fix: in `parseDate`, accept an `±HH:MM:SS` offset (or treat text equal to `editText(current)` as unchanged), and parse a bare integer as epoch ms for dates outside the JS range. Add a test for a pre-1893 Europe/Berlin date.

- [ ] **CR-2 | Type dropdown deep-converts every container's whole subtree 36 times per change detection**
    - File: `packages/renderer/src/app/explorer/editable-value/editable-value.component.ts:109` (template `editable-value.component.html:18` and `:27`), `bson-input.util.ts:304-333`
    - Category: Quality (performance)
    - Problem: the `typeOptions` getter runs `typeOptions(this.value)` twice per change detection (once for `typeOptions.length > 1`, once in `@for`). Each call runs `convertValue` for 18 targets. Each `convertValue` calls `fromExplorerValue(value)`, a full deep copy of the subtree, and for object/array targets it also runs `convert` and `toExplorerValue` on the whole subtree. In edit mode `<app-editable-value>` is rendered for container values too (`json-form.component.html:90`, `json-table.component.html:12`). One change detection therefore costs about 36 x subtree size for every visible container, summed over all nesting levels. The old getter filtered a constant list.
    - Why it matters: under zoneless change detection every template event (click, blur, Enter) re-renders. A large document or deep nesting makes every interaction in edit mode slow. SPEC expects documents large enough to need paging.
    - Suggested fix: memoize the options per value reference, as `JsonFormComponent.fieldMemo` does, or use a `computed` from a signal input. For containers, decide availability from the type alone (object to array, array to object, null/minKey/maxKey, empty-value rule) without converting the subtree.

- [ ] **CR-3 | `defaultIntegerType` is applied only when a plain number is re-typed; other paths ignore it**
    - File: `packages/renderer/src/app/explorer/editable-value/editable-value.component.ts:156-161`, `packages/renderer/src/app/explorer/bson-value.util.ts:82-83`
    - Category: Integration
    - Problem: two places decide the BSON type of a new plain number, and only one follows the setting. `commitNumber` uses `NumberDefaultService` but returns early when the number did not change (`next === this.value`). A plain number that was seeded (schema default or `seedFor`) and never edited keeps its JS number form. `fromExplorerValue` then turns it into Int32/Double no matter what the setting says, and `bsonTypeOf` labels it Int32. Scenario: with `defaultIntegerType = 'double'`, add a field whose schema default is `5` and save without editing it. It is stored as Int32. Edit it to `6` and it becomes a Double.
    - Why it matters: SPEC says "the default can be changed in settings", but the stored type depends on whether the user touched the input. The architecture should have one owner for this decision.
    - Suggested fix: apply the setting where plain numbers enter the tree (wrap seeds and defaults in a `BsonLeaf` through `NumberDefaultService` when they are inserted), or route the `fromExplorerValue` number branch through the same setting. Make the badge match.

## P3 Low

- [ ] **CR-4 | Stale error and invalid text remain after the value changes elsewhere**
    - File: `packages/renderer/src/app/explorer/bson-input/bson-input.component.ts:48`, `:163-172`
    - Category: Correctness
    - Problem: `error` is a plain field that only `commit`, `revert`, `commitWallTime` and `generate` clear. The input's `[value]="text"` binding writes the DOM only when `text` changes. Scenario: an Int64 `7`. Type `abc` and blur, so the error is shown. Then switch the type dropdown to Int32. The component is reused (same `@default` branch) and `text` is still `"7"`, so the DOM keeps `abc` and the stale "is not an integer" error stays under a valid Int32 7. Undo, Revert or a reload that changes the value also leaves the old error.
    - Why it matters: the error describes a value that is no longer there, which is confusing. It is not a data problem, because nothing invalid is applied.
    - Suggested fix: make `value` a signal input, or use an `ngOnChanges` setter, that clears `error` and rewrites the input text when the value changes.

- [ ] **CR-5 | Move buttons use document order while the form shows schema order**
    - File: `packages/renderer/src/app/explorer/json-form/json-form.component.ts:323-338`, `json-form.component.html:97-121`, `form-fields.util.ts:27-40`
    - Category: Correctness
    - Problem: `formFields` lists schema-declared keys in schema order first. `fieldIndex`/`moveField` and the disabled state use `orderedKeys` (document order). With a schema declaring `[b, a]` and data `{a, b}`, the first row shown (`b`) has "up" enabled and the second (`a`) has it disabled. Clicking moves the data, but the rows on screen do not move.
    - Why it matters: this only happens when a schema is active, which the dev explorer uses and Thicket does not yet use for documents. The controls then look broken.
    - Suggested fix: hide or disable the move buttons for schema-declared fields, or compute neighbors from the displayed field list. Calling `orderedKeys` once per render instead of once per field (`fieldIndex` in the `@for`, O(n^2)) would also remove the quadratic cost.

- [ ] **CR-6 | Plain-JSON number edits now serialize as canonical EJSON**
    - File: `packages/renderer/src/app/explorer/editable-value/editable-value.component.ts:156-161`
    - Category: Integration
    - Problem: `commitNumber` now always emits `new BsonLeaf(...)`, including in the plain-JSON explorer modes (dev page, JSON Lines). `json-lines.util.ts:83` writes `JSON.stringify(value)`, so editing `5` to `6` in a JSON line produces `{"$numberInt":"6"}` instead of `6`.
    - Why it matters: this is a behavior change in the reference explorer's plain-JSON editing. It does not affect BSON documents, where numbers are already leaves.
    - Suggested fix: if JSON Lines and plain JSON remain supported, keep plain numbers in those modes (for example, a flag from the explorer that BSON typing is active). Otherwise record that plain-JSON editing is out of scope.

## Review conclusion

Material issues found; fix before completing the task. No P0 or P1 issues. The three P2 findings (CR-1 date text round-trip, CR-2 type-dropdown cost on containers, CR-3 number-default ownership) should be fixed or explicitly accepted by the parent worker. The acceptance criteria are implemented and covered by passing component tests.

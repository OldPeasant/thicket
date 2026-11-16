# Code Review

Date: 2026-11-16

Task: bson-display - M1: Explorer shows BSON types

Scope: `git diff 66ecb35..4cada5f -- packages` (committed implementation of bson-display; package-lock.json change inspected, one added workspace link)

Requirements:
- tasks/bson-display.md (goal, 3 acceptance criteria, 5 recorded assumptions)
- SPEC.md "Documents and BSON"
- docs/ARCHITECTURE.md (core is pure TS shared with the renderer; conventions)
- AGENTS.md, docs/QUALITY.md
- tasks/bson-inputs.md (follow-up scope: typed editors, type dropdown, number default, field reorder)

Git range:
- Branch: main
- HEAD: 4cada5f22fd3b713172f72cc5d50e76f3c928d30
- Base/start: 66ecb35f86973277474b1a4f7fb01c67bb9680a2
- Commits reviewed: 1 (4cada5f)

Summary: 0 P0, 0 P1, 2 P2, 2 P3

Acceptance criteria check (from the code and a local run of
`cd packages/renderer && npx ng test --include='src/app/explorer/bson-display.spec.ts'` -> 9 passed;
`npx eslint` and `npx prettier --check` on the changed folders -> clean):
1. All-types fixture with correct badge per value: met. `bson-display.spec.ts` renders `ALL_TYPES_EJSON`
   from `@thicket/core/testing`, asserts the expected key list equals the fixture's keys, and checks
   each badge (including `Binary 0xNN`, `UUID`, `Code w/ scope`, Object/Array).
2. No precision loss (Int64 9007199254740993, Decimal128 34 digits): met. Display goes through
   `bigint.toString()` and the Decimal128 model string; tests cover 9007199254740993, Int64 min/max,
   34-digit integer and fractional Decimal128 and the Decimal128 max.
3. Search across BSON values: met. `FilterService.valueMatch` matches the displayed text; tests cover
   Int64, Decimal128, ObjectId, UUID, local/UTC dates, and nested values in tables layout.

Not verified by this review: the renderer production build (`ng build`) now that the renderer imports
`@thicket/core` (which pulls in `bson` and `mongodb-connection-string-url`); `npm run check` does not
build the renderer. The parent worker should confirm the build path once.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | Explorer tree reorders integer-like keys and drops repeated keys of a BSON document**
    - File: `packages/renderer/src/app/explorer/bson-value.util.ts:53`
    - Category: Correctness
    - Problem: `toExplorerValue` turns a BSON document into a plain JS object. JS objects always list
      integer-like keys first, and a repeated key keeps only its last value. A document such as
      `{"b":1,"1":2}` is shown as `1, b`, and a document with a repeated key shows only one of them.
      The task file records this as an assumption, but the code does not warn the user.
    - Why it matters: SPEC.md "Documents and BSON" requires (Must) "Field order is preserved". The
      explorer is the document view, so it shows a field order that is not in the stored document.
      The unused inverse `fromExplorerValue` (CR-3) rebuilds documents from this lossy tree. If
      bson-inputs saves edits through it, the reordering and dropped keys would be written back to
      the server, which is data loss.
    - Suggested fix: Keep the assumption visible to the humans reviewing assumptions. Before
      bson-inputs saves edits through this tree, switch to an order-preserving container, such as a
      field list kept next to the object or a `Map`. At least add a test that pins the current
      behavior so the limitation can't regress silently.

- [ ] **CR-2 | Read-only behavior of BSON values in edit mode has no tests**
    - File: `packages/renderer/src/app/explorer/editable-value/editable-value.component.html:1`
    - Category: Tests
    - Problem: The task goal includes "deprecated types read-only". The implementation does this in
      edit mode: the `type !== 'bson'` guard hides the editors, and the lock 🔒 appears only when
      `deprecated && editMode.enabled()`. `bson-display.spec.ts` never turns on `EditModeService`, so
      no test covers either behavior. No test checks that the type dropdown is missing for BSON
      leaves. No test checks that editing a sibling field leaves BSON leaves unchanged; both
      `json-form.component.ts:282` and the `withEntry`/`withoutEntry` helpers act on these leaves.
    - Why it matters: bson-inputs will rewrite this template branch. Without a test, a change could
      make deprecated values (Undefined, Symbol, DBPointer, Code w/ scope) editable or convertible.
      SPEC forbids that: deprecated values are "kept unchanged".
    - Suggested fix: Add a component test that turns on edit mode on the all-types fixture. It should
      assert: no `select`/`input` inside the BSON value cells; a `.lock` on the deprecated fields; and
      after editing a plain sibling (for example `string`), `valueChange` still contains the same
      `BsonLeaf` instances for `int64` and `undefined`.

## P3 Low

- [ ] **CR-3 | `fromExplorerValue` is unused, untested, and decides the numeric default**
    - File: `packages/renderer/src/app/explorer/bson-value.util.ts:85`
    - Category: Quality
    - Problem: Nothing in `packages/` calls `fromExplorerValue`, and no test covers it. It hard-codes
      "integers that fit become Int32, otherwise Double". SPEC makes that default configurable in
      settings, and the follow-up task bson-inputs owns it ("New numeric value defaults per setting").
    - Why it matters: Dead code that makes a product decision early. The next task may take this
      untested function as the settled conversion.
    - Suggested fix: Remove it here and let bson-inputs add the inverse mapping with the settings
      default and tests. If it stays, add unit tests and note that the default is provisional.

- [ ] **CR-4 | A new `Intl.DateTimeFormat` is built for every date on every render and search**
    - File: `packages/renderer/src/app/explorer/bson-value.util.ts:262` and `:270`
    - Category: Quality
    - Problem: Without a fixed zone, `formatDate` builds one `Intl.DateTimeFormat` to find the
      system zone. `zoneOffsetMs` then builds another for each call. The `bsonText` getter in
      `editable-value.component.ts` calls `formatDate` on every change detection. When a filter is
      active, `FilterService.valueMatch` calls it for every Date leaf in the tree.
    - Why it matters: Building an `Intl.DateTimeFormat` is slow compared with formatting. On
      documents or arrays with many dates, every key press in the search box rebuilds two formatters
      per date, which slows typing.
    - Suggested fix: Cache the formatter for each time zone (a small `Map<string, Intl.DateTimeFormat>`)
      and read the system zone once.

## Review conclusion

Material issues found; fix before completing the task.

All three acceptance criteria are met and covered by passing tests. No finding blocks the criteria.
The P2 items are a SPEC field-order gap, accepted only as an assumption, and a missing test for the
edit-mode read-only behavior. The parent worker should decide whether to fix them now or record them
for bson-inputs.

# Code Review

Date: 2026-11-16

Task: bson-inputs - M1: Explorer edits BSON values without changing types (round 3, final code)

Scope: `git diff 8cd7900..f505991 -- . ':!tasks' ':!reviews'`. These are the task commits 9351828, a1f3dfc, 2b10d2c, b3c6e8b, 4b1c5e3 and f505991. The later commits ef8b4f6 and 0e70a0a touch only `reviews/`. The round-2 fix commit f505991 was read in full. The rest of the task was checked briefly against the criteria, because rounds 1 and 2 already reviewed it in full.

Requirements:
- tasks/bson-inputs.md acceptance criteria and recorded assumptions, including the 23:32 assumption that defers round-2 CR-2
- SPEC.md "Documents and BSON"
- docs/ARCHITECTURE.md, AGENTS.md project notes
- Round-2 reports: reviews/bson-inputs/review.md (CR-1, CR-2) and fixes.md

Git range:
- Branch: main
- HEAD: 0e70a0a (the final code is at f5059914321accfcdb23b0cfa4bac86700fcd667)
- Base/start: 8cd79004a2366c4e26eabc9767cc2cde28820f73
- Commits reviewed: 6 code commits. The working tree was clean.

Commands run:
- `cd packages/renderer && npx ng test` with `--include` for bson-input.util, bson-input.component, bson-inputs, editable-value.component, bson-value.util, key-order.util and number-default.service specs: 7 files, 243 tests passed

Summary: 0 P0, 0 P1, 0 P2, 0 P3

Round-2 findings, checked against the current code:
- CR-1 (bare integers read as epoch ms by the date input): resolved.
    - `parseDate` (`bson-input.util.ts:157-162`) still rejects values outside Int64 with "overflows".
    - It now accepts a bare integer only when `|ms| > DATE_LIMIT_MS`. Inside the JS date range it returns the earlier "is not an ISO-8601 date" error.
    - `DATE_LIMIT_MS` is exported from `bson-value.util.ts`, so it is not duplicated.
    - `formatDate` uses the same strict bound (`bson-value.util.ts:282`), and `editText` strips only that suffix (`bson-input.util.ts:245`). So every bare number the input shows still parses back. Tests check this at ±(limit + 1) and at the Int64 ends, in UTC and Zurich.
    - Near-limit dates whose local wall time leaves the range fall back to a UTC `…Z` string, which `parseIsoDate` reads. No round-trip regression.
    - New tests reject `2024`, `20240501`, `1700000000000`, `0`, `-0` and ±limit in both zones. A component test checks that typing `2024` shows the ISO error and emits nothing.
    - The removed `-0` → `0n` assertion matches the approved rule and does not weaken any test.
- CR-2 (integer-default setting not applied to unedited plain integers in the badge, the dropdown and `convertValue`): still present in the code, but the parent accepted it as a task assumption (2026-11-16 23:32). Fixes.md explains why a partial fix would make the dropdown inconsistent (the `currentTarget` guard). No save path exists yet. It is not raised again as an open finding. The follow-up belongs to the task that adds document saving.

Criteria check:
- Component tests show that editing an Int64 keeps it Int64, that overflow shows an error, and that an invalid ObjectId is rejected: met (bson-inputs.spec.ts, bson-input.component.spec.ts).
- Type dropdown conversions follow the bson-model table, and impossible conversions are disabled: met. `typeOptions` uses core `convert`, with tests. The exception for empty values is a recorded assumption.
- New numeric values follow the setting (Int32/Double), and fields can be moved: met for typed and new numbers (`NumberDefaultService`, with tests) and for `moveEntry` and the form move buttons (with tests). The scope limit for unedited plain integers is recorded as an assumption.
- Architecture: the changes stay in `packages/renderer/src/app/explorer`, as the task's `touches` field says. Conversions reuse core `convert` and `parseIsoDate` instead of duplicating them. No secrets, unsafe HTML or new dependencies were added.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

None.

## Review conclusion

No material issues found. Round-2 CR-1 is fixed correctly, with regression tests, and introduces no new problems. Round-2 CR-2 stays deferred under the recorded task assumption.

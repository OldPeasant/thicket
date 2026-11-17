# Test Report

Date: 2026-11-17

Task: docs-get-numeric-slice - docs.get sliceAbove skips arrays with all-digit field names (like docs.find)

Scope: base 85db64d4f7fe71120e4e5899cba0eee60a489944 .. d5e08404f04c3f542976e1e5ec316ce4e8a8eff8 (single task commit d5e0840 on main), plus the uncommitted test additions in `packages/backend/src/docs/query/query.spec.ts` made by this test-writer run.

Requirements:
- `tasks/docs-get-numeric-slice.md` acceptance criterion 1
- `docs/ARCHITECTURE.md` "Coverage"
- Consistency rule with `sliceLargeArrays` (`query.ts:343`, same `/^\d+$/` test)

## Test files changed

- `packages/backend/src/docs/query/query.spec.ts`

## Tests added or updated

Count: 3 added (the implementer's test "all-digit field names are not sliced (docs.getSlice cannot page them), others still are" was reviewed and kept unchanged)

- `getDocument > names with digits that are not all digits are still sliced` (`2024a`, `a1`, `-1` are sliced: the rule is all-digit, not "contains a digit")
- `getDocument > inclusion projection: an included all-digit array stays whole and included` (projection `{"2024":1,"items":1}`: `2024` stays `1`, not turned into a `$slice` expression; `items` still sliced)
- `getDocument > exclusion projection: an unmentioned all-digit array is not sliced` (projection `{"secret":0}`: no `$slice` added for `2024`)

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| docs.get with sliceAbove leaves arrays with all-digit top-level names whole (same /^\d+$/ rule as sliceLargeArrays) | `all-digit field names are not sliced (docs.getSlice cannot page them), others still are`; `names with digits that are not all digits are still sliced`; `inclusion projection: an included all-digit array stays whole and included`; `exclusion projection: an unmentioned all-digit array is not sliced` | `cd packages/backend && npx vitest run src/docs/query/query.spec.ts` | Pass (114/114) |
| Unit test in query.spec.ts | same as above | same | Pass |

Regression: the implementer's test fails without the fix (without the `/^\d+$/` check `2024` and `0` would get `{ $slice: 10 }` and appear in `sliced`).

## Focused test execution

Command:

`cd packages/backend && npx vitest run src/docs/query/query.spec.ts`

Result:

Pass - 1 file, 114 tests passed.

## Full test execution

Command:

`npm run check` (repository root: eslint + prettier --check, tsc for all workspaces, vitest run, renderer ng test)

Result:

Pass - lint and formatting clean, typecheck clean, vitest 76 files / 4120 tests passed, renderer 94 files / 3015 tests passed.

## .taskcheck

Result:

Pass - `.taskcheck` runs `npm run check`; that command passed (above). `.taskcheck` itself was not invoked separately.

## Bugs found

None.

## Coverage

Status: verified

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: the only changed executable line is `query.ts:526`; lcov shows it hit and its file has 226/226 lines covered. Both outcomes of the added `/^\d+$/` condition are exercised (true: `2024`, `0`; false: `items`, `2024a`, `a1`, `-1`), but v8 does not report per-operand branch counters for `||` conditions, so changed-branch coverage is inferred from test design, not measured.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: docs-get-numeric-slice; base 85db64d4f7fe71120e4e5899cba0eee60a489944; HEAD d5e08404f04c3f542976e1e5ec316ce4e8a8eff8; task-owned commit d5e0840 (supplied by parent, confirmed with `git show d5e0840`).
- Source/test snapshot identifier (including uncommitted inputs): `query.ts` sha256 6aac54d9d62864655c208d4b13030bd273621a89c93138e797aa0ffc21820a5e (unchanged from HEAD); `query.spec.ts` (with uncommitted additions) sha256 15f189f7226d6fbe3de9c3100a16c2b348cf4942f40994da7a422efa9772c025. Hashes identical before and after the coverage run.
- Exact included files; renamed/deleted/excluded files and reasons: included `packages/backend/src/docs/query/query.ts`. Excluded `query.spec.ts` (test file). No renames or deletions.
- Provider/version, command, working directory, and test selection: Vitest v5.1.0 with v8 (`@vitest/coverage-v8`); `npx vitest run src/docs/query/query.spec.ts --coverage --coverage.include=src/docs/query/query.ts --coverage.clean=true`; cwd `packages/backend`; selection: `src/docs/query/query.spec.ts`.
- Run start/completion time and exit status: started 2026-11-17 05:12:05 local, duration 948 ms; exit 0, 114 tests passed.
- Generated report paths and report hashes/run identifier: `packages/backend/coverage/lcov.info` sha256 b22596a81482f23b4b340cb1f0cd635484a07a3c78af74076cafb1062f8cf58c; `packages/backend/coverage/coverage-summary.json` sha256 d27bf2d9dac47ebaa7c731d396e1de73900f3d7fe7909972f2fe0446d9ee9cbb (git-ignored).
- Evidence outputs are fresh and inputs stayed unchanged: yes (`--coverage.clean=true`, inputs hashed before and after).
- Final run after latest test additions and production fixes: yes (no production fixes; run includes all 3 added tests).

Values below use covered/total (percentage).

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/backend/src/docs/query/query.ts` | 270/270 (100%) | 219/220 (99.54%) | 47/47 (100%) | 226/226 (100%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/backend/src/docs/query/query.ts:56` (`String(error)` arm in `parseEjson` when a non-Error is thrown) | Pre-existing defensive code, not touched by this task; EJSON.parse throws Error instances | Left uncovered: outside task scope, not meaningfully reachable |

## Unable to test

Nothing. The criterion is a unit-level behavior; integration against a real MongoDB was not required by the task and was not run.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found.

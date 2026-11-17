# Test Report

Date: 2026-11-17

Task: index-ui-type-clears-errors - Indexes form: changing a key type clears collation/wildcard projection errors (CR-6 of index-ui)

Scope: base 3d59b41cc9b3ec1fbc394621b3c991730a0e4128 (task claim commit) .. b69601ff2ed2b85caf23bd0b74d365abaa0ddf7a (task implementation commit, HEAD of main at measurement), plus the uncommitted test additions of this report in `packages/renderer/src/app/indexes/index-create-form.spec.ts`. Task-owned commit: b69601f (`git show b69601f --stat`: `index-create-form.ts` +9/-1, `index-create-form.spec.ts` +20). No other uncommitted changes in the working tree.

Requirements:
- `tasks/index-ui-type-clears-errors.md` (goal and the single acceptance criterion)
- `docs/ARCHITECTURE.md` "Coverage" (task-scoped coverage command)
- `docs/QUALITY.md` (report contract)
- Existing conventions of `packages/renderer/src/app/indexes/index-create-form.spec.ts`

## Test files changed

- `packages/renderer/src/app/indexes/index-create-form.spec.ts`

## Tests added or updated

Count: 3 added (the task commit's own test, "clears the collation and wildcard projection errors when a key type changes", was kept unchanged)

- `clears the collation error of a text key when the key type changes to ascending` - the criterion literally: a plain (non-wildcard) text key `title` with a collation; after Create the error "A text index does not support a collation." shows and the collation input is `aria-invalid`; selecting ascending removes the message and `aria-invalid`; the next Create sends `{ title: 1 }` with `{ collation: { locale: "fr" } }`. Fails without the fix (the pre-fix `setType` did not clear `collation`).
- `clears the collation error of a 2d key when the type of the second field changes` - the 2d variant: key `{ pos: "2d", cat: 1 }` + collation gives "A 2d index does not support a collation."; changing the type of the second (non-2d) field also clears it (any type change clears; the next Create re-checks and shows it again); changing `pos` to `2dsphere` clears it and the Create sends `{ pos: "2dsphere", cat: -1 }` with the collation.
- `keeps unrelated option errors when a key type changes` - guards the targeted clearing: with a reserved name `*` and a text-key collation error, a type change removes only the collation error; "The name * is reserved." stays and nothing is sent.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| Component test: a collation error after Create with a text key disappears when the key type changes to ascending | `clears the collation error of a text key when the key type changes to ascending`; `clears the collation and wildcard projection errors when a key type changes` (task commit, wildcard text key) | `cd packages/renderer && npx ng test --include='src/app/indexes/index-create-form.spec.ts'` | Pass (29/29) |
| Goal: `setType` also clears the `wildcardProjection` error | `clears the collation and wildcard projection errors when a key type changes` (task commit) | same | Pass |
| Goal: switching a 2d field clears the stale collation error | `clears the collation error of a 2d key when the type of the second field changes` | same | Pass |
| Regression guard: a type change does not clear unrelated errors | `keeps unrelated option errors when a key type changes` | same | Pass |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/app/indexes/index-create-form.spec.ts'`

Result:

Pass - 1 test file, 29 tests passed (26 existing + 3 new).

## Full test execution

Command:

`npm run check` (repository root: lint, type check, root Vitest projects, then `ng test` in `packages/renderer`)

Result:

Pass - root Vitest 76 files / 4132 tests passed; renderer 94 files / 3019 tests passed; lint and type check passed (the test steps only run after them).

## .taskcheck

Result:

Pass - `.taskcheck` runs `npm run check` when `package.json` exists; that exact command was run above (via `npm --prefix <repo root> run check`) and passed.

## Bugs found

None. No production defect was found.

## Coverage

Status: verified

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: 1/1 executable changed lines covered (100%). Method: the task diff changes lines 122-130 of `index-create-form.ts` (one `this.clearError(...)` call spread over 9 lines); the provider's lcov maps that statement to line 122 (`DA:122,19`), the only executable line in the hunk. Changed-branch coverage: N/A (the change adds no branch).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `index-ui-type-clears-errors`; base 3d59b41cc9b3ec1fbc394621b3c991730a0e4128; measured HEAD b69601ff2ed2b85caf23bd0b74d365abaa0ddf7a; task-owned commit b69601f as supplied by the parent and confirmed with `git show b69601f --stat`.
- Source/test snapshot identifier (including uncommitted inputs): sha256 `index-create-form.ts` a358de02ef57c0de2b0e5a562a52154114a9a057940070b0d27c5f7405f48a46; `index-create-form.html` 8185684b09422eff468035100f163491dd32df1400f38bf33393a208d4629585; `index-create-form.spec.ts` (with the 3 new tests, uncommitted at measurement) 6d2860e19e209887686ee4de7d32fac605188a1013edd3e8aa185bc4a1585ebc.
- Exact included files; renamed/deleted/excluded files and reasons: included `packages/renderer/src/app/indexes/index-create-form.ts`. Excluded `index-create-form.spec.ts` (test file). No renamed or deleted files.
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8` (Vitest 5.1.0, Node 24.21.0) via Angular builder; `npx ng test --include='src/app/indexes/index-create-form.spec.ts' --coverage --coverage-include='src/app/indexes/index-create-form.ts'`; working directory `packages/renderer`; test selection: `index-create-form.spec.ts` only.
- Run start/completion time and exit status: started 2026-11-17T05:18:35+01:00, tests started 05:18:41, reports written 05:18:43; 29/29 tests passed, summary printed without error.
- Generated report paths and report hashes/run identifier: `packages/renderer/coverage/renderer/lcov.info` sha256 9eda78bd12e9552d6c156b135d2da46b1d129824ba8fcec22a71a0ae14d6d17b; `packages/renderer/coverage/renderer/coverage-summary.json` sha256 ef47c87f057bd994576e1b1f664438cfba5260c0426f45e4042086393e8bd330 (git-ignored).
- Evidence outputs are fresh and inputs stayed unchanged: report files timestamped 05:18:43, after the run start; the lcov `SF` is the scoped file with hit counts matching the 29-test run; no source or test edits were made between the snapshot and the run.
- Final run after latest test additions and production fixes: yes (no production fixes were made; the run includes all 3 added tests).

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/indexes/index-create-form.ts` | 93/93 (100%) | 42/43 (97.67%) | 34/34 (100%) | 71/71 (100%) |

Aggregate equals the single file above; no scoped file is missing or unmeasured.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/renderer/src/app/indexes/index-create-form.ts:157` (false branch of `if (key !== 'hidden')` in `setFlag`) | Toggling the `hidden` flag clears no error; pre-existing code from index-ui, not changed by this task | Left uncovered: outside the task's change and acceptance criterion |

## Unable to test

Nothing. The criterion is a component test and was run.

## Summary

Tests added and all validation passed. Tests and task-scoped coverage are sufficient; no production defects found.

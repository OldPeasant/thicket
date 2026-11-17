# Test Report

Date: 2026-11-17

Task: conflict-reinsert-rule - Conflict view: one re-insert rule shared with DocumentActions

Scope: `git diff 2e1f1933 c3c1326b` (base 2e1f1933, task commit c3c1326b, branch main, HEAD c3c1326b at measurement). Production files: `packages/renderer/src/app/document/document-actions.service.ts`, `packages/renderer/src/app/document/conflict/conflict-view.ts`. Test file in the task commit: `packages/renderer/src/app/document/conflict/conflict-view.spec.ts`. Uncommitted at measurement: only the test additions in this report (`document-actions.service.spec.ts`).

Requirements:
- `tasks/conflict-reinsert-rule.md` acceptance criteria
- SPEC.md "Conflict detection" (referenced by the task notes)
- docs/ARCHITECTURE.md "Coverage"
- Parent instructions (scope, test commands, suggested reinsertBlocker cases)

## Test files changed

- `packages/renderer/src/app/document/document-actions.service.spec.ts`

## Tests added or updated

Count: 11 (9 in a new `describe('reinsertBlocker')` under "conflict resolution", counting the 3 `it.each` cases; 2 in "a large document with cut arrays in the conflict paths")

Added tests:
- `reinsertBlocker is null without a conflict, even with a projection active`
- `reinsertBlocker is null when the server version changed (not deleted), even under a projection`
- `reinsertBlocker is null when the server version is unknown`
- `reinsertBlocker is null for a whole document deleted on the server, and overwrite inserts it`
- `reinsertBlocker is "projection" for a deleted document while <inclusion top-level | exclusion top-level | dotted> projection is active (unlike resolveBlocker)` (3 cases; also checks overwrite refuses with the projection message and sends nothing)
- `reinsertBlocker is "partial" for a deleted document edited under a projection that was cleared since` (also checks the refusal message switches to the partial wording)
- `reinsertBlocker is null again once the conflict of the deleted document is resolved`
- `reinsertBlocker: a cut document deleted on the server is "partial", even under a projection` (cut wins over projection; conflict remembers cut after the page changes)
- `reinsertBlocker is null for a cut document whose server version changed (not deleted)`

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: view and DocumentActions use one rule for re-insert of a deleted document; rule lives in the service only | Service: the 11 tests above (rule values plus `overwrite` refusal agreeing with `reinsertBlocker`); view: conflict-view.spec.ts tests asserting `actions.reinsertBlocker(KEY)` equals what the view shows (`'projection'`, `'partial'`, `null`) and that overwrite refuses the same cases. Code inspection: conflict-view.ts computes `blocked` for deleted documents only via `this.actions.reinsertBlocker(conflict.key)`; `resolveWith` uses the same method | `cd packages/renderer && npx ng test --include src/app/document/document-actions.service.spec.ts --include src/app/document/conflict/conflict-view.spec.ts` | Pass (2 files, 162 tests) |
| AC2: deleted document loaded with a projection (active or since cleared) does not offer "Insert your version again" and shows a note (component test) | conflict-view.spec.ts (task commit): `a deleted document loaded with a projection ...` (active, existing test extended), `a deleted document loaded with a projection that was cleared since offers no insert-again`, control `a deleted whole document without a projection still offers insert-again` | same command | Pass |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include src/app/document/document-actions.service.spec.ts --include src/app/document/conflict/conflict-view.spec.ts`

Result:

Pass (2 test files, 162 tests)

## Full test execution

Command:

`cd packages/renderer && npx ng test --coverage --coverage-include='src/app/document/document-actions.service.ts' --coverage-include='src/app/document/conflict/conflict-view.ts' --coverage-reporters=json-summary --coverage-reporters=lcov --coverage-reporters=text` (full renderer suite)

Result:

Pass (102 files, 3368 tests)

## .taskcheck

Result:

Pass. `.taskcheck` runs `npm run check` (`npm run lint && npm run typecheck && npm run test`); run as `npm --prefix /home/eric/work/mongo-db-client-agents/agent-2 run check`. Lint and typecheck passed, core/other workspaces 84 files / 4417 tests passed, renderer 102 files / 3368 tests passed.

## Bugs found

None. The new rule matches the previous `resolveWith` condition (`partial || cut`, where `isPartial` already includes "projection active"), so the refusal behavior of `overwrite` is unchanged, and the view now follows it.

## Coverage

Status: verified

Metric: whole-file coverage of task-changed production files (includes code that existed before the task, hit by the whole renderer suite).
Changed-line coverage: measured from the same lcov.info by intersecting `DA`/`BRDA` records with the added/modified lines of `git diff -U0 2e1f1933 c3c1326b`:
- document-actions.service.ts: changed executable lines 254, 255, 256, 257, 259, 290, 291, 292 -> 8/8 lines hit; branches on changed lines (255, 256, 259, 291, 294) -> 16/16 hit.
- conflict-view.ts: the changed template block maps to lines 99, 100, 103 -> 3/3 hit (6 hits each); branch at 525 (`conflict.current === null ? reinsertBlocker : ...`) -> 2/2 hit. Lines 525-526 have no own `DA` record (part of the object literal statement). Template line mapping is via the Angular source map and is approximate.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: conflict-reinsert-rule; base 2e1f1933; HEAD c3c1326b; task-owned commit c3c1326b supplied by the parent, file scope from `git diff --stat 2e1f1933 c3c1326b` (matches the task's `touches`).
- Source/test snapshot identifier (sha256, unchanged before and after the run): document-actions.service.ts 822adc6eee26352a472ef0c6066751f23fcf3e9eb17287dd6bb7d8951937d821; conflict-view.ts 1e7afdd152d0019d1bdedb393cbc50ce740378db72d8773f74d2198f3710fb2e; document-actions.service.spec.ts (uncommitted) 6bcb76c9f269eccb6193af8bfc9bc27bfcdc91cb87718227e36b58d4b6341675; conflict-view.spec.ts c3a4cce5687cd9e99f9dd10ea55029ffa439d78bb2a73391f165bda122927351.
- Exact included files: `packages/renderer/src/app/document/document-actions.service.ts`, `packages/renderer/src/app/document/conflict/conflict-view.ts`. Excluded: `conflict-view.spec.ts` (test file). No renamed or deleted files.
- Provider/version, command, working directory, and test selection: Vitest v5.1.0 with v8 coverage via `ng test`; command in "Full test execution"; working directory `packages/renderer`; full renderer suite.
- Run start/completion time and exit status: started 2026-11-17 06:24:07 +0100, reports written 06:24:26 +0100; exit 0 (102 files, 3368 tests passed).
- Generated report paths and report hashes/run identifier: `packages/renderer/coverage/renderer/coverage-summary.json` (sha256 4f408f788f58205b6f841af8959d2108dd989897c5b65f6340dc50c61a8334e9), `packages/renderer/coverage/renderer/lcov.info` (sha256 9f275a03981481079535c78cf5d72eca9815f8b7cb03ff3d94072af6fbc27985), `packages/renderer/coverage/renderer/lcov-report/`.
- Evidence outputs are fresh and inputs stayed unchanged: yes; report files timestamped by this run; source/test hashes identical before and after.
- Final run after latest test additions and production fixes: yes (no production fixes were made).

Values below use covered/total (percentage).

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/document/document-actions.service.ts` | 276/279 (98.92%) | 180/185 (97.29%) | 66/66 (100%) | 232/232 (100%) |
| `packages/renderer/src/app/document/conflict/conflict-view.ts` | 220/223 (98.65%) | 139/143 (97.2%) | 36/36 (100%) | 166/167 (99.4%) |
| Aggregate (both files, summed counters; no files excluded or unmeasured) | 496/502 (98.8%) | 319/328 (97.25%) | 102/102 (100%) | 398/399 (99.74%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `document-actions.service.ts` branches at 188, 326, 353, 631, 655 | Pre-existing code outside the task diff (e.g. 326 `hidesSubFields` fallback in `resolveWith` non-delete path, 353 `idOf(original) === null` guard in `send`) | Not in task scope; no test added |
| `conflict-view.ts` line 575; branches at 457, 462, 484, 542 | Pre-existing code outside the task diff | Not in task scope; no test added |

## Unable to test

Nothing in scope. The "rule lives in the service only" part of AC1 is structural; it is covered by code inspection plus the tests showing view and service agree on every case, not by a test that could fail on a duplicated rule.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found.

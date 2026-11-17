# Test Report

Date: 2026-11-17

Task: m1-e2e (M1: End-to-end demo steps 2–7) - second pass on the final code after fixes

Scope: base 301f9c700ec141e212525fafb0cb865e38a671ef .. HEAD
aa212b676132096eb77c88869ab2b8503ed4962f (commits 62600e2, e07d2f1, 229b77f, aa212b6, as supplied
by the parent; `git log --oneline 301f9c70..aa212b67`). Working tree clean at the start of this
pass (`git status --porcelain` empty). Code files changed in the range:
`test/e2e/m1/demo.e2e.ts` (new), `test/e2e/harness/mongo.ts`, `test/e2e/harness/index.ts`,
`test/integration/fixtures/mongo.ts`. Other files in the range: `reviews/m1-e2e/*` (reports and
9 screenshots) and `tasks/ui-polish-m1.md`. No production file changed:
`git diff --name-only 301f9c70..aa212b67 -- packages apps` is empty. Since the first test pass
(49d9eab) only `test/e2e/m1/demo.e2e.ts` changed in `test/` (fixer: CR-1, CR-2, TW-1).

Requirements:
- `tasks/m1-e2e.md` acceptance criteria and recorded assumptions
- `SPEC.md` section 2, demo steps 2–7
- `docs/ARCHITECTURE.md` "Coverage", `docs/QUALITY.md`
- `reviews/m1-e2e/review.md` and `reviews/m1-e2e/fixes.md` (findings to re-check)

## Test files changed

- None in this pass. The final `test/e2e/m1/demo.e2e.ts` (fixer revision) was reviewed and run
  unchanged; no real gap remained that needed a test edit.

## Tests added or updated

Count: 0 in this pass (the suite is one Playwright test, `M1 demo, steps 2–7, against a TLS
replica set`; it was strengthened in the first pass and by the fixer).

Re-check of the fixer's changes against the earlier findings:

- CR-1 (sort not proven): `DEMO_ID` is now created in `seed()` after the 39,999 other orders are
  inserted, and `seed()` asserts with the driver that it is the largest `_id`. Within one process
  `new ObjectId()` is monotonic (timestamp plus incrementing counter), so this holds
  deterministically. Step 4 asserts the demo id is absent from the unfiltered page 1 (Raw view) and
  is the first ObjectId after filter + sort `{total: -1}`; every total on the page is above 100
  and the totals are in descending order. Resolved.
- TW-1 (`total: {$gt: 100}` not discriminating): step 4 compares "Count exactly" with the driver's
  `countDocuments({status: 'open', total: {$gt: Decimal128('100')}})` and first asserts that this
  count is below the number of open orders, so a filter ignoring `$gt` would fail. Observed in the
  committed screenshot: "1–50 of 7,500 documents", 10,000 open orders. Resolved.
- CR-2 (screenshots): `step-4-table.png` is taken on page 3 ("101–150"), `step-2-production.png`
  shows the checked Production box. The 9 committed PNGs in `reviews/m1-e2e/` have 9 distinct
  sha256 hashes; `step-4-filter-sort.png` was viewed (Business light, filter and sort applied,
  "1–50 of 7,500 documents", demo document first with `NumberDecimal("9999.95")`). Resolved.
- Checklist comment: every step line (2–7) is backed by assertions in the corresponding
  `test.step`; the step-4 text matches the new checks.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: `npm run test:e2e -- m1` passes | `M1 demo, steps 2–7, against a TLS replica set` | `npm run test:e2e -- m1` (builds renderer + desktop, headless, Podman, MongoDB 8 TLS replica set rs0) | Pass (1 passed, 11.4s) |
| AC1: screenshots of each step in Business light committed under reviews/m1-e2e/ | same test (`shot()` after asserting `data-style=business`, `data-theme=light`) | `npm run test:e2e -- m1` (writes `test-results/m1`); `sha256sum reviews/m1-e2e/*.png` (9 files listed explicitly) | Pass (run writes the 9 shots; 9 committed PNGs, distinct hashes, one viewed). The committed copies come from the parent's run, not this one |
| AC2: checklist in the test file maps each step to the SPEC demo script | header comment of `test/e2e/m1/demo.e2e.ts` | manual review against SPEC.md section 2 and the step assertions | Pass |
| Harness: `startMongo` still works after the `startMongoSpec` refactor | `harness.e2e.ts` (1), `sidebar.e2e.ts` (2) | `npx playwright test test/e2e/harness.e2e.ts test/e2e/sidebar.e2e.ts` | Pass (3 passed) |
| Harness: non-TLS `initiateReplicaSet` and fixture setup unchanged | `fixtures.int.spec.ts`, `global-setup.int.spec.ts`, `certs.int.spec.ts` | `npx vitest run --config test/integration/vitest.config.ts test/integration/fixtures.int.spec.ts test/integration/global-setup.int.spec.ts test/integration/certs.int.spec.ts` | Pass (3 files, 20 tests) |
| Lint and formatting of the suite | `test/e2e/m1` | `npx eslint test/e2e/m1 --max-warnings 0`; `npx prettier --check test/e2e/m1` | Pass (no warnings; "All matched files use Prettier code style!") |

## Focused test execution

Command:

`npm run test:e2e -- m1`

Result:

Pass (1 passed, 11.4s; renderer build emitted only the pre-existing bundle-budget warnings)

## Full test execution

Command:

`npm run check` (lint, type check, root Vitest, renderer tests), plus the harness e2e and
integration fixture subsets above. The full `npm run test:int` and full `npm run test:e2e` were not
run: the task changed only test code, and the affected harness paths are covered by the subsets.

Result:

Pass (root: 64 files, 3530 tests; renderer: 80 files, 2418 tests)

## .taskcheck

Result:

Pass (`.taskcheck` runs `npm run check`; the run above passed on the same clean tree)

## Bugs found

None. No production defects were exposed. The side observations in the task notes (unrounded
"Connected in … ms", status bar "No connection" with a connected production tab, visible in the
step-4 screenshot) are not asserted by this suite; they are tracked by the follow-up task
`tasks/ui-polish-m1.md`.

## Coverage

Status: not applicable - no production code changed in the task scope; only test and test-harness
code (`test/`) changed, which no coverage workspace instruments.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured (no production lines changed).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: m1-e2e, base
  301f9c700ec141e212525fafb0cb865e38a671ef, HEAD aa212b676132096eb77c88869ab2b8503ed4962f, commits
  62600e2, e07d2f1, 229b77f, aa212b6 as supplied by the parent;
  `git diff --name-only 301f9c70..aa212b67 -- packages apps` is empty.
- Source/test snapshot identifier (including uncommitted inputs): HEAD aa212b6, clean tree (no
  uncommitted inputs). sha256 `test/e2e/m1/demo.e2e.ts`
  85705138138315ca674cdfe233c53250c280a2eeb329317a032ea3b7c1e91d41, `test/e2e/harness/mongo.ts`
  ba72a4acf3940bcec3522559de042830c3683c34d48fd2cb704b9317aac09ca6, `test/e2e/harness/index.ts`
  5f8ef728657bb5256f7a2d3b376d097092b7e952f1062fb90fe16501513f1b64,
  `test/integration/fixtures/mongo.ts`
  7e6a43444b130186eab34a687c9869b9cd4a58c4d2364de72a6b3664d21f2904.
- Exact included files; renamed/deleted/excluded files and reasons: included production files:
  none. Excluded: the four files above - test and test-harness code outside every coverage
  workspace (`docs/ARCHITECTURE.md` "Coverage" measures workspace sources; `test/e2e` runs under
  Playwright, which has no coverage configured). No renames or deletions.
- Provider/version, command, working directory, and test selection: no coverage run; the configured
  provider (`@vitest/coverage-v8`) has nothing in scope to instrument.
- Run start/completion time and exit status: not applicable (no coverage run).
- Generated report paths and report hashes/run identifier: none.
- Evidence outputs are fresh and inputs stayed unchanged: all runs in this report were made on the
  snapshot above on 2026-11-17 (about 03:52–03:55 +01:00); no file was edited in this pass.
- Final run after latest test additions and production fixes: yes (the fixer's test changes are
  in aa212b6; no production fixes exist).

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| (no production files changed) | N/A | N/A | N/A | N/A |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| (none) | The first pass's gap (step-4 `total: {$gt: 100}`) | Closed by the fixer (TW-1): exact count compared with the driver's count, which is below the open-order count |

## Unable to test

- Atlas `mongodb+srv://` (SPEC step 2 as written): replaced by a TLS single-member replica set per
  the task's recorded assumption; SRV needs DNS and Atlas. Follow-up is a human/Atlas task.
- A real OS keychain: this machine runs headless; the test checks that `secrets.bin` is written and
  does not contain the password in plain text, not which keyring backend encrypted it.
- Running under `xvfb-run`: not available here; the harness's headless path was used.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. The fixer's changes
close CR-1, CR-2 and TW-1; the M1 suite, harness subsets, lint, formatting and `npm run check` pass
on aa212b6. No production files in scope, so task-scoped coverage is N/A.

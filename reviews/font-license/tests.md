# Test Report

Date: 2026-11-16

Task: font-license - Ship the SIL OFL 1.1 text with the Orbitron/Share Tech Mono fonts and update docs/ARCHITECTURE.md font note

Scope: round 2 on the final code. `git diff 1dfcf47d005346393de36220875ea064bbccab2b..c429a7c66c9e52fdb584d3eed3875443dc7ab12b` (branch main, HEAD = c429a7c), supplied by the parent. Task commits: 2eb0e2a (implementation), a34120f (round-1 tests and reports), c429a7c (TW-1 fix). Production files in the diff: `NOTICE`, `docs/ARCHITECTURE.md`, `packages/renderer/angular.json`, `packages/renderer/src/assets/fonts/OFL.txt` (new). Test files: `packages/renderer/src/font-license.spec.ts` (new), `packages/renderer/src/notice.spec.ts`. Plus one uncommitted test change from this round (below).

Requirements:
- tasks/font-license.md acceptance criteria
- SIL OFL 1.1 condition 2 (each copy must contain the copyright notice and the licence)
- docs/ARCHITECTURE.md (test conventions, coverage section)
- parent agent instructions; reviews/font-license/fixes.md (TW-1 fix)

## Test files changed

- `packages/renderer/src/font-license.spec.ts` (round 2: uncommitted change, see below)
- Round 1 (committed in a34120f): `packages/renderer/src/font-license.spec.ts`, `packages/renderer/src/notice.spec.ts`

## Tests added or updated

Count: 1 updated in round 2 (3 added in round 1)

Round 2:
- `Tron font licence (SIL OFL 1.1) > names the copyright holder of each bundled font`: it now compares whole lines (`ofl.split(/\r?\n/)` contains the exact line) instead of `toContain` on a substring. As the fixer noted, the substring check would also accept the notice with a trailing period (the TW-1 defect). The `quotes the copyright notice embedded in each font file verbatim` test already caught that, because it anchors the line between `\n` characters. This change also makes the hard-coded expectation exact, so it no longer depends on only the woff2 name-table parser to catch the defect. The expected strings did not change.

Round 1 (unchanged, still present): `has a copyright entry for every font file in the folder`, `quotes the copyright notice embedded in each font file verbatim`, `root NOTICE: JSON Canopy attribution > points to the shipped SIL OFL text for the fonts`.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1a: full SIL OFL 1.1 text next to the fonts | `contains the full licence text`; round-1 manual read of OFL.txt against the OFL 1.1 text (that part of the file did not change in c429a7c) | `cd packages/renderer && npx ng test --include='src/font-license.spec.ts' --include='src/notice.spec.ts'` | Pass |
| AC1b: Orbitron and Share Tech Mono copyright lines | `names the copyright holder of each bundled font` (line-exact), `has a copyright entry for every font file in the folder` | same | Pass |
| AC1b: copyright lines match the fonts' own notices (TW-1) | `quotes the copyright notice embedded in each font file verbatim` | same | Pass (TW-1 fixed: both lines match the fonts' name ID 0 records) |
| AC1c: included in the renderer build output | `is copied into the build output next to the bundled fonts` (config); build run | `npm run build -w packages/renderer` then `cmp packages/renderer/dist/media/OFL.txt packages/renderer/src/assets/fonts/OFL.txt` | Pass: build finished 2026-11-16T19:41:52Z; `dist/media/` holds `OFL.txt`, `orbitron-D5C4P7FB.woff2`, `share-tech-mono-XX4T45LZ.woff2`; `cmp` says identical |
| NOTICE points to the licence text | `points to the shipped SIL OFL text for the fonts`, `refers only to repository paths that exist` | focused command above | Pass |
| AC2: docs/ARCHITECTURE.md describes the font location | Not testable as a unit test (docs are not linted or tested). Round-1 manual review of the diff: it names `packages/renderer/src/assets/fonts/` and bundling into `dist/media/` with OFL.txt. `docs/ARCHITECTURE.md` did not change in c429a7c, and the build output above still matches the description | manual review | Not testable (manually confirmed) |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/font-license.spec.ts' --include='src/notice.spec.ts'`

Result:

Pass: 2 files, 12 tests passed (2026-11-16 20:41:37 +0100, with the round-2 test change applied).

## Full test execution

Command:

`npm run check` (repo root: `npm run lint && npm run typecheck && npm run test`)

Result:

Pass. Lint and typecheck passed (the steps run in an `&&` chain, so the tests only start after both pass). Root Vitest: 34 files, 2166 tests passed. Renderer `ng test`: 28 files, 443 tests passed. Run at 2026-11-16 20:42 +0100 with the round-2 test change applied.

## .taskcheck

Result:

Pass. `.taskcheck` runs `npm run check`, which passed above. It was not run separately.

## Bugs found

None open.

TW-1 (round 1, Share Tech Mono copyright line had a trailing period not in the font): fixed in c429a7c. Verified by `quotes the copyright notice embedded in each font file verbatim` and the now line-exact `names the copyright holder of each bundled font`, both passing.

## Coverage

Status: not applicable. The task changed no executable TS/JS production code. The changed production files are a text asset (`OFL.txt`), a build configuration file (`angular.json`), `NOTICE` and Markdown documentation. V8 coverage cannot instrument any of them.

Metric: whole-file coverage of task-changed production files: N/A (no instrumentable files in scope).
Changed-line coverage: not measured (N/A, same reason).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: font-license; base 1dfcf47d005346393de36220875ea064bbccab2b; HEAD c429a7c66c9e52fdb584d3eed3875443dc7ab12b; task commits 2eb0e2a, a34120f, c429a7c, supplied by the parent and confirmed with `git diff --stat 1dfcf47..c429a7c`.
- Source/test snapshot identifier (including uncommitted inputs): HEAD c429a7c plus the uncommitted `font-license.spec.ts`, sha256 7ac63bf8f4e4fda2124b3c6bdfcf72e73588be9763bcb5139bbba0d52e7847b6. Committed inputs: `OFL.txt` 602940f64c08a0a493e5089b5e5c6818d4d129a58a5acb20f24f1de162430a29, `angular.json` d72c7baca9bd7ed91cd283ad3387899e2adca4b99cceddfcb1d0d4f27ddda1fe, `notice.spec.ts` 8b68abeda01a55747454034de9f51d54356ca79f8ac1cf8281d96fe7947d4797.
- Exact included files; renamed/deleted/excluded files and reasons: none included. Excluded: `packages/renderer/src/assets/fonts/OFL.txt` (text asset), `packages/renderer/angular.json` (build config, no executable behavior to instrument), `NOTICE` and `docs/ARCHITECTURE.md` (documentation), and the spec files (tests). The spec tests and the build run above check the asset's behavior instead.
- Provider/version, command, working directory, and test selection: not run (no instrumentable scope).
- Run start/completion time and exit status: N/A
- Generated report paths and report hashes/run identifier: N/A
- Evidence outputs are fresh and inputs stayed unchanged: N/A for coverage. The test and build runs above used the snapshot listed here.
- Final run after latest test additions and production fixes: N/A for coverage. The tests, build and `npm run check` ran after the TW-1 fix (c429a7c) and the round-2 test change.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| (no executable production files in scope) | N/A | N/A | N/A | N/A |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| N/A | N/A | No instrumentable production code; the spec assertions and the build run check the behavior |

## Unable to test

- A build-output assertion inside the unit suite (`dist/media/OFL.txt` exists) was not added. It would need a full `ng build` inside the < 2 min unit check, or depend on a stale `dist/`. Instead, a unit test checks the `angular.json` assets entry, and the build was run by hand for this report (see AC1c). No follow-up needed.
- AC2 (documentation wording): docs are not linted or tested in this project; reviewed by hand only.
- A negative check of the line-exact assertion (temporary copy of OFL.txt with the period added back) was not run: the sandbox denied the command outside the clone. Not needed: an exact array `toContain` on lines cannot match a line with an extra character, and round 1 showed the verbatim test fails on exactly this defect.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. TW-1 is fixed; the focused tests, the renderer build plus `cmp` of `dist/media/OFL.txt`, and `npm run check` all pass on c429a7c plus the uncommitted round-2 test change.

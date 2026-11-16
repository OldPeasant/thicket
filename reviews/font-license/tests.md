# Test Report

Date: 2026-11-16

Task: font-license - Ship the SIL OFL 1.1 text with the Orbitron/Share Tech Mono fonts and update docs/ARCHITECTURE.md font note

Scope: `git diff bec07cbd7a9529b987170bccd01d84fd1f1060e5..a7c0898a0f8140dbee470d2ed7f6e2616577b2a3` (one task commit a7c0898, branch main, HEAD = a7c0898), plus the uncommitted test changes listed below. Changed files in the task commit: `NOTICE`, `docs/ARCHITECTURE.md`, `packages/renderer/angular.json`, `packages/renderer/src/assets/fonts/OFL.txt` (new), `packages/renderer/src/font-license.spec.ts` (new).

Requirements:
- tasks/font-license.md acceptance criteria
- SIL OFL 1.1 condition 2 (each copy must contain the copyright notice and the licence)
- docs/ARCHITECTURE.md (test conventions, coverage section)
- parent agent instructions

## Test files changed

- `packages/renderer/src/font-license.spec.ts` (extended the task's new spec)
- `packages/renderer/src/notice.spec.ts`

## Tests added or updated

Count: 3

- `Tron font licence (SIL OFL 1.1) > has a copyright entry for every font file in the folder`: every font file in `src/assets/fonts` has a `(orbitron.woff2):` style heading followed by a `Copyright` line in OFL.txt, so a new font cannot be added without a notice.
- `Tron font licence (SIL OFL 1.1) > quotes the copyright notice embedded in each font file verbatim`: reads the copyright record (name ID 0) from each woff2's `name` table (WOFF2 table directory + Brotli via `node:zlib`) and expects the whole line under that font's heading in OFL.txt.
- `root NOTICE: JSON Canopy attribution > points to the shipped SIL OFL text for the fonts`: NOTICE refers to `packages/renderer/src/assets/fonts/OFL.txt` and that file exists.

The existing tests in `font-license.spec.ts` (copyright lines, licence headings and conditions, `angular.json` assets entry) were kept unchanged.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1a: full SIL OFL 1.1 text next to the fonts | `contains the full licence text`; manual read of OFL.txt lines 15-100 against the OFL 1.1 text (preamble, definitions, conditions 1-5, termination, disclaimer match) | `cd packages/renderer && npx ng test --include='src/font-license.spec.ts' --include='src/notice.spec.ts'` | Pass |
| AC1b: Orbitron and Share Tech Mono copyright lines | `names the copyright holder of each bundled font`, `has a copyright entry for every font file in the folder` | same | Pass |
| AC1b: copyright lines match the fonts' own notices | `quotes the copyright notice embedded in each font file verbatim` | same | Fail (Orbitron matches; Share Tech Mono differs by a trailing period, see TW-1) |
| AC1c: included in the renderer build output | `is copied into the build output next to the bundled fonts` (config check); build run | `npm run build -w packages/renderer` then `cmp packages/renderer/dist/media/OFL.txt packages/renderer/src/assets/fonts/OFL.txt` | Pass: `dist/media/` holds `OFL.txt`, `orbitron-D5C4P7FB.woff2` and `share-tech-mono-XX4T45LZ.woff2`; `cmp` says the files are identical |
| NOTICE points to the licence text | `points to the shipped SIL OFL text for the fonts`, existing `refers only to repository paths that exist` | focused command above | Pass |
| AC2: docs/ARCHITECTURE.md describes the font location | Not testable as a unit test (docs are excluded from lint/tests). Manual review of the diff: names `packages/renderer/src/assets/fonts/`, relative `url()` in `src/styles.css`, bundling into `dist/media/`, and OFL.txt copied to `dist/media/OFL.txt`, which matches the build output observed above | manual review | Not testable (manually confirmed) |

## Focused test execution

Command:

`cd packages/renderer && npx ng test --include='src/font-license.spec.ts' --include='src/notice.spec.ts'`

Result:

Fail: 11 passed, 1 failed (`quotes the copyright notice embedded in each font file verbatim`, TW-1).

## Full test execution

Command:

`npm run check` (repo root: lint, typecheck, root Vitest, renderer `ng test`)

Result:

Fail. `eslint` + `prettier --check` passed, typecheck passed, root Vitest passed (34 files, 2166 tests). Renderer `ng test`: 27 of 28 files passed, 442 passed and 1 failed (TW-1).

## .taskcheck

Result:

Fail (`.taskcheck` runs `npm run check`; same result as above, failing only on TW-1). Not run separately.

## Bugs found

### Share Tech Mono copyright line in OFL.txt is not verbatim

Finding ID:

`TW-1`

Test:

`Tron font licence (SIL OFL 1.1) > quotes the copyright notice embedded in each font file verbatim` (`packages/renderer/src/font-license.spec.ts`)

Production source:

`packages/renderer/src/assets/fonts/OFL.txt:5`

Requirement:

AC1: the OFL text "with the Orbitron and Share Tech Mono copyright lines". OFL 1.1 condition 2 says each copy must contain "the above copyright notice". The commit says the lines were extracted from the woff2 name tables.

Expected behavior:

OFL.txt quotes the copyright notice from `share-tech-mono.woff2`'s `name` table (name ID 0) exactly:
`Copyright (c) 2012, Carrois Type Design, Ralph du Carrois (post@carrois.com www.carrois.com), with Reserved Font Name 'Share'`

Actual behavior:

OFL.txt line 5 adds a period that is not in the font: `... with Reserved Font Name 'Share'.` The Orbitron line matches its font exactly, including its trailing period.

Severity:

Low (one character; the legal substance does not change, but the line is not the font's notice as it claims to be)

Fix required:

`Yes — production code must be fixed by the parent worker / fixer.` Remove the trailing period from OFL.txt line 5 (and from the matching expectation in the existing `names the copyright holder of each bundled font` test). Then re-run the build so `dist/media/OFL.txt` matches.

## Coverage

Status: not applicable. The task changed no executable TS/JS production code. The changed production files are a text asset (`OFL.txt`), a build configuration file (`angular.json`), `NOTICE` and Markdown documentation. V8 coverage cannot instrument any of them.

Metric: whole-file coverage of task-changed production files: N/A (no instrumentable files in scope).
Changed-line coverage: not measured (N/A, same reason).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: font-license; base bec07cbd7a9529b987170bccd01d84fd1f1060e5; HEAD a7c0898a0f8140dbee470d2ed7f6e2616577b2a3; one task commit, supplied by the parent and confirmed with `git log bec07cb..a7c0898`.
- Source/test snapshot identifier (including uncommitted inputs): HEAD a7c0898 plus uncommitted sha256 `font-license.spec.ts` 77893566ab2b4f3cc1d04d83dd2da629f6cea3447a8b3bb375f0b73677de36d6, `notice.spec.ts` 8b68abeda01a55747454034de9f51d54356ca79f8ac1cf8281d96fe7947d4797; committed inputs `OFL.txt` fc0b18ea8c09951c1dfe46992576cb0f2c6da80ee86669c7ce97195fe659a913, `angular.json` d72c7baca9bd7ed91cd283ad3387899e2adca4b99cceddfcb1d0d4f27ddda1fe.
- Exact included files; renamed/deleted/excluded files and reasons: none included. Excluded: `packages/renderer/src/assets/fonts/OFL.txt` (text asset), `packages/renderer/angular.json` (build config, no executable behavior to instrument), `NOTICE` and `docs/ARCHITECTURE.md` (documentation), `packages/renderer/src/font-license.spec.ts` (test). The asset's behavior is checked by the spec tests and the build run above instead.
- Provider/version, command, working directory, and test selection: not run (no instrumentable scope).
- Run start/completion time and exit status: N/A
- Generated report paths and report hashes/run identifier: N/A
- Evidence outputs are fresh and inputs stayed unchanged: N/A
- Final run after latest test additions and production fixes: N/A. The tests themselves were run on the snapshot above (2026-11-16 ~19:38Z). After the TW-1 fix the tests must be run again.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| (no executable production files in scope) | N/A | N/A | N/A | N/A |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| N/A | N/A | No instrumentable production code; behavior checked by the spec assertions and the build run |

## Unable to test

- A build-output assertion inside the unit suite (`dist/media/OFL.txt` exists) was not added. It would need a full `ng build` (several seconds, writes `dist/`) inside the < 2 min unit check, or depend on a stale `dist/`. Instead, the `angular.json` assets entry is checked by the unit test, and the build was run by hand for this report (see AC1c). No follow-up needed, unless the e2e/packaging suites later want to assert on the packaged app.
- AC2 (documentation wording): docs are not linted or tested in this project; reviewed by hand only.

## Summary

Tests added; production defects were discovered and must be passed to the `fixer` before task completion (TW-1: trailing period in the Share Tech Mono copyright line in OFL.txt; it makes `npm run check` fail).

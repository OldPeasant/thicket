# Test Report

Date: 2026-11-16

Task: renderer-scaffold - M0: Angular renderer workspace

Scope: task base `177498f9af42549fc1b6a13b0d1a3b1c2eb6ff9f`, measured HEAD `fabb8cf34d2bb5c79482919153dac9cb3b1de5c1` (`main`), task commits `9bd783c` (Scaffold the Angular 22 renderer) and `fabb8cf` (Guard the renderer against network resources). Ownership established from the parent's instructions and `git log 177498f..HEAD` (only these two commits; no tasks/ commits in range). Uncommitted: the two spec edits made by this test-writer (listed below). No other uncommitted source changes.

Requirements:
- `tasks/renderer-scaffold.md` acceptance criteria and recorded assumptions
- `docs/ARCHITECTURE.md` "Stack" (Renderer paragraph) and "Coverage"
- Parent instructions (negative checks of the REMOTE regex; failing renderer spec must fail `npm run test`)

## Test files changed

- `packages/renderer/src/no-network.spec.ts`
- `packages/renderer/src/app/app.spec.ts`

## Tests added or updated

Count: 24 test cases added (renderer total 8 -> 32), 1 existing test strengthened.

- `no-network.spec.ts`
  - `REMOTE flags %s` (14 cases): Google Fonts `<link href=https://...>`, preconnect `<link>`, CDN `<script src>`, unquoted attribute, plain `http:`, protocol-relative `src="//..."`, spaces around `=`, upper-case `SRC="HTTPS://..."`, `url(https://...)` unquoted and quoted, `@import "https://..."`, `@import '//cdn...'`, `@import url(//cdn...)`, inline template inside a `.ts` file.
  - `REMOTE leaves %s alone` (8 cases): relative `src`/`href`, `<base href="./">`, bundled font `url('./media/...')`, `data:` URL, local `@import`, a URL inside a code comment, the CSP text. Guards against a regex so broad the per-file check becomes noise.
  - `the CSP names no remote source and keeps fonts local`: the CSP meta content has `font-src 'self'` and contains no `http(s):`, `//` or `*` source.
- `app.spec.ts`
  - `creates the root component and renders the title`: additionally asserts the `main.shell p` text.
  - `runs zoneless: zone.js is not loaded` (new): `globalThis` has no `Zone`.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 `npm run build -w packages/renderer` produces a static build that works from `file://` (relative base href) | Build run plus manual inspection of `dist/`: `index.html` at top level, `<base href="./"/>`, `href="styles-MBULMB7P.css"`, `src="main-QD3L37DV.js"` (relative, files present); `no-network.spec.ts` "the CSP only allows the app itself" asserts `<base href="./"` in the source | `npm run build -w packages/renderer` | Pass (structural). Loading `dist/index.html` from `file://` in Electron: Not run - launching the Electron binary needs interactive approval in this environment |
| AC2 `npm run dev -w packages/renderer` serves it for development | none | - | Not run: long-running dev server (`ng serve`) not started by the test-writer; parent should verify |
| AC3 Unit test for the root component runs in `npm run check` | `App > creates the root component and renders the title`, `App > runs zoneless: zone.js is not loaded` | `npm run check` (renderer step `ng test`: 2 files, 32 tests passed) | Pass |
| AC3 (propagation) a failing renderer spec fails the test run | Temporary probe `src/zz-probe.spec.ts` (`expect(1).toBe(2)`), removed afterwards | `npm run test -w packages/renderer` with the probe present | Pass: run failed (`2 failed / 32 passed`, `npm error code 1`). Root `npm run test` with the probe: Not run - this environment denied running the root script directly; propagation follows from the root script `vitest run && npm run test -w packages/renderer` (the `&&` chain returns the renderer's exit code), and `npm run check` was observed executing that renderer step |
| AC4 No external network resources (fonts local, no CDN) | `no-network.spec.ts`: per-file `%s loads nothing from the network` (index.html, styles.css, main.ts, app.ts, app.config.ts), `REMOTE flags %s` x14, `REMOTE leaves %s alone` x8, both CSP tests | `npm run test -w packages/renderer`; `npm run check` | Pass |
| AC4 guard actually fails on a remote resource in `src/` | Temporary probe `src/zz-probe.css` containing `@import url("https://fonts.googleapis.com/...")`, removed afterwards | `npm run test -w packages/renderer` with the probe present | Pass: `zz-probe.css loads nothing from the network` failed at the `not.toMatch(REMOTE)` assertion |
| AC4 built output has no remote references | grep of `dist/index.html`, `dist/*.css`, `dist/*.js` for remote `src`/`href`/`url()`/`@import` | `npm run build -w packages/renderer` then grep | Pass: none; only XML namespace identifier strings (`http://www.w3.org/...`) in Angular's bundle, which are not fetched |

## Focused test execution

Command:

`npm run test -w packages/renderer`

Result:

Pass (2 files, 32 tests). Probe runs (temporary failing spec + remote-font CSS) failed as intended; probes deleted, `git status` confirms only the two spec edits remain.

## Full test execution

Command:

`npm run check` (lint, Prettier, typecheck incl. `ngc` strictTemplates + `tsc -p tsconfig.spec.json`, `vitest run`, `ng test`)

Result:

Pass (root Vitest 4 files / 4 tests; renderer 2 files / 32 tests). The first run failed Prettier on the new `no-network.spec.ts`; fixed with `npx prettier --write` on that file and rerun green.

## .taskcheck

Result:

Pass (`.taskcheck` runs `npm run check`; see above).

## Bugs found

None. No production defects were found.

Non-blocking test-guard limitations (test code, not production bugs; no fix required for this task):
- `REMOTE` does not match `srcset="https://..."` (`\b(?:src|href)\s*=` does not match `srcset=`), nor JS-level fetches (`fetch('https://...')`, dynamic `import('https://...')`). The CSP (`default-src 'self'`) blocks those at runtime anyway. Worth extending when a task adds images with `srcset`.
- The scan covers `src/` only. `angular.json` also copies `public/**` as assets (folder does not exist yet), and fonts bundled from npm by the themes task will not be in `src/`. The themes task should scan `dist/` or the font CSS it adds.

## Coverage

Status: verified

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured separately. All three measured files are new in this task, so whole-file equals changed-line coverage for them.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `renderer-scaffold`, base `177498f9af42549fc1b6a13b0d1a3b1c2eb6ff9f`, HEAD `fabb8cf34d2bb5c79482919153dac9cb3b1de5c1`, commits `9bd783c` and `fabb8cf` (parent instructions + `git diff --stat 177498f..HEAD`).
- Source/test snapshot identifier (including uncommitted inputs): sha256 before and after the run, unchanged: `src/app/app.ts` 846ad554..., `src/app/app.config.ts` d3cbbcb5..., `src/main.ts` 07fe25c3..., `src/app/app.spec.ts` ad19a30e... (uncommitted), `src/no-network.spec.ts` 2cc57729... (uncommitted), `src/index.html` 55731934..., `src/styles.css` cadb1603..., `angular.json` c2c980cc....
- Exact included files: `src/app/app.ts`, `src/app/app.config.ts`, `src/main.ts`. Excluded: `src/index.html`, `src/styles.css` (not executable TS; covered by `no-network.spec.ts` content checks), config files (`angular.json`, `tsconfig*.json`, `package.json`, root `vitest.config.ts`), spec files, `docs/ARCHITECTURE.md`. Deleted at HEAD and not instrumentable: `src/index.ts`, `src/index.spec.ts`, `vitest.config.ts` of the renderer.
- Provider/version, command, working directory, and test selection: `@angular/build:unit-test` 22.2.7, Vitest 5.1.0 with `@vitest/coverage-v8` 5.1.0; `npx ng test --coverage --coverage-include='src/app/app.ts' --coverage-include='src/app/app.config.ts' --coverage-include='src/main.ts'` in `packages/renderer`; all renderer specs (2 files, 32 tests).
- Run start/completion time and exit status: 2026-11-16 18:47:17 to 18:47:18 (+01:00), exit 0, 32 passed.
- Generated report paths and report hashes/run identifier: `packages/renderer/coverage/renderer/coverage-summary.json` (sha256 c53dd25d...), `packages/renderer/coverage/renderer/lcov.info` (sha256 c372c449...), `coverage/renderer/lcov-report/`. Note: `packages/renderer/coverage/coverage-summary.json` and `lcov.info` at the top level are stale leftovers from 18:21 (old `src/index.ts`) and were not used.
- Evidence outputs are fresh and inputs stayed unchanged: yes; report files timestamped 18:47:18, newer than the last spec edit, and they list exactly the three included files; input hashes identical before and after.
- Final run after latest test additions and production fixes: yes (no production fixes were made).

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/app.ts` | 12/12 (100%) | 10/10 (100%) | 1/1 (100%) | 5/5 (100%) |
| `packages/renderer/src/app/app.config.ts` | 1/1 (100%) | N/A (0/0) | N/A (0/0) | 1/1 (100%) |
| `packages/renderer/src/main.ts` | 0/2 (0%) | N/A (0/0) | 0/1 (0%) | 0/1 (0%) |
| Aggregate (3 files, summed counters) | 13/15 (86.66%) | 10/10 (100%) | 1/2 (50%) | 6/7 (85.71%) |

Aggregate of the two files the parent named (`app.ts` + `app.config.ts`): statements 13/13, branches 10/10, functions 1/1, lines 6/6 (100%). The 10 branches and the `template` function in `app.ts` are source-mapped from Angular's AOT-compiled template code, not hand-written branches.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/renderer/src/main.ts:6` (`bootstrapApplication(...).catch(...)`) | App bootstrap entry; runs only in the browser build | Justified gap: importing it in jsdom would bootstrap into the test document. Its inputs (`App`, `appConfig`) are covered by `app.spec.ts`; the build (`npm run build -w packages/renderer`) compiles it. Exercised for real by the electron-shell/e2e tasks |

## Unable to test

- Loading `dist/index.html` via `file://` in Electron (AC1): launching Electron needs interactive approval here. Verified structurally only (relative base href and asset URLs, files present). Follow-up: electron-shell / e2e tasks.
- `npm run dev -w packages/renderer` (AC2): long-running dev server not started by the test-writer (curl to it would also need approval). Parent should verify, e.g. start `ng serve` and check that it reports serving on localhost:4200.
- Root `npm run test` with a failing renderer probe: this environment denied running the root script directly. Covered by the renderer-level probe (non-zero exit) plus the `&&` composition of the root script.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. Tests added and all validation passed (`npm run check`, renderer build). AC2 (dev server) and real `file://` loading in Electron were not run by the test-writer and need the parent's evidence or a recorded skip.

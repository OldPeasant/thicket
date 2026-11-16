# Test Report

Date: 2026-11-16

Task: renderer-scaffold - M0: Angular renderer workspace (second pass, final revision after the fixer commit)

Scope: task base `177498f9af42549fc1b6a13b0d1a3b1c2eb6ff9f`, measured HEAD `775834532a404883faa46707bea88318bd04c7c5` (`main`). Task-owned code commits: `7b0d988` (Scaffold the Angular 22 renderer), `b52fc6e` (Guard the renderer against network resources), `36fd6cc` (renderer scaffold tests and review reports, first test-writer pass), `7758345` (fixer: Node `>=24.15.0 <25` engines, extended `REMOTE` pattern; see `reviews/renderer-scaffold/fixes.md`). The other commits in `177498f..HEAD` (`a2604f3` .claude settings, `ac6de53` heartbeat, `e6d1c40`/`db01c07` claims of other tasks) are not task code and are excluded. Ownership established from the parent's instructions and `git log 177498f..HEAD`. Uncommitted at measurement: this pass's edit to `packages/renderer/src/no-network.spec.ts` and this report. `reviews/renderer-scaffold/review.md` was also modified in the working tree by another helper, not by this test-writer, and was not touched here.

Requirements:
- `tasks/renderer-scaffold.md` acceptance criteria and recorded assumptions
- `docs/ARCHITECTURE.md` "Stack" (Renderer paragraph) and "Coverage"
- `reviews/renderer-scaffold/fixes.md` (CR-1, CR-2) and the parent's re-validation instructions

## Test files changed

- `packages/renderer/src/no-network.spec.ts` (first pass, committed in `36fd6cc`; fixer in `7758345`; this pass, uncommitted)
- `packages/renderer/src/app/app.spec.ts` (first pass, committed in `36fd6cc`)

## Tests added or updated

Count: 6 test cases added in this pass (renderer total 40 -> 46), 1 test-guard pattern extended. Cumulative for the task: 8 -> 46 renderer tests.

This pass (gap left by the CR-2 fix):
- `REMOTE` did not match Angular's `NgOptimizedImage` attributes: `ngSrc="https://..."` and `ngSrcset="https://..."` returned `false`, checked with node against the fixer's pattern before editing. `\bsrc` has no word boundary inside `ngSrc`. These directives load the image from the given URL, so a remote URL there is an external network resource (AC4). The pattern now accepts an optional `ng` prefix: `\b(?:ng)?(?:src|href)...` and `\b(?:ng)?srcset...`.
- New `REMOTE flags %s` cases: `single-quoted srcset, protocol-relative`, `NgOptimizedImage ngSrc`, `NgOptimizedImage [ngSrc] binding`, `NgOptimizedImage ngSrcset`.
- New `REMOTE leaves %s alone` cases: `Angular [srcset] binding to a field`, `NgOptimizedImage local ngSrc` (local `ngSrc` with width-descriptor `ngSrcset="100w, 200w"`).

Earlier passes (still present and passing): 14 + 5 positive `REMOTE` cases, 8 + 3 negative cases, the per-file scan of `src/`, both CSP tests, and in `app.spec.ts` the root component render test and the zoneless test (`globalThis.Zone` undefined).

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 `npm run build -w packages/renderer` produces a static build that works from `file://` (relative base href) | Build run on the final revision plus inspection of `dist/index.html`: `<base href="./"/>`, `href="styles-MBULMB7P.css"`, `src="main-QD3L37DV.js"` (relative, both files present in `dist/`); `no-network.spec.ts` "the CSP only allows the app itself" asserts `<base href="./"` in the source | `npm run build -w packages/renderer` | Pass (structural; build completed and wrote `packages/renderer/dist`). Loading `dist/index.html` from `file://` in Electron: Not run, because launching the Electron binary needs interactive approval in this environment |
| AC2 `npm run dev -w packages/renderer` serves it for development | none | - | Not run: long-running dev server (`ng serve`) not started by the test-writer; the parent should verify it or record a skip |
| AC3 Unit test for the root component runs in `npm run check` | `App > creates the root component and renders the title`, `App > runs zoneless: zone.js is not loaded` | `npm run check` (renderer step `ng test`: 2 files, 46 tests passed) | Pass |
| AC3 (propagation) a failing renderer spec fails the test run | First pass: temporary probe spec `expect(1).toBe(2)` (removed) | `npm run test -w packages/renderer` with the probe | Pass in the first pass (run failed, `npm error code 1`). Not repeated: the fixer did not change the test scripts (`package.json` change is only `engines`) |
| AC4 No external network resources (fonts local, no CDN) | `no-network.spec.ts`: per-file `%s loads nothing from the network` (index.html, styles.css, main.ts, app.ts, app.config.ts), `REMOTE flags %s` x23, `REMOTE leaves %s alone` x13, both CSP tests | `npm run test -w packages/renderer`; `npm run check` | Pass |
| AC4 guard fails on a remote resource in `src/` | First pass: temporary `src/zz-probe.css` with a Google Fonts `@import url(...)` (removed) | `npm run test -w packages/renderer` with the probe | Pass in the first pass (the per-file test failed). The per-file test is unchanged; the positive `REMOTE` cases show the extended pattern still matches |
| AC4 built output has no remote references | `dist/index.html` read on the final build: only relative `href`/`src`, CSP lists only `'self'`/`data:` | `npm run build -w packages/renderer` | Pass for `index.html`. The full grep of `dist/*.css`/`*.js` was done in the first pass; this pass could not repeat it (shell grep was denied), and the build output names and sizes are identical (`main-QD3L37DV.js`, `styles-MBULMB7P.css`) because no production source changed |
| CR-1 engines `>=24.15.0 <25` | none (package metadata, not executable behavior) | `npm run check` on Node v24.21.0 | Pass (Node 24.21 is in range; a below-range Node was not tested) |

## Focused test execution

Command:

`npm run test -w packages/renderer` (after `npx prettier --write packages/renderer/src/no-network.spec.ts`)

Result:

Pass (2 files, 46 tests).

## Full test execution

Command:

`npm run check` (lint, Prettier, typecheck incl. `ngc` strictTemplates + `tsc -p tsconfig.spec.json`, root `vitest run`, renderer `ng test`)

Result:

Pass (root Vitest 4 files / 4 tests; renderer 2 files / 46 tests; no lint, format or type errors in the output).

Build: `npm run build -w packages/renderer`: Pass (`main-QD3L37DV.js` 96.36 kB, `styles-MBULMB7P.css` 70 B, output `packages/renderer/dist`).

## .taskcheck

Result:

Pass (`.taskcheck` runs `npm run check`; see above).

## Bugs found

None. No production defects were found.

Remaining non-blocking test-guard limitations (test code, not production bugs):
- `REMOTE` does not match JS-level fetches (`fetch('https://...')`, dynamic `import('https://...')`) or remote URLs built at runtime. The CSP (`default-src 'self'`) blocks them at runtime.
- The scan covers `src/` only. `angular.json` also copies `public/**` as assets (folder does not exist yet), and fonts bundled from npm by the themes task will not be in `src/`. The themes task should scan `dist/` or the font CSS it adds.

## Coverage

Status: verified

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured separately. All three measured files are new in this task, so whole-file coverage equals changed-line coverage for them. The fixer commit changed no instrumentable production source (`package.json`, `package-lock.json`, docs and a spec file only), so the numbers are identical to the first pass.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `renderer-scaffold`, base `177498f9af42549fc1b6a13b0d1a3b1c2eb6ff9f`, HEAD `775834532a404883faa46707bea88318bd04c7c5`, commits `7b0d988`, `b52fc6e`, `36fd6cc`, `7758345` (parent instructions + `git log`/`git diff --stat 177498f..HEAD`).
- Source/test snapshot identifier (including uncommitted inputs): sha256 at 18:50:45 and again after the run, unchanged: `src/app/app.ts` 846ad554..., `src/app/app.config.ts` d3cbbcb5..., `src/main.ts` 07fe25c3..., `src/app/app.spec.ts` ad19a30e..., `src/no-network.spec.ts` a9c31a52... (uncommitted edit from this pass), `src/index.html` 55731934..., `src/styles.css` cadb1603..., `angular.json` c2c980cc....
- Exact included files: `packages/renderer/src/app/app.ts`, `packages/renderer/src/app/app.config.ts`, `packages/renderer/src/main.ts`. Excluded: `src/index.html`, `src/styles.css` (not executable TS; covered by `no-network.spec.ts` content checks), config and metadata files (`angular.json`, `tsconfig*.json`, both `package.json`, `package-lock.json`, root `vitest.config.ts`, `.claude/settings.json`), spec files, `docs/ARCHITECTURE.md`, `reviews/`, `tasks/`. Deleted at HEAD and not instrumentable: `packages/renderer/src/index.ts`, `src/index.spec.ts`, `packages/renderer/vitest.config.ts`.
- Provider/version, command, working directory, and test selection: `@angular/build:unit-test` 22.2.7, Vitest 5.1.0 with `@vitest/coverage-v8` 5.1.0; `npx ng test --coverage --coverage-include='src/app/app.ts' --coverage-include='src/app/app.config.ts' --coverage-include='src/main.ts'` in `packages/renderer`; all renderer specs (2 files, 46 tests).
- Run start/completion time and exit status: 2026-11-16 18:50:49 (+01:00), finished within the second; 46 passed, coverage summary printed, no error output (success).
- Generated report paths and report hashes/run identifier: `packages/renderer/coverage/renderer/coverage-summary.json` (sha256 c53dd25d..., mtime 18:50:49.715), `packages/renderer/coverage/renderer/lcov.info` (sha256 c372c449..., mtime 18:50:49.718). The hashes equal the first pass because the measured files and their hits are identical; the mtimes show they were regenerated by this run. The top-level `packages/renderer/coverage/coverage-summary.json` and `lcov.info` are stale leftovers from an older run and were not used.
- Evidence outputs are fresh and inputs stayed unchanged: yes; report mtimes are from this run, after the last spec edit (18:50:21 formatting), and they list exactly the three included files; input hashes were identical before and after.
- Final run after latest test additions and production fixes: yes (after the fixer commit `7758345` and this pass's spec edit).

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `packages/renderer/src/app/app.ts` | 12/12 (100%) | 10/10 (100%) | 1/1 (100%) | 5/5 (100%) |
| `packages/renderer/src/app/app.config.ts` | 1/1 (100%) | N/A (0/0) | N/A (0/0) | 1/1 (100%) |
| `packages/renderer/src/main.ts` | 0/2 (0%) | N/A (0/0) | 0/1 (0%) | 0/1 (0%) |
| Aggregate (3 files, summed counters) | 13/15 (86.66%) | 10/10 (100%) | 1/2 (50%) | 6/7 (85.71%) |

Aggregate of the two files the parent named (`app.ts` + `app.config.ts`): statements 13/13, branches 10/10, functions 1/1, lines 6/6 (100%). The 10 branches and the `template` function in `app.ts` are source-mapped from Angular's AOT-compiled template code, not hand-written branches. No scoped file is missing from the report.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `packages/renderer/src/main.ts:6` (`bootstrapApplication(...).catch(...)`) | App bootstrap entry; runs only in the browser build | Justified gap: importing it in jsdom would bootstrap into the test document. Its inputs (`App`, `appConfig`) are covered by `app.spec.ts`; the build (`npm run build -w packages/renderer`) compiles it. The electron-shell/e2e tasks will exercise it for real |

## Unable to test

- Loading `dist/index.html` via `file://` in Electron (AC1): launching Electron needs interactive approval here. Verified structurally only. Follow-up: electron-shell / e2e tasks.
- `npm run dev -w packages/renderer` (AC2): long-running dev server not started by the test-writer. The parent should verify it, e.g. start `ng serve` and check that it reports serving on localhost.
- `engines` rejection below Node 24.15 (CR-1): only Node v24.21.0 is available here; the range is metadata and is not executed by tests.
- In this pass, shell commands that wrote to `/tmp`, chained exit-code captures or grepped `dist/` were denied by the environment; results above come from the commands that did run, with their visible output.

## Summary

Tests added and all validation passed. The final revision (HEAD `7758345` plus this pass's uncommitted spec edit) passes `npm run check` (renderer 46 tests), the renderer build succeeds, and task-scoped coverage is unchanged and sufficient (`app.ts` + `app.config.ts` 100%; `main.ts` bootstrap is a justified gap). One gap left by the CR-2 fix (`ngSrc`/`ngSrcset` not matched by the no-network guard) is closed with test-only changes. No production defects found. AC2 (dev server) and real `file://` loading in Electron still need the parent's evidence or a recorded skip.

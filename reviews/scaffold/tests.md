# Test Report

Date: 2026-11-16

Task: scaffold - M0: Monorepo scaffold with npm workspaces and the check

Scope: `git diff 347512bcbf1285bc0464d7c091ea25543318ac39..ef8b8802a312a17eb5f25e7f02a9e4f55bf1d8db` (final round, after the second fix). The parent worker supplied the task-owned commits, and `git log` confirmed them: `5429564` (npm-workspaces scaffold), `4fc7696` (fix for CR-1/CR-2: ESLint globals scoped per workspace, Node builtins banned in core, Node types, explicit Vitest projects) and `ef8b880` (fix for TW-1/CR-1 round 2: builtins moved to exact-match `paths`; `patterns` reduced to `node:*`, `electron`, `electron/*`). Branch `main`, HEAD = `ef8b880`. Working tree: the only changes are the untracked `reviews/scaffold/{fixes,review,tests}.md`. No source or test files are uncommitted.

Requirements:
- `tasks/scaffold.md` acceptance criteria
- `docs/ARCHITECTURE.md` ("Coverage", "Conventions": "`packages/core` stays free of Node and Electron APIs")
- `reviews/scaffold/fixes.md` round 2 (what `ef8b880` intends)
- `AGENTS.md`
- Parent worker instructions (re-run check, coverage, scoped coverage; repeat the import-ban probe in both directions)

## Test files changed

- None. Only this report was written. Two temporary lint probes, `packages/core/src/tmp-probe-pass.ts` and `packages/core/src/tmp-probe-fail.ts`, were created and then deleted. Afterwards, `git status --short --untracked-files=all` showed only `reviews/scaffold/*.md`.

## Tests added or updated

Count: 0

Reason: `ef8b880` changes only `eslint.config.mjs`. The executable production code is five placeholder constants, and each already has a trivial spec (AC1). The project has no pattern for lint-rule tests, so the import ban was checked directly with temporary probes in both directions (table below). A permanent lint-fixture spec remains an optional follow-up. It is not required by the scaffold criteria.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: `npm run check` runs lint + type check + unit tests of every workspace and passes; one trivial spec per workspace | 5 existing `src/index.spec.ts` (apps/desktop, packages/{contract,core,backend,renderer}) | `npm run check` (repo root) | Pass: ESLint `--max-warnings 0` clean, Prettier clean, root + 5 workspace `tsc` pass, Vitest 5 files / 5 tests passed (105 ms, start 18:20:41). The 2-minute wall-clock limit for `npm ci && npm run check` on a clean clone was not timed here; the parent records it. |
| AC2: `npm run coverage` writes `coverage/coverage-summary.json` and lcov per workspace | same 5 specs | `npm run coverage` (repo root) | Pass: each of the 5 workspaces wrote `coverage/coverage-summary.json`, `lcov.info` and `lcov-report/` (mtimes 18:20:42-18:20:44, this run) |
| AC2: task-scoped command in ARCHITECTURE.md "Coverage" works as written | `packages/core/src/index.spec.ts` | `npm --prefix packages/core run coverage -- --coverage.include=src/index.ts` | Pass: 1/1 test, RUN cwd `packages/core`, statements 1/1, lines 1/1 |
| AC3: `sh .taskcheck` passes | - | `sh .taskcheck` (repo root) | Pass (runs `npm run check`; 5/5 tests, start 18:20:52) |
| AC4: Node pinned, README quick start | - | - | Not testable (static files); unchanged by the fix commits |
| AC5: `dashboard/` and TFP Python files excluded | - | `npm run check`, plus inspection of the `eslint.config.mjs` ignores and the `vitest.config.ts` projects | Pass: Vitest runs exactly the 5 explicit projects; ignores unchanged |
| AC6: library versions in ARCHITECTURE.md "Stack" | - | - | Not testable (documentation) |
| Convention: core rejects Node and Electron imports (CR-2) | temporary probe `tmp-probe-fail.ts`, round A: `fs`, `fs/promises`, `node:fs`, `electron`; round B: `node:fs/promises`, `path/posix`, `electron/main`, `crypto` | `npx eslint packages/core/src/tmp-probe-fail.ts` | Pass: exit 1, 4/4 errors in each round (`no-restricted-imports`). `fs`, `fs/promises`, `path/posix` and `crypto` are matched by `paths` ("import is restricted from being used"); `node:fs`, `node:fs/promises`, `electron` and `electron/main` are matched by the pattern |
| Convention: core may import its own modules and npm packages (TW-1 regression) | temporary probe `tmp-probe-pass.ts`, round A: `./util`, `./events`, `../stream`, `./query/path`, `bson/lib/utils/string_decoder`; round B: `./fs`, `./crypto/hash`, `events-lite`, `@scope/util` | `npx eslint packages/core/src/tmp-probe-pass.ts` | Pass: exit 0, no output for both rounds. TW-1 is fixed |

## Focused test execution

Command:

`npx eslint packages/core/src/tmp-probe-pass.ts` and `npx eslint packages/core/src/tmp-probe-fail.ts` (two rounds each, files deleted afterwards)

`npm --prefix packages/core run coverage -- --coverage.include=src/index.ts`

Result:

Pass. Every legitimate import was accepted and every Node or Electron import was rejected. Scoped coverage: 1 file, 1 test, 100% statements and lines.

## Full test execution

Command:

`npm run check` (repo root), then `npm run coverage` (repo root)

Result:

Pass. `check`: lint, typecheck and 5/5 tests. `coverage`: 5 workspaces, 1/1 test passed in each.

## .taskcheck

Result:

Pass (`sh .taskcheck` from the repo root ran `npm run check`: lint, typecheck, 5/5 tests).

## Bugs found

None open. TW-1 (from the round on `4fc7696`: the core import ban rejected `./util`, `./events`, `../stream`, `./query/path` and `bson/lib/utils/string_decoder`) is fixed in `ef8b880` and confirmed by the pass-direction probes above.

Observation (not a defect): `paths` matches exact names only, so a non-existent builtin subpath such as `fs/foo` would not be flagged. Every real builtin subpath (`fs/promises`, `path/posix`, ...) is listed in `builtinModules` and is rejected, and all `node:`-prefixed forms are caught by `node:*`.

## Coverage

Status: verified

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: the same as whole-file coverage. All five scoped files are new in this task, so every executable line is a changed line. `ef8b880` changed no file in the coverage scope (only `eslint.config.mjs`).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `scaffold`; base `347512bcbf1285bc0464d7c091ea25543318ac39`; HEAD `ef8b8802a312a17eb5f25e7f02a9e4f55bf1d8db`. Commits `5429564`, `4fc7696` and `ef8b880` were supplied by the parent and confirmed with `git log` / `git show --stat ef8b880`.
- Source/test snapshot identifier (including uncommitted inputs): commit `ef8b880`. There were no uncommitted source or test inputs: `git status` showed only the untracked `reviews/scaffold/*.md`, and the temporary probes were deleted before the check and coverage runs.
- Exact included files; renamed/deleted/excluded files and reasons: included `apps/desktop/src/index.ts`, `packages/contract/src/index.ts`, `packages/core/src/index.ts`, `packages/backend/src/index.ts`, `packages/renderer/src/index.ts`. Excluded: `*.spec.ts` (tests); `package.json`, `package-lock.json`, `tsconfig*.json`, `eslint.config.mjs`, `.prettierignore`, `.nvmrc`, the root and per-workspace `vitest.config.ts`, and `vitest.shared.ts` (build, lint and test configuration with no runtime product behavior; the ESLint rule was checked with lint probes instead); `README.md` and `docs/ARCHITECTURE.md` (documentation). No renames or deletions.
- Provider/version, command, working directory, and test selection: Vitest v5.1.0 with `@vitest/coverage-v8` (v8 provider). (1) `npm run coverage` at the repo root runs `vitest run --coverage` in each of the 5 workspaces, each with its full spec set. (2) `npm --prefix packages/core run coverage -- --coverage.include=src/index.ts` runs with cwd `packages/core` (RUN line `.../agent-1/packages/core`).
- Run start/completion time and exit status: 2026-11-16. Run (1): workspaces started 18:20:42-18:20:43, 106-113 ms each, exit 0. Run (2): started 18:20:45, 122 ms, exit 0.
- Generated report paths and report hashes/run identifier: `coverage/coverage-summary.json`, `coverage/lcov.info` and `coverage/lcov-report/` inside each workspace directory (git-ignored). sha256 of each `coverage-summary.json`: apps/desktop `b29673e216b6de3d1dd3d500f52d7749ebd5887d83be02a497cdb9eab5e8ed39`, packages/contract `5dea94d9b8294b67a917a930a09033d17f49810d6575ce32904233fd4c49d5b2`, packages/backend `8717d563a23697671a7ec640e2dde542364159b445b8f51014a5e79f39e356b8` and packages/renderer `d72e698344693acf8f421fec4526668ff096c4342ae0ec7d388cb739d4811f33` (run 1); packages/core `cc09dbce4f93c8a6a8a0ba08b0b695452656f9690fcfa0b48f8de14a2aa52685` (run 2, which overwrote run 1's core report). The hashes are identical to the earlier rounds because the content is deterministic and the measured files and specs did not change. The mtimes show the files were rewritten by this round.
- Evidence outputs are fresh and inputs stayed unchanged: yes. The mtimes (18:20:42-18:20:44 for run 1, 18:20:45 for core in run 2) match this round's runs, and the tree stayed at `ef8b880` with no source or test changes.
- Final run after latest test additions and production fixes: yes, for the final revision `ef8b880`.

Values below use covered/total (percentage); zero-denominator metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `apps/desktop/src/index.ts` | 1/1 (100%) | 0/0 (N/A) | 0/0 (N/A) | 1/1 (100%) |
| `packages/contract/src/index.ts` | 1/1 (100%) | 0/0 (N/A) | 0/0 (N/A) | 1/1 (100%) |
| `packages/core/src/index.ts` | 1/1 (100%) | 0/0 (N/A) | 0/0 (N/A) | 1/1 (100%) |
| `packages/backend/src/index.ts` | 1/1 (100%) | 0/0 (N/A) | 0/0 (N/A) | 1/1 (100%) |
| `packages/renderer/src/index.ts` | 1/1 (100%) | 0/0 (N/A) | 0/0 (N/A) | 1/1 (100%) |
| Aggregate (summed counters; 5/5 scoped files measured, none missing; configuration and documentation excluded as listed above) | 5/5 (100%) | 0/0 (N/A) | 0/0 (N/A) | 5/5 (100%) |

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| None in the coverage scope | - | No uncovered lines or branches |
| `eslint.config.mjs:51-66` (configuration, outside the coverage metric) | Core import ban must reject Node and Electron imports and accept legitimate imports | Verified with temporary lint probes in both directions (2 rounds each); no permanent test (no lint-test pattern in the project) |

## Unable to test

- AC1 timing (< 2 min for `npm ci && npm run check` on a clean clone): not timed here; the parent records it. The check itself took a few seconds.
- AC4 and AC6: static files and documentation; not unit-testable.
- The core import ban has no permanent automated test, only temporary probes. Optional follow-up: a lint-fixture spec using `ESLint#lintText` with `filePath` under `packages/core/src/`.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. At `ef8b880`, `npm run check`, `npm run coverage`, the task-scoped coverage command and `sh .taskcheck` all pass, and the task-changed files have 100% statement and line coverage (5/5). TW-1 is fixed: the core import ban accepts `./util`, `./events`, `../stream`, `./query/path`, `bson/lib/utils/string_decoder` and other legitimate imports, and rejects `fs`, `fs/promises`, `node:fs`, `node:fs/promises`, `path/posix`, `crypto`, `electron` and `electron/main`.

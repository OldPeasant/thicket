# Test Report

Date: 2026-11-16

Task: packaging — M0: electron-builder packaging for the current OS (second round, final code)

Scope: `git diff 4ae2ad2b7a439a8aab3309240ede2a5ac361fc6e..88c680395d4a146b272f5a20aba42438f63243ac -- . ':!tasks' ':!reviews'`
(final revision 88c6803 = task code 7637221 plus fixer commit 88c6803; afa57fa in between only adds
`tasks/electron-tests-hash-url.md`). Branch main, measured HEAD 88c680395d4a146b272f5a20aba42438f63243ac,
working tree clean (no uncommitted inputs).

Requirements:
- `tasks/packaging.md` acceptance criteria and recorded assumptions
- `docs/ARCHITECTURE.md` ("Packaging", "Coverage")
- `reviews/packaging/fixes.md` (CR-1 ad-hoc mac signing, CR-2 workspace `dist`/`dist:dir` build the
  renderer first, CR-4 smoke script launches inside `try`)

## Test files changed

None in this round. `apps/desktop/src/packaging.spec.ts` (written in round 1, adjusted by the fixer,
committed in 88c6803) was re-checked against the final behaviour and left unchanged.

## Tests added or updated

Count: 0 (this round). The committed spec has 21 tests and already asserts the fixer's changes:
- CR-1: `builds an ad-hoc signed (no Developer ID) dmg for arm64 and x64 on macOS` checks
  `mac.identity === '-'`, `hardenedRuntime === false`, `dmg.sign === false`, dmg archs arm64/x64.
- CR-2: `builds with the electron-builder config via dist and dist:dir, never publishing` checks both
  workspace scripts start with `npm run build -w @thicket/renderer && node scripts/build.mjs && electron-builder `
  and use `--config electron-builder.yml --publish never` (`dist:dir` with `--dir`);
  `is reachable from the root as npm run dist, delegating to the workspace (renderer built once)`
  checks root `dist` is exactly `npm run dist -w apps/desktop`.
- CR-4 (smoke script cleanup on launch failure): no automated test. I considered a test spawning
  `node scripts/smoke-packaged.mjs /nonexistent/...` with a scratch `TMPDIR`, but running the script
  was denied by the permission system in this session, so I did not add a test I could not run.
  The fixer's manual run (fixes.md: exit 1, `smoke: FAILED`, 0 leftover temp dirs) is the only evidence.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: on Linux `npm run dist` produces AppImage, deb, rpm; the AppImage starts and shows the window | Static only: Linux targets AppImage/deb/rpm, maintainer, executable/package names, dist scripts and root delegation, renderer extraResource matches main's packaged path | `cd apps/desktop && npx vitest run src/packaging.spec.ts` | Pass (config only). Real build + AppImage launch: Not run by test-writer (slow, needs rpmbuild/container; smoke script execution denied here); parent/fixer evidence in fixes.md and task assumptions |
| AC2: app id `io.github.oldpeasant.thicket`, product name Thicket, placeholder icon in build/ | `sets the app id ... and product name Thicket`; `has the same product name as the electron-builder config`; `points every platform at the placeholder icon in build/`; three `build/icon.png` tests | `cd apps/desktop && npx vitest run src/packaging.spec.ts` | Pass |
| AC3: macOS/Windows targets configured | `builds an ad-hoc signed (no Developer ID) dmg for arm64 and x64 on macOS`; `builds NSIS and zip for x64 on Windows`; `passes electron-builder's own schema validation` | `cd apps/desktop && npx vitest run src/packaging.spec.ts` | Pass (configuration). Building/running on macOS/Windows: Not run — OSes not available |
| CR-2: workspace `dist`/`dist:dir` build the renderer first; root delegates | `builds with the electron-builder config via dist and dist:dir, never publishing`; `is reachable from the root as npm run dist, delegating ...` | same | Pass |
| CR-4: smoke script reports failure and cleans up on launch failure | none | — | Not run: executing the script was denied by the permission system in this session |
| Packaged main loads renderer from `resources/renderer` | `copies the built renderer to resources/renderer, where main looks when packaged` (static) | same | Pass (static); runtime only via packaged smoke run (parent/fixer) |

## Focused test execution

Command:

`cd apps/desktop && npx vitest run src/packaging.spec.ts`;
`cd apps/desktop && npx eslint src/packaging.spec.ts && npx prettier --check src/packaging.spec.ts electron-builder.yml package.json scripts/smoke-packaged.mjs && npx tsc -p tsconfig.json`

Result:

Pass — 21/21 tests (605 ms); eslint, Prettier and desktop typecheck clean.

Desktop workspace suite (run as part of coverage, below): `npx vitest run --coverage --coverage.include='src/main/index.ts'`
-> 12 files / 312 tests passed.

## Full test execution

Command:

`npm run check` (repo root)

Result:

Not run — the permission system denied `npm run check` in this session. The parent worker must run
it (and `.taskcheck`) on 88c6803 before `done`. Round 1 and the fixer (fixes.md) report it passing on
the pre-commit working tree with the same contents.

## .taskcheck

Result:

Not run — `.taskcheck` runs `npm run check`, which was denied here (see above).

## Bugs found

None.

## Coverage

Status: verified (measurement succeeded on 88c6803; the single in-scope TypeScript file has 0% coverage, justified below).

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured separately; the whole file has 0 covered lines, so the changed
executable lines (`rendererDir` expression, `src/main/index.ts` lines ~50-55) are also uncovered.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: packaging; base
  4ae2ad2b7a439a8aab3309240ede2a5ac361fc6e; task commits 7637221 and 88c6803; HEAD
  88c680395d4a146b272f5a20aba42438f63243ac; scope given by the parent and confirmed with
  `git diff --stat 4ae2ad2..88c6803 -- . ':!tasks' ':!reviews'`.
- Source/test snapshot identifier (including uncommitted inputs): HEAD 88c6803, clean tree. sha256:
  `apps/desktop/src/packaging.spec.ts` fbae3e3a8ddb1e512db74f31fca25b4e6489948431d9df2c641dd4453f4d783f,
  `apps/desktop/src/main/index.ts` e8a3a7564a4b6a02451e5f4b2d33bf552b9f91a2ac79a85092df00468cb4cd1e,
  `apps/desktop/electron-builder.yml` 8ef3c8475ee253825cf38b992bc658f968f4afa3a9d37cf7d43bbd8c9e5a9ed4,
  `apps/desktop/package.json` 8ecc78d7a5af3c6f810a72fd5e5a8ca333cd606fa6bde83fb32cc306bdde634b,
  `package.json` f6d138b9c5472e759fc6b3f1f6e1e872695d987795b8bf009d63a509ca8ada74,
  `apps/desktop/scripts/smoke-packaged.mjs` 11a781508274b8533bee9798d8e6cad4d1f416508f2d6a94e2d420cf81009cc4.
- Exact included files; renamed/deleted/excluded files and reasons: included `apps/desktop/src/main/index.ts`
  (the only changed `.ts` production file; unchanged by the fixer). Excluded (no instrumentation under the
  workspace Vitest coverage): `apps/desktop/electron-builder.yml`, `apps/desktop/package.json`, root
  `package.json` (configuration, asserted by the spec); `apps/desktop/build/icon.png` (binary asset,
  asserted by the spec); `apps/desktop/scripts/make-icon.mjs`, `apps/desktop/scripts/smoke-packaged.mjs`
  (build/smoke scripts outside `src/`); `.gitignore`, `.prettierignore`, `eslint.config.mjs`,
  `docs/ARCHITECTURE.md`, `package-lock.json` (non-executable/config/doc). No renames or deletions.
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8` 5.1.0
  (vitest 5.1.0); `npx vitest run --coverage --coverage.include='src/main/index.ts'` in `apps/desktop`;
  full desktop workspace suite (12 files, 312 tests, including `src/packaging.spec.ts`).
- Run start/completion time and exit status: 2026-11-16 20:36:07 +0100 to 20:36:09 +0100; all tests
  passed, coverage summary printed.
- Generated report paths and report hashes/run identifier: `apps/desktop/coverage/coverage-summary.json`
  (written 20:36:08.998 +0100, sha256 a051fae134b502fc223bf1837b7d2f6e39dcb39eca31c7ae0f9bc66fbd58d04a —
  byte-identical to round 1 because the measured file and its counts are unchanged),
  `apps/desktop/coverage/lcov.info`, `apps/desktop/coverage/lcov-report/` (git-ignored).
- Evidence outputs are fresh and inputs stayed unchanged: report file mtime is within this run; tree
  clean before and after, input hashes taken after the run match HEAD.
- Final run after latest test additions and production fixes: yes (on 88c6803, after the fixer commit).

Values below use covered/total (percentage).

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `apps/desktop/src/main/index.ts` | 0/64 (0%) | 0/22 (0%) | 0/24 (0%) | 0/57 (0%) |

Aggregate over the measured scope (one file): identical to the row above. Unmeasured by design: the
config/asset/script files listed under exclusions.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `apps/desktop/src/main/index.ts`: whole file, including the changed `app.isPackaged ? path.join(process.resourcesPath, 'renderer') : …` branch (~lines 50-55) | Packaged app loads the renderer from `resources/renderer` (AC1: AppImage shows the window) | Justified gap for unit coverage: Electron main entry with import-time side effects (app lifecycle, protocol registration, backend); `rendererDir` is a module-level constant, so a unit test would only exercise mocks. The spec statically checks the extraResources target matches the main path; the packaged branch runs in `scripts/smoke-packaged.mjs` against the built app (parent/fixer: smoke OK), the unpackaged branch in `npm run test:electron`. |
| `apps/desktop/scripts/smoke-packaged.mjs` (not instrumented): launch-failure path in `try`/`finally` (CR-4) | Smoke run reports `smoke: FAILED`, exits 1 and removes its temp userData dir when launch fails | No automated test: running the script was denied in this session. Evidence only from fixes.md manual run. Low risk (test tooling, not shipped code). |

## Unable to test

- `npm run check` / `.taskcheck` on 88c6803: denied by the permission system here; parent must run it.
- Building installers and launching the packaged AppImage: too slow for the check and needs rpmbuild/
  container; done by the parent/fixer.
- Smoke script launch-failure path (CR-4): script execution denied here; fixer verified manually.
- macOS dmg (ad-hoc signing, Gatekeeper behaviour) and Windows NSIS/zip: OSes not available;
  configuration only. Follow-up: per-OS CI runners (installer-smoke / release-ci).
- `src/main/index.ts` packaged-path branch at unit level: see the coverage gap table.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. The committed spec covers
the fixer's final behaviour (ad-hoc mac signing, renderer-first `dist`/`dist:dir`, root delegation);
no test files were changed this round. `npm run check`/`.taskcheck` could not be run by me (permission
denied) and must be run by the parent before `done`.

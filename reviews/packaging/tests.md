# Test Report

Date: 2026-11-16

Task: packaging — M0: electron-builder packaging for the current OS

Scope: `git diff 4ae2ad2b7a439a8aab3309240ede2a5ac361fc6e..7637221b8e4679df8a72068a21c31dae59ec233d`
(task code commit 7637221; HEAD afa57fa only adds `tasks/electron-tests-hash-url.md`). Branch main,
measured HEAD afa57fa3b27b504025af0e46e65890622e0b4311. Uncommitted: only the new test file below.

Requirements:
- `tasks/packaging.md` acceptance criteria and recorded assumptions
- `docs/ARCHITECTURE.md` ("Packaging" bullet, "Coverage")
- Parent worker's description of the change and its already-run verification

## Test files changed

- `apps/desktop/src/packaging.spec.ts` (new, untracked)

## Tests added or updated

Count: 21

The spec reads `apps/desktop/electron-builder.yml` with electron-builder's own loader
(`getConfig` from `app-builder-lib`, the same code path `npm run dist` uses, including its
normalisation of `files`) and runs electron-builder's schema validation (`validateConfiguration`).
No new dependency: `app-builder-lib` and `builder-util` are installed by the existing
`electron-builder` devDependency of `apps/desktop`. The icon checks use only `node:zlib`.

Tests (vitest `|desktop| src/packaging.spec.ts`):
- electron-builder.yml: `passes electron-builder's own schema validation`;
  `sets the app id io.github.oldpeasant.thicket and product name Thicket`;
  `uses build/ for resources and writes installers to release/ (git-ignored)`;
  `builds AppImage, deb and rpm on Linux with a lower-case executable and package name`;
  `builds an unsigned dmg for arm64 and x64 on macOS`; `builds NSIS and zip for x64 on Windows`;
  `points every platform at the placeholder icon in build/`;
  `packs the dist bundles (without source maps) and package.json into the app`;
  `copies the built renderer to resources/renderer, where main looks when packaged`;
  `rebuilds native modules for Electron and unpacks them from the asar`;
  `names artifacts thicket-<version>-<os>-<arch>.<ext>`
- apps/desktop/package.json: `has the same product name as the electron-builder config (userData folder Thicket)`;
  `names the desktop entry thicket.desktop, matching the Linux executable`;
  `has the homepage and author e-mail that deb/rpm metadata need`;
  `pins electron to an exact version (electron-builder rejects a hoisted range)`;
  `keeps bundled workspace packages out of the runtime dependencies (asar holds only dist)`;
  `builds with the electron-builder config via dist and dist:dir, never publishing`;
  `is reachable from the root as npm run dist, which builds the renderer first`
- build/icon.png: `is a well-formed PNG (signature, IHDR first, IEND last, valid CRCs)`;
  `is a square RGBA image of at least 512x512 (electron-builder minimum for macOS)`;
  `has image data that inflates to exactly one filtered row per scanline`

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: on Linux `npm run dist` produces AppImage, deb, rpm; AppImage starts and shows the window | Static part only: Linux targets AppImage/deb/rpm, maintainer present, dist scripts wired, renderer extraResource matches main's packaged path | `npx vitest run src/packaging.spec.ts` (in `apps/desktop`) | Pass (config only). Actual build + AppImage launch: Not run by test-writer — run by the parent (`npm run dist` in podman node:24-bookworm with rpm; `node scripts/smoke-packaged.mjs release/thicket-0.0.0-linux-x86_64.AppImage` -> smoke OK); too slow for `npm run check` |
| AC2: app id `io.github.oldpeasant.thicket`, product name Thicket, placeholder icon in build/ | app id/product name test; package.json productName consistency; icon path per platform; three `build/icon.png` tests (valid PNG, 1024x1024 RGBA >= 512, IDAT inflates to expected size) | `npx vitest run src/packaging.spec.ts` | Pass |
| AC3: macOS/Windows targets configured | `builds an unsigned dmg for arm64 and x64 on macOS`; `builds NSIS and zip for x64 on Windows`; schema validation | `npx vitest run src/packaging.spec.ts` | Pass (configuration only). Building/running on macOS/Windows: Not run — those OSes are not available here |
| main uses `resources/renderer` when `app.isPackaged` | `copies the built renderer to resources/renderer, where main looks when packaged` (checks the mapping and that main/index.ts contains the packaged path) | `npx vitest run src/packaging.spec.ts` | Pass (static). Runtime behavior covered only by the parent's packaged smoke run |

## Focused test execution

Command:

`cd apps/desktop && npx vitest run src/packaging.spec.ts` (plus `npx eslint src/packaging.spec.ts`,
`npx prettier --check src/packaging.spec.ts`, `npx tsc -p tsconfig.json`)

Result:

Pass — 21/21 tests, ~0.65 s; lint, Prettier and typecheck clean. (First run had 1 failing test due
to a wrong test assumption: electron-builder normalises `files` to `[{ filter: [...] }]`; the test
was fixed, not production code.)

## Full test execution

Command:

`npm run check` (repo root: eslint + prettier, typecheck of all workspaces, `vitest run`, `ng test`)

Result:

Pass — root vitest 35 files / 2187 tests passed; renderer 27 files / 437 tests passed.

`npm run test:electron` was not run: the parent reports 5 pre-existing failures on main (task
electron-tests-hash-url), out of scope.

## .taskcheck

Result:

Pass — `.taskcheck` runs `npm run check` when `package.json` exists; that command passed (above).

## Bugs found

None.

## Coverage

Status: verified (measurement succeeded; the single in-scope TypeScript file has 0% coverage, justified below).

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured separately; since the whole file has 0 covered lines, the
changed executable lines (rendererDir expression, `src/main/index.ts` ~lines 51-55) are also 0 covered.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: packaging;
  base 4ae2ad2b7a439a8aab3309240ede2a5ac361fc6e; task commit 7637221b8e4679df8a72068a21c31dae59ec233d;
  HEAD afa57fa3b27b504025af0e46e65890622e0b4311 (tasks-only commit); scope given by the parent and
  confirmed with `git diff --name-only 4ae2ad2..7637221`.
- Source/test snapshot identifier (including uncommitted inputs): sha256
  `apps/desktop/src/packaging.spec.ts` 4c951771a12ef924cd128ab94249c73188f6aace9fe454f73d78b83ab66dad25,
  `apps/desktop/src/main/index.ts` e8a3a7564a4b6a02451e5f4b2d33bf552b9f91a2ac79a85092df00468cb4cd1e,
  `apps/desktop/electron-builder.yml` 93ff887a26e3be60daaf4a15a8abeae93e9d644900e8be94772a4cda95d457df,
  `apps/desktop/package.json` 9b112f8a5fad2db41450ba509093137b5d14175f18f07434ae4208e01b941aa2.
- Exact included files; renamed/deleted/excluded files and reasons: included `apps/desktop/src/main/index.ts`
  (the only changed `.ts` production file). Excluded from instrumentation (not TypeScript under the
  workspace's Vitest coverage, so no instrumentation exists for them): `apps/desktop/electron-builder.yml`
  and `apps/desktop/package.json` / root `package.json` (configuration, verified by the new spec);
  `apps/desktop/build/icon.png` (binary asset, verified by the new spec);
  `apps/desktop/scripts/make-icon.mjs` and `apps/desktop/scripts/smoke-packaged.mjs` (build/smoke
  scripts outside `src/`, not covered by the configured coverage include; smoke-packaged was executed
  by the parent against the AppImage); `.gitignore`, `.prettierignore`, `eslint.config.mjs`,
  `docs/ARCHITECTURE.md`, `package-lock.json` (non-executable/config/doc).
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8` 5.1.0 (vitest 5.1.0);
  `npx vitest run --coverage --coverage.include='src/main/index.ts'` in `apps/desktop`; full desktop
  workspace suite (12 files, 312 tests, includes the new spec).
- Run start/completion time and exit status: started 2026-11-16 20:29:53 +0100, report written
  20:29:55 +0100; exit 0, all tests passed.
- Generated report paths and report hashes/run identifier: `apps/desktop/coverage/coverage-summary.json`
  (sha256 a051fae134b502fc223bf1837b7d2f6e39dcb39eca31c7ae0f9bc66fbd58d04a), `apps/desktop/coverage/lcov.info`,
  `apps/desktop/coverage/lcov-report/` (git-ignored).
- Evidence outputs are fresh and inputs stayed unchanged: report files timestamped by this run; no
  source/test edits after the run.
- Final run after latest test additions and production fixes: yes (no production fixes were made).

Values below use covered/total (percentage).

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `apps/desktop/src/main/index.ts` | 0/64 (0%) | 0/22 (0%) | 0/24 (0%) | 0/57 (0%) |

Aggregate over the measured scope (one file): identical to the row above. Unmeasured by design:
the config/asset/script files listed under exclusions.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `apps/desktop/src/main/index.ts`: whole file, including the changed `app.isPackaged ? path.join(process.resourcesPath, 'renderer') : …` branch (~lines 51-55) | Packaged app loads the renderer from `resources/renderer` (AC1: AppImage shows the window) | Justified gap for unit coverage: the module is Electron's main entry with import-time side effects (`app` lifecycle, protocol registration, backend spawn); `rendererDir` is a module-level constant, not an exported function, so a unit test would require mocking `electron`, `@thicket/backend` and the whole main wiring, testing mocks rather than behavior. The packaged branch is exercised end-to-end by `scripts/smoke-packaged.mjs` against the built AppImage (parent: smoke OK); the unpackaged branch by `npm run test:electron`. The new spec statically checks that the extraResources target and the main path agree. |

## Unable to test

- Building the installers and launching the packaged AppImage inside `npm run check`: too slow
  (minutes, needs rpmbuild/container) for the < 2 min check; done by the parent as described above.
- macOS dmg and Windows NSIS/zip builds and launch: those OSes are not available here; only the
  configuration is tested. Follow-up: CI runners per OS (as noted in the config comment).
- `src/main/index.ts` packaged-path branch at unit level: see the coverage gap table.

## Summary

Tests added and all validation passed. No production defects found; the only task-changed
TypeScript file is Electron main-process wiring that is covered by the packaged smoke run rather
than by unit tests.

# Test Report

Date: 2026-11-17

Task: release-native-modules - Release: bundle works when native modules (ssh2, os-dns-native) are compiled

Scope: the task diff `f6b1b1225b680609226e3caa422fb0f5038b2e46..bb4a42ff4cec40525760c77f80b1b579a777a8cb`, base and final revision supplied by the parent worker. This is the final code after the fixes for review findings CR-1 and CR-2. I measured at HEAD `bb4a42ff4cec40525760c77f80b1b579a777a8cb` on branch `main`. The only uncommitted input is this pass's change to `apps/desktop/src/build/native-addons.spec.ts`. `reviews/release-native-modules/review.md` also had an uncommitted change during this pass. I did not make it, and it is not a code input.

Requirements:
- The acceptance criteria and recorded assumptions in `tasks/release-native-modules.md`
- `reviews/release-native-modules/review.md` (CR-1, CR-2) and `reviews/release-native-modules/fixes.md`. They define the final behavior:
  - only the addons in `OPTIONAL_ADDONS` are stubbed;
  - any other `*.node` import fails the build;
  - stubs are named `<package>/<path inside package>`.
- The project notes in `AGENTS.md` (OS-neutral tests, no assertions that depend on timing) and the "Coverage" section of `docs/ARCHITECTURE.md`
- The parent worker's instructions

## Test files changed

- `apps/desktop/src/build/native-addons.spec.ts`

## Tests added or updated

Count: 2 added in this pass. The 19 tests from the fixer stay unchanged, for 21 tests in total.

- `omitNativeAddons` > stubs an allow-listed addon required by absolute path, with its package path in the message. This covers the `isAbsolute` path. The path comes from `path.join`, so on Windows it is a drive-letter path.
- `omitNativeAddons` > fails the build for an unlisted addon given as an entry point, naming the working directory. This covers the `args.importer || args.resolveDir` fallback, which was the only uncovered branch at the start of this pass.

I reviewed the 19 existing tests against the final `native-addons.ts`. Together with the two new tests, they cover:
- the allow-list matching, including both Release and Debug builds and addons that were never compiled;
- build errors for unlisted packages, for unlisted addons in allow-listed packages (whether or not the addon was compiled) and for addons outside `node_modules`;
- stubs named after their package, including scoped packages;
- bare-specifier, ESM and absolute imports;
- POSIX and Windows separators in `addonLocation`;
- safe quoting in the stub source.

The tests build all paths with `path.join` and create temporary directories with `os.tmpdir()`/`mkdtempSync`. They do not depend on file permissions, signals or timing.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1, unit-level part: a compiled addon no longer breaks esbuild | `without it, esbuild refuses a compiled addon...`, `bundles code that requires an allow-listed addon...`, `stubs every allow-listed addon in one bundle...`, `also stubs an allow-listed addon imported from an ES module`, `stubs an allow-listed addon named by a bare package specifier`, `stubs an allow-listed addon required by absolute path...` | `cd apps/desktop && npx vitest run src/build --coverage --coverage.include=src/build/native-addons.ts` | Pass (21/21). The parent ran the container `npm run dist` at bb4a42ff and got DIST_EXIT=0. This helper did not run it |
| AC1 and assumption: builds without a toolchain behave the same | `stubs an allow-listed addon that was never compiled...` (os-dns-native, Release and Debug) | same | Pass |
| Assumption: the stub throws MODULE_NOT_FOUND, so the JS fallback runs | `bundles code that requires an allow-listed addon...`, `an unguarded require of an allow-listed addon throws when the module is loaded...` | same | Pass |
| CR-1: only allow-listed addons are stubbed; others fail the build on every machine | `fails the build for an addon of a package that is not allow-listed...`, `fails the build for an unlisted addon of an allow-listed package, whether or not it was compiled`, `fails the build for an addon outside node_modules`, `fails the build for an unlisted addon given as an entry point...`, `isOptionalAddon` > `matches allow-listed packages...` | same | Pass |
| CR-2: stubs and messages are named after their package | `gives identical relative addon paths in different packages distinct stubs`, `addonLocation` tests (POSIX, Windows, innermost `node_modules`, scoped packages, invalid paths) | same | Pass |
| Only `*.node` imports are affected | `leaves package imports whose names merely contain "node" alone`, `bundles files whose names only start with or contain ".node" normally` | same | Pass |
| The stub source is safe for any path | `quotes the path safely`, `keeps Windows separators, double quotes and newlines...` | same | Pass |
| AC2: the AppImage starts and loads ssh2 | none | - | Not run by test-writer: there is no C toolchain here, and packaging is outside unit scope. The parent ran smoke-packaged and the SSH e2e test |
| AC3: the check.yml bundle job; actionlint passes | none | - | Not testable with unit tests: it is workflow YAML. The parent ran actionlint and GitHub run 44127846813 |
| AC4: `npm run check` passes | the whole suite | `npm run check` (repo root) | Pass |

## Focused test execution

Command:

`cd apps/desktop && npx vitest run src/build --coverage --coverage.include=src/build/native-addons.ts`

Result:

Pass: 1 file, 21 tests. The run before the two new tests also passed, with 19 tests.

## Full test execution

Command:

`npm run check` (repo root: eslint and prettier --check, typecheck in all workspaces, vitest, renderer `ng test`)

Result:

Pass: lint and prettier clean, typecheck clean, vitest 100 files and 5238 tests passed, renderer 125 files and 4137 tests passed. The run includes the two new tests.

## .taskcheck

Result:

Pass. `.taskcheck` runs `npm run check`, and that passed (see above). I did not run `.taskcheck` itself.

## Bugs found

None.

## Coverage

Status: verified

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured separately. `native-addons.ts` is new in this task, so whole-file coverage is also the coverage of its added lines.

Evidence:
- Task, base, HEAD and file scope:
  - Task id: `release-native-modules`.
  - Base: `f6b1b1225b680609226e3caa422fb0f5038b2e46`, supplied by the parent.
  - Measured HEAD: `bb4a42ff4cec40525760c77f80b1b579a777a8cb`, the final revision after the fixes for CR-1 and CR-2.
  - Task-owned commits: f15d3456, 9eaa96f9 and bb4a42ff, plus commits that touch only `tasks/`.
- Snapshot (sha256):
  - `native-addons.ts`: e2242cfa2b67651dfd7d1ecbf74a404ebc156f19be1a782f1e0edf748038b9ba. Committed at HEAD and unchanged during this pass.
  - `native-addons.spec.ts`: 93732fda2efe1575d444d2d03412440cfaf004dbfb21262d36b51e20d62004e6. Final and uncommitted.
- Included and excluded files:
  - Included: `apps/desktop/src/build/native-addons.ts`.
  - Excluded: `apps/desktop/scripts/build.mjs`. It registers the plugin and has comments, it is not in any Vitest include, and the parent's container `npm run dist` exercises it.
  - Excluded: `apps/desktop/electron-builder.yml` and `.github/workflows/check.yml`. They are configuration.
  - Excluded: the spec file, because it is a test.
  - No files were renamed or deleted.
- Provider, command and selection:
  - Provider: Vitest 5.1.0 with `@vitest/coverage-v8`.
  - Command: `npx vitest run src/build --coverage --coverage.include=src/build/native-addons.ts`, run in `apps/desktop`.
  - Selection: `src/build`, which is only `native-addons.spec.ts`.
- Run time and exit status: started 2026-11-17 17:55:44 +0100, took about 0.2 s, exited 0, 21/21 tests passed.
- Report paths and hashes (the directory is git-ignored):
  - `apps/desktop/coverage/coverage-summary.json`: sha256 9e0d454cc4342cca598ee92ec6c77bc4de20c56484eb3b4bdc7e8ad34c9ce454.
  - `apps/desktop/coverage/lcov.info`: sha256 45b21da10783366281fb334076474f4e5a10d5d655c1189e1c380ab512c66557.
  - `apps/desktop/coverage/lcov-report/`.
- Freshness: the outputs are fresh. All report files have mtime 2026-11-17 17:55:44, written by this run. The production file is unchanged from HEAD, and the spec hash above is the version that ran.
- Final run after the latest test additions and production fixes: yes. The run covers the CR-1/CR-2 fixes and both tests added in this pass.

Values below use covered/total (percentage).

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `apps/desktop/src/build/native-addons.ts` | 32/32 (100%) | 26/26 (100%) | 7/7 (100%) | 27/27 (100%) |

Aggregate (summed counters, one measured file): statements 32/32, branches 26/26, functions 7/7, lines 27/27. No scoped files are unmeasured. The excluded files are listed above.

Before this pass's additions, the same command reported branches 25/26 (96.15%). The uncovered branch was lcov `BRDA:100,7,1,0`.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `apps/desktop/src/build/native-addons.ts:100`, the `args.resolveDir` fallback of `args.importer \|\| args.resolveDir` (now covered) | The error for an unlisted addon names where it came from, even when there is no importer (an entry point) | Added `fails the build for an unlisted addon given as an entry point, naming the working directory` |

No lines or branches remain uncovered.

## Unable to test

- **Real compiled addons and the packaged AppImage:** I could not test with real `sshcrypto.node` and `os_dns_native.node` binaries, or with the packaged AppImage, because this machine has no C toolchain. The unit tests use fake `.node` files instead. The parent covered this in a node:24 container at bb4a42ff: DIST_EXIT=0, with stubs for ssh2 sshcrypto and for os-dns-native Release and Debug. The parent also ran smoke-packaged and the SSH e2e test. No follow-up is needed.
- **Certificate exporters:** the `'any'` allow-list entries for `win-export-certificate-and-key` and `@mongodb-js/macos-export-certificate-and-key` are tested only with fake packages. These packages are not installed locally, and their real addon names were not confirmed (see `fixes.md`). This is low risk because they load their addon through `bindings`, which builds the path at runtime.
- **`check.yml` bundle job:** only CI and actionlint can verify it. The parent recorded both.
- **Case-sensitive filter (not a defect):** the `/\.node$/` filter is case-sensitive, so an import spelled `X.NODE` would bypass the plugin. esbuild would then fail with "No loader is configured" rather than produce a broken bundle. I added no test.

## Summary

Tests added and all validation passed. Tests and task-scoped coverage are sufficient; no production defects found.

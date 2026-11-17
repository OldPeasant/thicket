# Test Report

Date: 2026-11-17

Task: release-native-modules - Release: bundle works when native modules (ssh2, os-dns-native) are compiled

Scope: task diff `f6b1b1225b680609226e3caa422fb0f5038b2e46..574bc4978e4edf895e84284e3213bf24dd5bc015` (supplied by the parent worker). Measured at HEAD `f15d3456ddc0adb51377187a8161aa15d4d88c93`; `git diff 574bc497 HEAD` touches only `tasks/` files, so the code under test is identical to the task commit. Uncommitted input: the updated spec file (this report's test changes).

Requirements:
- `tasks/release-native-modules.md` acceptance criteria and recorded assumptions (the esbuild plugin turns every `*.node` require into a stub throwing MODULE_NOT_FOUND)
- `docs/ARCHITECTURE.md` "Coverage"; `AGENTS.md` project notes (OS-neutral tests, no timing asserts)
- Parent worker instructions

## Test files changed

- `apps/desktop/src/build/native-addons.spec.ts`

## Tests added or updated

Count: 5 added (5 existing tests kept unchanged; 10 total)

- `omitNativeAddons` > stubs an addon that was never compiled (no toolchain: the file does not exist)
- `omitNativeAddons` > stubs every addon in one bundle, each failing with its own path (sshcrypto + os_dns_native layout)
- `omitNativeAddons` > also stubs an addon imported from an ES module
- `omitNativeAddons` > bundles files whose names only start with or contain ".node" normally (`helper.node.cjs`, `other.nodejs` are not stubbed)
- `omittedAddonSource` > keeps Windows separators, double quotes and newlines in the path literal

All paths are built with `path.join`, temp dirs via `os.tmpdir()`/`mkdtempSync`, no file permissions, signals or timing assumptions.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1: the bundle no longer fails with "No loader is configured for .node" when addons are compiled (unit-level part) | `without it, esbuild refuses a compiled addon...`, `bundles code that requires an addon...`, `stubs every addon in one bundle...`, `also stubs an addon imported from an ES module` | `cd apps/desktop && npx vitest run src/build` | Pass (10/10). The container `npm run dist` reproduction itself was run by the parent, not by this helper |
| AC1/assumption: builds without a toolchain behave the same (addon missing on disk) | `stubs an addon that was never compiled...` | same | Pass |
| Assumption: stub throws MODULE_NOT_FOUND so the JS fallback in try/catch runs | `bundles code that requires an addon...`, `an unguarded require of an addon throws when the module is loaded...`, `stubs every addon in one bundle...` | same | Pass |
| Only `*.node` imports are affected | `leaves package imports whose names merely contain "node" alone`, `bundles files whose names only start with or contain ".node" normally` | same | Pass |
| Stub source is safe for any path (quotes, Windows backslashes, newlines) | `quotes the path safely`, `keeps Windows separators, double quotes and newlines...` | same | Pass |
| AC2: AppImage starts / loads ssh2 | none (parent ran smoke-packaged and SSH-tunnel e2e on container builds) | - | Not run by test-writer: no C toolchain locally, packaging is outside unit scope |
| AC3: check.yml bundle job, actionlint | none | - | Not testable with unit tests (workflow YAML; parent ran actionlint) |
| AC4: `npm run check` passes | whole suite | `npm run check` (repo root) | Pass |

## Focused test execution

Command:

`cd apps/desktop && npx vitest run src/build`

Result:

Pass - 1 file, 10 tests passed.

## Full test execution

Command:

`npm run check` (repo root: eslint + prettier --check, typecheck, vitest projects, renderer `ng test`)

Result:

Pass - vitest 100 files / 5227 tests passed; renderer 125 files / 4137 tests passed. (A first run failed lint on a non-null assertion in a new test; the test was fixed and the full check rerun green.)

## .taskcheck

Result:

Pass - `.taskcheck` runs `npm run check`, which passed (see above).

## Bugs found

None.

## Coverage

Status: verified

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured separately; the only scoped file is entirely new in this task, so whole-file coverage equals coverage of its added lines.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: `release-native-modules`; base `f6b1b1225b680609226e3caa422fb0f5038b2e46`; task commit `574bc4978e4edf895e84284e3213bf24dd5bc015` (supplied by the parent); measured HEAD `f15d3456ddc0adb51377187a8161aa15d4d88c93` (differs from the task commit only in `tasks/`).
- Source/test snapshot identifier (including uncommitted inputs): sha256 `native-addons.ts` 0554792e546bcb24f534e71687a9962e5405518bc6db7831396e9c3f0b9bb129 (unchanged throughout); `native-addons.spec.ts` 30eaf6996d0194bc14f1a2fbeec064487093a9a9ae934ab467413fd25150c167 (final, uncommitted).
- Exact included files; renamed/deleted/excluded files and reasons: included `apps/desktop/src/build/native-addons.ts`. Excluded: `apps/desktop/scripts/build.mjs` (build script, not in any Vitest workspace include; its change is a one-line plugin registration, exercised by the parent's container `npm run dist` runs), `apps/desktop/electron-builder.yml` and `.github/workflows/check.yml` (configuration, no unit-testable code), `native-addons.spec.ts` (test).
- Provider/version, command, working directory, and test selection: Vitest 5.1.0 with `@vitest/coverage-v8` on Node v24.21.0; `npx vitest run src/build --coverage --coverage.include='src/build/native-addons.ts'` in `apps/desktop`; selection `src/build` (native-addons.spec.ts only).
- Run start/completion time and exit status: final run started 2026-11-17 17:48:57 +0100, completed within ~0.2 s, exit 0, 10/10 tests passed.
- Generated report paths and report hashes/run identifier: `apps/desktop/coverage/coverage-summary.json` (mtime 17:48:58, sha256 dead4727896cee6d087f131d656a2b96b8f986620f87dd025fc60a6312a9d5cf), `apps/desktop/coverage/lcov.info` (sha256 6df03613cb407dbdfe4272da6cbd5d484060e9bf7afd4ea31451333c13009cf1), `apps/desktop/coverage/lcov-report/` (git-ignored).
- Evidence outputs are fresh and inputs stayed unchanged: yes; report files rewritten by the final run (mtime after run start), production file hash identical before and after.
- Final run after latest test additions and production fixes: yes (no production fixes were made).

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `apps/desktop/src/build/native-addons.ts` | 8/8 (100%) | 0/0 (N/A) | 4/4 (100%) | 6/6 (100%) |

Aggregate (summed counters, single measured file): statements 8/8, branches N/A (0/0), functions 4/4, lines 6/6. Unmeasured scoped files: none; excluded files listed above.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| none | - | - |

## Unable to test

- Behavior with real compiled addons (actual `sshcrypto.node` / `os_dns_native.node` binaries) and the packaged AppImage: the local machine has no C toolchain; the unit tests use fake `.node` files instead. The parent covered this in a node:24 container (AC1, AC2). No follow-up needed beyond the parent's evidence.
- `check.yml` `bundle` job: only verifiable by CI/actionlint (parent ran actionlint). The job's first real run on a push is the definitive evidence.
- Note (not a defect): the filter `/\.node$/` is case-sensitive, so an import spelled `X.NODE` would not be stubbed; no addon in the dependency tree uses that spelling, so no test was added.

## Summary

Tests added and all validation passed. Tests and task-scoped coverage are sufficient; no production defects found.

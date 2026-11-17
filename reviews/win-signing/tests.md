# Test Report

Date: 2026-11-17

Task: win-signing - Release: sign Windows builds with SignPath

Scope: `git diff fbb8c3a55cec8c348d1614dd740a7183b8c6c19c..2758fbf22444a2381f1065d5800d7045c8dc79df` (task commits e54a194c, f98e6a53, 1e19e7c2, 2758fbf2, as supplied by the parent worker and confirmed by `git log fbb8c3a5..HEAD`; branch main, HEAD 2758fbf2). This is the second round. It covers the final revision after the fixes in `reviews/win-signing/fixes.md` (CR-1: `build` job permissions `contents: read` + `actions: read`; CR-3: the `--prepackaged` step runs `npx electron-builder` in `apps/desktop` instead of `npm run dist`; CR-4: docs wrap). The working tree was clean at measurement time apart from this report.

Requirements:
- `tasks/win-signing.md` acceptance criteria and notes (assumptions on slugs, action inputs, 150 min timeout)
- `SPEC.md` (Release), `docs/ARCHITECTURE.md` ("Coverage", packaging notes), `AGENTS.md`
- `docs/CODE_SIGNING.md` as the documented contract between workflow and SignPath setup
- `reviews/win-signing/review.md` findings CR-1, CR-3 (behaviour changed by the fixes)

## Test files changed

Round 1 (commit 1e19e7c2):
- `apps/desktop/src/release-workflow.spec.ts` (new)
- `apps/desktop/src/release-signing.spec.ts` (3 tests added, existing 5 unchanged)

Fixer (commit 2758fbf2), reviewed in this round:
- `apps/desktop/src/release-workflow.spec.ts`: 1 test added (build job permissions); the fake `npm` became a fake `npm`/`npx` that records the command name; the step runner uses the step's `working-directory`; the `--prepackaged` tests now expect the direct `npx electron-builder` call in `apps/desktop`.

Round 2 (this report): no test changes. The final code is already covered (see "Review of the fixes").

## Tests added or updated

Count: 0 in this round. The totals across the task are 26 tests (23 in `release-workflow.spec.ts`, 3 in `release-signing.spec.ts`), plus 2 tests that the fixer adjusted.

YAML parsing: `release-workflow.spec.ts` parses `.github/workflows/release.yml` with `getConfig` from `app-builder-lib/out/util/config/load.js` (js-yaml under the hood). `app-builder-lib` is a dependency of the declared `electron-builder` devDependency, and `packaging.spec.ts` already deep-imports it, so no undeclared package is introduced.

The `run:` scripts tests take each step's script out of the parsed workflow, write it to a temp file and run it in the step's `working-directory` with `bash --noprofile --norc -eo pipefail` (GitHub's `shell: bash`). Fake `npm` and `npx` binaries on `PATH` record the command name, then each argument as an `[arg]` line, so empty arguments would show up. Files are fictitious and live in temp dirs. These tests use `describe.skipIf(process.platform === 'win32')`, because on Windows `bash` may resolve to WSL and the scripts need `sha256sum`. They run on Linux and macOS (`check (ubuntu-latest)`, `check (macos-latest)`; macOS uses bash 3.2, the same shell as the release workflow's mac build).

## Review of the fixes

| Fix | Test that covers the final code | Assessment |
|---|---|---|
| CR-1 `build` job `permissions: { contents: read, actions: read }` | `lets the build job token read the uploaded artifacts for SignPath, nothing more` (exact `toEqual`, so a missing `contents: read` or an extra scope fails) | Sufficient |
| CR-3 `--prepackaged` step: `working-directory: apps/desktop`, `npx electron-builder --config electron-builder.yml --publish never $ARGS --prepackaged release/win-signed -c.extraMetadata.version=<tag>` | `builds the installer and zip from the signed folder with the tag version, without rebuilding` (runs the script under bash in `apps/desktop`; asserts the exact `npx` argv, so `npm`/a renderer rebuild would fail; checks that the `dist` script still uses the same `--config electron-builder.yml --publish never` options); `builds the installer from the folder SignPath writes the signed app to` (`working-directory` + `--prepackaged` path resolves to the SignPath `output-artifact-directory`) | Sufficient |
| CR-3 `$ARGS` word splitting and the line continuation (`\`) in the new command | Same bash test: `ARGS='--win --x64'` must become two separate arguments, and the continued line must still yield one command | Sufficient |
| CR-4 docs wrap | Prettier in `npm run check` | No behaviour to test |

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 Workflow validates locally (actionlint) | Not re-run by test-writer (the parent and the fixer ran actionlint via podman with 0 findings, `fixes.md`). Structural checks in `release.yml: Windows signing steps` | `cd apps/desktop && npx vitest run src/release-signing.spec.ts src/release-workflow.spec.ts` | Pass (structure); actionlint: Not run here, parent/fixer evidence |
| AC2 Without the secret: unsigned build, signing skipped and logged | `signpath-enabled.mjs` › skips signing and says so (4 cases), appends to GITHUB_OUTPUT, never prints the token, runs without GITHUB_OUTPUT; `gates every signing step on the signing check, and nothing else`; `keeps the unsigned path: the same ungated steps, in the same order`; `Build installers` › builds the installers as before signing on Linux/macOS (no output) / Windows `false` / empty output; `decides about signing only on Windows, from the SignPath secret and variable` | same | Pass |
| AC2 With the secret: signing path wired correctly | `builds only the unpacked app when signing`; `signs in order: ...`; `sends the uploaded artifacts to SignPath with the documented slugs`; `builds the installer from the folder SignPath writes the signed app to`; `builds the installer and zip from the signed folder with the tag version, without rebuilding`; `gives the Windows job enough time for both SignPath approvals`; `lets the build job token read the uploaded artifacts for SignPath, nothing more`; `passes the SignPath token only to the signing check and the SignPath action` | same | Pass |
| AC3 Same artefact names; SHA256SUMS after signing | `Use signed installer` › replaces the unsigned installer; collect and checksums then use the signed bytes (end-to-end over Use signed installer → Collect installers → Checksums scripts); fails when no / more than one / differently named signed installer; `collects the same file names on an unsigned Windows build`; `collects the same installer types as before`; `computes SHA256SUMS.txt in the release job, after downloading the (signed) build artifacts`; the `--prepackaged` step uses the same electron-builder config as `dist` (same `artifactName`); existing `packaging.spec.ts` artifactName check | same | Pass |
| AC4 CODE_SIGNING.md policy + setup; README attribution + SmartScreen note | `documents every SignPath slug, the secret and the variable the workflow uses`; `has the code signing policy sections and the attribution in README and policy` (the SmartScreen wording itself was reviewed by reading, not asserted) | same | Pass |
| AC5 Real signed release | Not testable here (needs the SignPath org, approval and a Windows runner; task `signpath-setup`) | - | Not testable |

## Focused test execution

Command:

`cd apps/desktop && npx vitest run src/release-signing.spec.ts src/release-workflow.spec.ts`

Result:

Pass: 2 files, 31 tests (8 signing-gate tests, 23 workflow tests); run at 06:36:40 local on HEAD 2758fbf2.

## Full test execution

Command:

`npm run check` (repo root: `npm run lint && npm run typecheck && npm run test`)

Result:

Pass, exit status 0. The command ran without a pipe, and the tool reported no nonzero exit. Separately, `echo $?` capture was refused by the sandbox. Output: eslint with `--max-warnings 0` passed, and Prettier reported "All matched files use Prettier code style!". Typecheck passed for the root and every workspace. Root vitest: 86 files, 4448 tests passed. Renderer `ng test`: 102 files, 3355 tests passed (run started 06:38:16 local). An earlier piped run at 06:37:14 gave the same counts.

## .taskcheck

Result:

Not run separately. `.taskcheck` runs exactly `npm run check` when `package.json` exists, and that command passed with exit 0 (see above).

## Bugs found

None. The tests found no production defect in the final revision.

The round 1 open risk (token permissions for the SignPath action) is now handled in the workflow (CR-1) and asserted by a test. Whether `actions: read` is sufficient and needed can still only be confirmed against the action's documentation or a real signed run (`signpath-setup`).

## Coverage

Status: unavailable. The only instrumentable production code in scope, `apps/desktop/scripts/signpath-enabled.mjs`, is unchanged since round 1 (same sha256). It sits outside the Vitest coverage `include` (`src/**/*.ts`, `vitest.shared.ts`), and the tests run it in a child process, which the V8 provider does not instrument. Workflow YAML and Markdown are not instrumentable. The fixes in 2758fbf2 touched only the workflow, docs and tests.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured (no instrumentable changed lines in reach of the provider).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: win-signing; base fbb8c3a55cec8c348d1614dd740a7183b8c6c19c; HEAD 2758fbf22444a2381f1065d5800d7045c8dc79df; commits e54a194c, f98e6a53, 1e19e7c2, 2758fbf2 (named by the parent, confirmed by `git log fbb8c3a5..HEAD`).
- Source/test snapshot identifier (including uncommitted inputs): clean tree at HEAD 2758fbf2. sha256 `release.yml` ccb6bb8c…ca70, `signpath-enabled.mjs` b4b83c6f…1682 (unchanged from round 1), `release-workflow.spec.ts` e6ce3bb6…7f02, `release-signing.spec.ts` c83f97bc…a6af.
- Exact included files; renamed/deleted/excluded files and reasons: in scope `apps/desktop/scripts/signpath-enabled.mjs` (measured, no usable data, see below). Excluded: `.github/workflows/release.yml` (YAML/shell, not instrumentable; covered behaviourally by the static and bash tests), `docs/CODE_SIGNING.md`, `README.md`, `docs/user/install.md`, `docs/ARCHITECTURE.md` (documentation), the spec files (tests), `reviews/win-signing/*` (reports). No renames or deletions.
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8` with vitest 5.1.0. Command: `npx vitest run src/release-signing.spec.ts src/release-workflow.spec.ts --coverage --coverage.include='scripts/signpath-enabled.mjs' --coverage.reporter=text --coverage.reporter=json-summary` in `apps/desktop`.
- Run start/completion time and exit status: started 2026-11-17 06:36:43 local; 31 tests passed; exit 0.
- Generated report paths and report hashes/run identifier: `apps/desktop/coverage/coverage-summary.json` (git-ignored), sha256 7c262afa…907c.
- Evidence outputs are fresh and inputs stayed unchanged: yes. The run was at HEAD with no source or test edits afterwards, and the hashes above were taken right after it.
- Final run after latest test additions and production fixes: yes (after 2758fbf2; this round added no tests).

Values below use covered/total (percentage).

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `apps/desktop/scripts/signpath-enabled.mjs` | 0/10 (0%), not meaningful: child process not instrumented | 0/6 (0%), same | 0/2 (0%), same | 0/9 (0%), same |

No aggregate is reported: the only measured file has no usable data.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `apps/desktop/scripts/signpath-enabled.mjs`: lines 9-27 (reported 0% only because it runs in a child process) | Signing gate (AC2) | Reading the code against the tests, every branch runs: both set → enabled; each one missing, both missing, empty and whitespace-only → disabled with a notice; `GITHUB_OUTPUT` set (fresh and pre-filled) and unset. Measuring it would need child-process V8 coverage, which the existing setup lacks. |
| `.github/workflows/release.yml` signing steps, including the 2758fbf2 changes (job permissions, `working-directory` + `npx electron-builder`) | AC2, AC3 | Not instrumentable. Static structure tests cover them, and so do runs of the `Build installers`, `Build installer and zip from the signed app`, `Use signed installer`, `Collect installers` and `Checksums` scripts under bash with fictitious files. The SignPath action and `upload-artifact` steps cannot run here. |

## Unable to test

- The real SignPath round trip: approvals, signature validity, the `actions: read` sufficiency, and the `--prepackaged` NSIS output on Windows (AC5). These need the SignPath org, the secrets and a Windows runner, so the follow-up is the `signpath-setup` task.
- Whether `npx electron-builder` resolves to the workspace-installed binary on the Windows runner. Locally it resolves through the hoisted `node_modules/.bin`, which is the same layout `npm ci` produces in CI. A real run is still the only proof.
- A GitHub Actions execution of the `if:` expressions (`act` is not installed). The tests check the expression text and the step order, not GitHub's evaluator.
- The bash scripts on Windows Git Bash: skipped on win32 in the spec (reason above).
- actionlint was not re-run by the test-writer; the fixer's run on 2758fbf2 is the evidence.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. The fixer's test changes cover the final code (job permissions and the `npx electron-builder --prepackaged` step in `apps/desktop`), so this round needed no new tests. Focused tests passed (31/31), and `npm run check` passed with exit 0. Coverage measurement is still unavailable for the unchanged `.mjs` gate script (outside the coverage include and run in a child process). Its behaviour is covered by the gate-script tests.

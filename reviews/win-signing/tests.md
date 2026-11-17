# Test Report

Date: 2026-11-17

Task: win-signing - Release: sign Windows builds with SignPath

Scope: `git diff fbb8c3a55cec8c348d1614dd740a7183b8c6c19c..f98e6a53a560377918369256d0cb9c28ee2489ec` (task commits e54a194c, f98e6a53, as supplied by the parent worker; branch main, HEAD f98e6a53, base fbb8c3a5). Uncommitted at measurement time: only the test changes listed below (and this report; `reviews/win-signing/review.md` from the code-reviewer was already present).

Requirements:
- `tasks/win-signing.md` acceptance criteria and notes (assumptions on slugs, action inputs, 150 min timeout)
- `SPEC.md` (Release), `docs/ARCHITECTURE.md` ("Coverage", packaging notes), `AGENTS.md`
- `docs/CODE_SIGNING.md` as the documented contract between workflow and SignPath setup

## Test files changed

- `apps/desktop/src/release-workflow.spec.ts` (new)
- `apps/desktop/src/release-signing.spec.ts` (3 tests added, existing 5 unchanged)

## Tests added or updated

Count: 25 (22 in `release-workflow.spec.ts`, 3 in `release-signing.spec.ts`)

YAML parsing: `release-workflow.spec.ts` parses `.github/workflows/release.yml` with `getConfig` from `app-builder-lib/out/util/config/load.js` (js-yaml under the hood). `app-builder-lib` is a dependency of the declared `electron-builder` devDependency and `packaging.spec.ts` already deep-imports it, so no undeclared package (such as `yaml`) is introduced. If electron-builder ever moves that module, only the `beforeAll` loader needs to change.

The `run:` scripts tests take each step's script out of the parsed workflow, write it to a temp file and run it with `bash --noprofile --norc -eo pipefail` (GitHub's `shell: bash`). A fake `npm` on `PATH` records its arguments as `[arg]` lines, so empty arguments would show up. Files are fictitious and live in temp dirs. These tests use `describe.skipIf(process.platform === 'win32')`. On a Windows dev machine or the Windows `check` CI job, `bash` may resolve to WSL rather than Git Bash, and the scripts need `sha256sum`. They run on Linux and macOS, so `check (ubuntu-latest)` and `check (macos-latest)` exercise them. That macOS run uses Apple's bash 3.2, the same shell the release workflow's mac build uses.

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| AC1 Workflow validates locally (actionlint) | Not re-run by test-writer (parent ran actionlint via podman, 0 errors). Structural checks in `release.yml: Windows signing steps` | `cd apps/desktop && npx vitest run src/release-signing.spec.ts src/release-workflow.spec.ts` | Pass (structure); actionlint: Not run here, parent evidence |
| AC2 Without the secret: unsigned build, signing skipped and logged | `signpath-enabled.mjs` › skips signing and says so (4 cases), appends to GITHUB_OUTPUT, never prints the token, runs without GITHUB_OUTPUT; `gates every signing step on the signing check, and nothing else`; `keeps the unsigned path: the same ungated steps, in the same order`; `Build installers` › builds the installers as before signing on Linux/macOS (no output) / Windows `false` / empty output; `decides about signing only on Windows, from the SignPath secret and variable` | same | Pass |
| AC2 With the secret: signing path wired correctly | `builds only the unpacked app when signing`; `signs in order: ...`; `sends the uploaded artifacts to SignPath with the documented slugs`; `builds the installer from the folder SignPath writes the signed app to`; `builds the installer and zip from the signed folder with the tag version`; `gives the Windows job enough time for both SignPath approvals`; `passes the SignPath token only to the signing check and the SignPath action` | same | Pass |
| AC3 Same artefact names; SHA256SUMS after signing | `Use signed installer` › replaces the unsigned installer; collect and checksums then use the signed bytes (end-to-end over Use signed installer → Collect installers → Checksums scripts); fails when no / more than one / differently named signed installer; `collects the same file names on an unsigned Windows build`; `collects the same installer types as before`; `computes SHA256SUMS.txt in the release job, after downloading the (signed) build artifacts`; existing `packaging.spec.ts` artifactName check | same | Pass |
| AC4 CODE_SIGNING.md policy + setup; README attribution + SmartScreen note | `documents every SignPath slug, the secret and the variable the workflow uses`; `has the code signing policy sections and the attribution in README and policy` (SmartScreen wording itself reviewed by reading, not asserted) | same | Pass |
| AC5 Real signed release | Not testable here (needs SignPath org, approval, Windows runner; task `signpath-setup`) | - | Not testable |

## Focused test execution

Command:

`cd apps/desktop && npx vitest run src/release-signing.spec.ts src/release-workflow.spec.ts`

Result:

Pass: 2 files, 30 tests (8 signing-gate tests, 22 workflow tests). Also run: `npx eslint` and `npx prettier --check` on both spec files, and `npx tsc -p tsconfig.json` in apps/desktop. All three are clean.

## Full test execution

Command:

`npm run check` (repo root: lint, typecheck, vitest, renderer `ng test`)

Result:

Pass: root vitest 86 files, 4447 tests passed; renderer 102 files, 3355 tests passed. The `&&` chain reached and finished the last stage, so lint and typecheck passed too.

## .taskcheck

Result:

Not run separately. Running `bash .taskcheck` was refused by the sandbox permission. `.taskcheck` runs exactly `npm run check` when `package.json` exists, and that command passed (see above).

## Bugs found

None. The tests found no production defect.

One unverified risk for the parent and the `signpath-setup` follow-up (no test, no Bugs-found entry, because the requirement source can't be read here without web access): the workflow-level `permissions: contents: read` also applies to the `build` job. The SignPath action passes the job's `GITHUB_TOKEN` to SignPath so that SignPath can fetch the uploaded artifact (`github-artifact-id`). If the SignPath docs require `actions: read` on that token, the first signed run will fail at "Sign app (SignPath)". Check this against the action README during `signpath-setup`. The unsigned path is not affected.

## Coverage

Status: unavailable. The only production code in scope is `apps/desktop/scripts/signpath-enabled.mjs`. It sits outside the Vitest coverage `include` (`src/**/*.ts`, `vitest.shared.ts`), and the tests run it in a child process, which the V8 provider does not instrument. Workflow YAML and Markdown are not instrumentable.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured (no instrumentable changed lines in reach of the provider).

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: win-signing; base fbb8c3a55cec8c348d1614dd740a7183b8c6c19c; HEAD f98e6a53a560377918369256d0cb9c28ee2489ec; commits e54a194c, f98e6a53 named by the parent and confirmed by `git log fbb8c3a5..HEAD`.
- Source/test snapshot identifier (including uncommitted inputs): sha256 `release.yml` dc3c0e69…d6f1, `signpath-enabled.mjs` b4b83c6f…1682, `release-workflow.spec.ts` 9af93a45…85b7, `release-signing.spec.ts` c83f97bc…a6af.
- Exact included files; renamed/deleted/excluded files and reasons: in scope `apps/desktop/scripts/signpath-enabled.mjs` (measured, no data, see below). Excluded: `.github/workflows/release.yml` (YAML/shell, not instrumentable; covered behaviourally by the static and bash tests), `docs/CODE_SIGNING.md`, `README.md`, `docs/user/install.md`, `docs/ARCHITECTURE.md` (documentation), `apps/desktop/src/release-signing.spec.ts` (test).
- Provider/version, command, working directory, and test selection: `@vitest/coverage-v8` with vitest 5.1.0; `npx vitest run src/release-signing.spec.ts src/release-workflow.spec.ts --coverage --coverage.include='scripts/signpath-enabled.mjs'` in `apps/desktop`.
- Run start/completion time and exit status: 2026-11-17 06:32:46 local; 30 tests passed; exit 0.
- Generated report paths and report hashes/run identifier: `apps/desktop/coverage/` (git-ignored, default reports directory); text summary only recorded here.
- Evidence outputs are fresh and inputs stayed unchanged: yes. The run came after the last test edit, and the hashes above were taken after it.
- Final run after latest test additions and production fixes: yes (no production fixes were made).

Values below use covered/total (percentage).

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `apps/desktop/scripts/signpath-enabled.mjs` | 0/10 (0%), not meaningful: child process not instrumented | 0/6 (0%), same | 0/2 (0%), same | 0/9 (0%), same |

No aggregate is reported: the only measured file has no usable data.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `apps/desktop/scripts/signpath-enabled.mjs`: whole file (reported 0% only because it runs in a child process) | Signing gate (AC2) | Reading the code against the tests, every branch runs: both set → enabled; each one missing, both missing, empty and whitespace-only → disabled with a notice; `GITHUB_OUTPUT` set (fresh and pre-filled) and unset. Measuring it needs the child-process V8 coverage that the existing setup lacks. |
| `.github/workflows/release.yml` signing steps | AC2, AC3 | Not instrumentable. Covered by static structure tests, and by running the `Build installers`, `Build installer and zip from the signed app`, `Use signed installer`, `Collect installers` and `Checksums` scripts under bash with fictitious files. The SignPath action and `upload-artifact` steps themselves cannot run here. |

## Unable to test

- The real SignPath round trip, approvals, signature validity and `--prepackaged` NSIS output on Windows (AC5). They need the SignPath org, secrets and a Windows runner, so the follow-up is the `signpath-setup` task. The parent's Linux `--prepackaged` zip check (hash of the modified `Thicket.exe` preserved) is the closest local evidence.
- A GitHub Actions execution of the `if:` expressions (`act` is not installed). The tests check the expression text and step order, not GitHub's evaluator.
- The bash scripts on Windows Git Bash: skipped on win32 in the spec (reason above). On the Windows runner they also run in Git Bash, so a Windows-only shell difference would only show up in a real release run.
- Whether the SignPath action needs `actions: read` (see the risk under Bugs found). Needs the action's documentation, so it is a follow-up for `signpath-setup` or the parent.

## Summary

Tests and task-scoped coverage are sufficient; no production defects found. The coverage measurement itself is unavailable for the `.mjs` gate script (outside the coverage include and run in a child process). The behaviour is covered through the gate script, workflow structure and workflow-script tests above. One unverified risk (token permissions for SignPath) is passed to the parent.

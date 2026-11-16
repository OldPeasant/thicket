# Test Report

Date: 2026-11-16

Task: release-ci - Release: GitHub Actions builds installers on tag

Scope: base 73fefff6facf6fd3dec757ea916fdc29ed5fb536 .. 9ce41d1552e47fef674dcc10ace9d8df9e7a930e (branch main, HEAD = 9ce41d1, working tree clean before this report). Task ownership comes from the parent: the only task commit is 9ce41d1, and it adds only `.github/workflows/release.yml` (sha256 83ec1620ea436bcb5aaf7eeee19ba4c742d60c114065d650404bc7e129f31ffb). Commit 73fefff is the claim commit (task metadata) and is excluded. No TypeScript or other production source changed.

Requirements:
- `tasks/release-ci.md` acceptance criteria 1-2 and goal
- `SPEC.md` section 3 "Release": AppImage, deb, rpm (Linux x64/arm64), dmg (macOS arm64 and x64), NSIS installer and portable zip (Windows x64), uploaded to a GitHub release with checksums, unsigned
- `apps/desktop/electron-builder.yml` (targets, arches, `artifactName`, mac ad-hoc signing), `apps/desktop/package.json` `dist` script
- `AGENTS.md` (Evidence, quality gate), `docs/QUALITY.md` (report contract), `docs/ARCHITECTURE.md` "Coverage"
- Parent instructions: decide whether a project test fits the conventions; coverage of YAML is not measurable; report workflow bugs instead of editing

## Test files changed

- None. Only this report (`reviews/release-ci/tests.md`) was written.

## Tests added or updated

Count: 0

Reason, with the conventions checked:
- No workspace declares a YAML parser. `yaml` and `js-yaml` exist in `node_modules` only as transitive dependencies (vite, app-builder-lib, ...). A Vitest spec that imports them would depend on an undeclared package, and adding a dependency is outside this sub-agent's authority.
- The earlier workflow task (`reviews/ci-check/tests.md`) decided against string-match or re-parse tests of workflow files. They repeat the file's content, break on harmless edits and do not prove that GitHub runs the workflow. This task follows that convention.
- What such a test would check is already covered elsewhere. The SPEC target/arch matrix lives in `apps/desktop/electron-builder.yml`, which `apps/desktop/src/packaging.spec.ts` already validates with electron-builder's own loader. The workflow only selects the platform/arch per runner. Schema and shell correctness are covered by actionlint with shellcheck (criterion 1).

## Requirement coverage

| Requirement | Tests | Command | Result |
|---|---|---|---|
| 1. Workflow validates locally (actionlint) | actionlint 1.7.12 with shellcheck | `podman run --rm -v /home/felix/work/thicket-agents/agent-1:/repo:ro,Z --workdir /repo docker.io/rhysd/actionlint:latest -no-color` (run by the parent on 9ce41d1) | Pass, cited from the parent and not re-run here: 0 errors. Supporting check run here: `npx prettier --check .github/workflows/release.yml` passed, and `python3 -I` with PyYAML `safe_load` parsed the file (see Focused test execution). |
| SPEC: the matrix covers all targets and arches | Structural inspection of the parsed workflow plus `electron-builder.yml` | `python3 -I -c "import yaml,sys; d=yaml.safe_load(open(sys.argv[1])); ..." .github/workflows/release.yml` | Pass (static). linux-x64 `--linux --x64` on ubuntu-latest and linux-arm64 `--linux --arm64` on ubuntu-24.04-arm build the `linux.target` [AppImage, deb, rpm]. mac `--mac` on macos-latest takes the arches from `mac.target` dmg [arm64, x64]. win-x64 `--win --x64` builds nsis x64 and zip x64. `artifactName` `thicket-${version}-${os}-${arch}.${ext}` keeps the names unique across the matrix, so `merge-multiple: true` cannot overwrite a file. |
| SPEC: unsigned; mac ad-hoc signing keeps working with `CSC_IDENTITY_AUTO_DISCOVERY=false` | Source reading of app-builder-lib 26.18 | `grep`/read of `node_modules/app-builder-lib/out/mac/MacTargetHelper.js:20-50`, `codeSign/macCodeSign.js:21-41,263-280` | Pass (static). With `identity: '-'` the qualifier is non-empty, so auto-discovery is not used, the lookup returns null and line 37 creates the ad-hoc `-` identity. `isSignAllowed` depends only on darwin and pull-request status, not on that flag. |
| SPEC: checksums uploaded with the installers | Structural inspection | same python command | Pass (static). The release job runs `sha256sum -- * > SHA256SUMS.txt` in `out/` after download-artifact. The `*` glob is expanded before the redirect creates the file, so the file does not list itself. `gh release upload --clobber -- *` uploads it with the installers. |
| Goal: draft release, re-runnable | Structural inspection | same python command | Pass (static). `gh release create --draft --verify-tag` runs only when `gh release view` fails; re-runs upload with `--clobber`. `contents: write` is granted only to the release job. Behavior on GitHub is not observable here. |
| Collect step only picks installers, fails on none | Source reading (shellcheck-clean per actionlint) | none executed (see Unable to test) | Not run. Static reading: `shopt -s nullglob` plus brace/glob `*.{AppImage,deb,rpm,dmg,exe,zip}` matches only top-level installers. It excludes `*.blockmap`, `latest*.yml` and `*-unpacked/`. The NSIS `__uninstaller.exe` is deleted by electron-builder after the build (`NsisTarget.js:409`). An empty match exits 1. Local evidence from the parent's run: `apps/desktop/release/` holds `thicket-0.1.0-test-linux-x86_64.AppImage`, `thicket-0.1.0-test-linux-amd64.deb`, `builder-debug.yml` and `linux-unpacked/`, which matches these assumptions. |
| 2. A test tag produces all artefacts in a draft release | Real GitHub run | none | Not run: needs a tag push to the GitHub repo, which agents may not do. The parent records it as skipped. |

## Focused test execution

Command:

`python3 -I -c "import yaml,sys; d=yaml.safe_load(open(sys.argv[1])); b=d['jobs']['build']; r=d['jobs']['release']; ..." .github/workflows/release.yml` (prints trigger, permissions, matrix and steps), plus `npx prettier --check .github/workflows/release.yml`

Result:

Pass. Trigger `{'push': {'tags': ['v*']}}`. Workflow permissions `contents: read`, release job `contents: write`, `needs: build`. Matrix: linux-x64 / ubuntu-latest / `--linux --x64`; linux-arm64 / ubuntu-24.04-arm / `--linux --arm64`; mac / macos-latest / `--mac`; win-x64 / windows-latest / `--win --x64`. Build steps: autocrlf, checkout@v5, setup-node@v5, rpm tooling (Linux only), npm ci, build, collect, upload-artifact@v4. Release steps: download-artifact@v5, Checksums, Upload to draft release. Prettier: all matched files use Prettier code style.

## Full test execution

Command:

`npm run check` (lint, typecheck, test), in /home/felix/work/thicket-agents/agent-1 at HEAD 9ce41d1

Result:

Pass. ESLint and `prettier --check .` passed (Prettier covers `.github/`). Typecheck passed for the root and all workspaces. Root Vitest: 37 files, 2317 tests passed. `packages/renderer` `ng test`: 27 files, 437 tests passed.

## .taskcheck

Result:

Pass, by equivalence. `.taskcheck` is `if [ -f package.json ]; then npm run check; else python3 tasks.py check; fi`. `package.json` exists, and `npm run check` passed above. `bash .taskcheck` was not invoked directly. `tasks.py done` runs it again.

## Bugs found

None. Observations, not defects (for the parent and reviewer to weigh):
- A prerelease tag (for example `v0.2.0-beta.1`) produces a normal draft and is not marked `--prerelease`. A human publishes drafts, so they can set that flag.
- A `v*` tag that is not semver (for example `vnext`) makes electron-builder fail on the version. The build fails loudly and publishes nothing.
- `ubuntu-24.04-arm` runners are free for public repositories. If the repository is private, the arm64 job depends on the plan. This could not be checked here.

## Coverage

Status: not applicable. The task changes no file that the project's coverage tool can instrument.

Metric: whole-file coverage of task-changed production files.
Changed-line coverage: not measured, for the same reason.

Evidence:
- Task id, immutable base, measured HEAD, and task-owned commits/file-scope source: release-ci; base 73fefff6facf6fd3dec757ea916fdc29ed5fb536; HEAD 9ce41d1552e47fef674dcc10ace9d8df9e7a930e; the task-owned commit (9ce41d1) and file were given by the parent and confirmed with `git show --stat 9ce41d1` (1 file, +129).
- Source/test snapshot identifier (including uncommitted inputs): `.github/workflows/release.yml` sha256 83ec1620ea436bcb5aaf7eeee19ba4c742d60c114065d650404bc7e129f31ffb; `git status --short` was empty before this report; no uncommitted inputs.
- Exact included files; renamed/deleted/excluded files and reasons: none included. `.github/workflows/release.yml` is excluded because it is a GitHub Actions YAML workflow run by GitHub's runner, not TypeScript. `@vitest/coverage-v8` (docs/ARCHITECTURE.md "Coverage") instruments only JS/TS modules loaded by Vitest, so it cannot measure this file. No renames or deletions.
- Provider/version, command, working directory, and test selection: no coverage run, because the scope is empty for this provider.
- Run start/completion time and exit status: N/A, no coverage run.
- Generated report paths and report hashes/run identifier: N/A, no coverage output was produced or reused.
- Evidence outputs are fresh and inputs stayed unchanged: the workflow hash above was taken at 2026-11-16T19:48:12Z before `npm run check`; no source or test files were changed by this sub-agent.
- Final run after latest test additions and production fixes: yes for `npm run check` on 9ce41d1. No tests were added and no fixes exist yet. If the workflow changes after review, this report is stale.

Values below use covered/total (percentage); zero-denominator or unsupported metrics are N/A.

| Changed file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `.github/workflows/release.yml` (not instrumentable) | N/A | N/A | N/A | N/A |

Aggregate: N/A. No production file in scope can be measured, and this is not reported as 100%.

| File and uncovered lines/branch locations | Required behavior or risk | Action/test added or reason left uncovered |
|---|---|---|
| `.github/workflows/release.yml` (whole file) | Tag-triggered build of all SPEC installers, checksums, draft release | Validated statically (actionlint plus shellcheck from the parent, YAML parse, source reading). The runtime path needs a real tag on GitHub (criterion 2), which agents cannot do. |

## Unable to test

- Criterion 2 (a test tag produces a draft release with all artefacts) needs a tag push to the GitHub remote. Follow-up: a human pushes a test tag and checks the draft (8 installers: Linux AppImage/deb/rpm x2 arches, 2 dmg, exe, zip, plus `SHA256SUMS.txt`).
- Running the `Collect installers` and `Checksums` shell bodies against fake files in a scratch directory was planned. This sub-agent's sandbox denied both writing to `/tmp` and running the inline bash, so the snippets were not executed. They are covered by actionlint's shellcheck pass and the static reading above. Follow-up: optional. The first real tag run exercises them.
- macOS and Windows builds and the arm64 Linux build were not run (no such hosts here). The parent built Linux x64 AppImage and deb locally. rpm failed only because `rpmbuild` is missing locally; the workflow installs `rpm` on Linux runners.

## Summary

No additional tests were necessary for the reviewed scope. The change is a GitHub Actions workflow. A Vitest test of it would need an undeclared YAML dependency and would repeat what actionlint and `packaging.spec.ts` already cover. Static checks and `npm run check` passed, and no workflow defects were found. Criterion 2 remains unverifiable without a tag push.

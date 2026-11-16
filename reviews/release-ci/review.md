# Code Review

Date: 2026-11-16

Task: release-ci - Release: GitHub Actions builds installers on tag

Scope: The task's code change, `.github/workflows/release.yml`. It was added in commit 9ce41d1 on base 73fefff and rebased to 9236e90 with the same content (`git diff 9ce41d1 9236e90 -- .github/` is empty). The other commits in 73fefff..HEAD change only `tasks/*.md` (task state for release-ci and other tasks) and were not reviewed.

Requirements:
- tasks/release-ci.md (goal and acceptance criteria)
- SPEC.md section "Release (alongside the milestones)"
- docs/ARCHITECTURE.md packaging notes and the per-OS prerequisites table
- AGENTS.md (Evidence, Quality gate)
- docs/QUALITY.md (report contract)
- apps/desktop/electron-builder.yml, the `dist` script in apps/desktop/package.json, and .github/workflows/check.yml for conventions
- Installed electron-builder / app-builder-lib 26.18.0 sources in node_modules, read to confirm tool behavior

Git range:
- Branch: main
- HEAD: 9236e90a2fea438afecbf6b1aec405c0ff15b8ad
- Base/start: 73fefff6facf6fd3dec757ea916fdc29ed5fb536
- Commits reviewed: 1 (9236e90, the rebased 9ce41d1); the other commits in the range change only task files
- Uncommitted changes: none at review start

Summary: 0 P0, 0 P1, 0 P2, 1 P3

## Verification notes (no findings)

- **Artefact coverage.** The workflow builds every artefact the task and SPEC require:
  - linux-x64 (ubuntu-latest) and linux-arm64 (ubuntu-24.04-arm) each build AppImage, deb and rpm from `linux.target`.
  - The mac job (macos-latest, Apple Silicon) builds dmg for arm64 and x64 from `mac.target[0].arch`.
  - win-x64 builds NSIS and zip for x64 from `win.target`.
  - The collect glob `*.{AppImage,deb,rpm,dmg,exe,zip}` matches all of them. It skips `*.blockmap`, `latest*.yml` and `builder-debug.yml`, which the release does not need.
  - The NSIS intermediate uninstaller is written to the output folder, but NsisTarget.js:409 deletes it, so it never reaches the release.
- **Name collisions.** `artifactName: thicket-${version}-${os}-${arch}.${ext}` includes the OS and the architecture, so the files from different jobs have different names when `merge-multiple: true` puts them in one folder. The upload-artifact names (`installers-${{ matrix.name }}`) are also unique.
- **Version.** On rpm/arm64, fpm uses its own arm64 build (toolsets/linux.js:75-77), so the arm64 job can build deb and rpm. `rpm` is installed with apt for rpmbuild, as docs/ARCHITECTURE.md requires.
- **Arguments through npm.** npm adds the arguments after `--` to the end of the `dist` script, which is after `electron-builder ... --publish never`. The version override therefore reaches electron-builder. The parent's local Linux run, which produced files named 0.1.0-test, confirms this.
- **macOS signing.** `CSC_IDENTITY_AUTO_DISCOVERY=false` does not turn off the ad-hoc signing set by `identity: '-'`. With `qualifier === "-"`, MacTargetHelper.findSigningIdentity (MacTargetHelper.js:37-43) creates the `-` identity whatever the auto-discovery flag says. The flag only stops electron-builder from searching for a certificate.
- **Permissions.** The workflow default is `contents: read`. Only the release job gets `contents: write`. Build jobs use `persist-credentials: false`, and the job that holds the write token runs no repository code: it only downloads the artefacts and calls `sha256sum` and `gh`.
- **Injection.** `github.ref_name` and `matrix.args` are passed through `env:` and used as quoted shell variables. The only unquoted variable is `$ARGS`, which comes from the static matrix. No `${{ }}` expression is placed inside a `run:` script.
- **Runner labels and actions.** The runner labels (`ubuntu-latest`, `ubuntu-24.04-arm`, `macos-latest`, `windows-latest`) are valid for public repositories. The origin remote is a public GitHub repository. checkout@v5 and setup-node@v5 match check.yml, and so do `.nvmrc`, bash shell and the autocrlf step. download-artifact@v5 can read uploads from upload-artifact@v4.
- **Re-running the release job.** If any build job fails, the release job is skipped, so a release is never created with only some of the artefacts. When the release job runs again, it reuses the existing release for the tag and uploads with `--clobber`, so it does not create a second draft.
- **Evidence for criterion 2.** The repository has an `origin` remote on GitHub. If criterion 2 is skipped, the skip reason should be the real one: agents may not push tags. It should not say "no remote yet".
- **Out of scope.** The SPEC's README note on Gatekeeper and SmartScreen belongs to `tasks/readme.md`. Smoke-testing the installers belongs to `tasks/installer-smoke.md`. Neither is missing from this task.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | Re-running the workflow can replace assets on a release that is already published**
    - File: `.github/workflows/release.yml:125`
    - Category: Correctness
    - Problem: The upload step creates a release only when `gh release view "$TAG"` finds none, and then always runs `gh release upload --clobber`. `gh release view` also finds published releases, so the step does not check that the release is still a draft. If someone re-runs the workflow (or the release job) after a person has published the draft, the newly built installers and a new `SHA256SUMS.txt` replace the published assets without any warning.
    - Why it matters: The installers are not reproducible bit for bit, so the replaced files have different checksums from the ones users already downloaded or checked. A published release could change silently, which goes against the workflow's own rule that a human reviews and publishes the draft.
    - Suggested fix: Before uploading, read `isDraft` (for example `gh release view "$TAG" --json isDraft -q .isDraft`) and fail with a clear message when the release is already published. Keep `--clobber` only for the draft case.

## Review conclusion

No material issues found. The P3 finding is optional hardening; it does not need to be fixed before the task is completed.

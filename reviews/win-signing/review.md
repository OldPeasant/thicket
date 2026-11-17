# Code Review

Date: 2026-11-17

Task: win-signing - Release: sign Windows builds with SignPath

Scope: task commits e54a194c and f98e6a53 on top of base fbb8c3a5 (`git diff fbb8c3a5..HEAD`, `tasks/` changes ignored)

Requirements:
- tasks/win-signing.md (goal, acceptance criteria, recorded assumptions)
- SPEC.md section 3 "Release" (Should: Windows signing via the SignPath Foundation)
- docs/ARCHITECTURE.md (release/packaging notes)
- AGENTS.md, parent agent instructions (focus areas: unsigned path, artifact names and checksums, secret handling, Git Bash correctness, `--prepackaged` with fuses and asar integrity, docs completeness)

Git range:
- Branch: main
- HEAD: f98e6a53
- Base/start: fbb8c3a55cec8c348d1614dd740a7183b8c6c19c
- Commits reviewed: 2

Summary: 0 P0, 0 P1, 1 P2, 3 P3

Verified without findings:
- Unsigned path: on Linux/macOS the `signing` step is skipped, so `steps.signing.outputs.enabled` is empty; on Windows without secret/variable it is `false`. `SIGN` is then not `true`, `dir=()` expands to nothing (`"${dir[@]}"` is safe because Actions bash runs without `-u`), and all signing steps are skipped. The only differences to the base are the extra notice step and the Windows job timeout (150 instead of 45 min).
- Secrets: the token is only passed via `env` to the gate script (which never prints values) and as an action input; no secret appears in an `if:` condition, which only reads the step output.
- Artifact names: the `--dir` build creates only `release/win-unpacked`; the `--prepackaged` build writes `thicket-<version>-win-x64.exe` / `.zip` into `release/` with the same `artifactName`. The `win-signed` and `installer-signed` directories are not matched by `Collect installers` (`release/*.{...}`), and the `unsigned-*` artifacts do not match the release job's `installers-*` pattern, so `SHA256SUMS.txt` is computed only over the final (signed) files.
- `Use signed installer`: nullglob, exact-one check and same-name check are correct for Git Bash on Windows.
- Fuses and asar integrity: fuses and the asar hash resource are written during the `--dir` pack (before signing); `--prepackaged` skips packing, so the Authenticode signature is not invalidated (parent's hash-preservation test supports this).
- Gate script and its spec (5 cases, including empty/whitespace values GitHub passes for unset secrets) match the criterion.
- docs/CODE_SIGNING.md contains the policy (what is signed, roles, approvals, privacy statement), 8 setup steps with slugs matching the workflow (`thicket`, `release-signing`, `win-app`, `win-installer`), secret/variable names, and the uninstaller limitation; README has the attribution line and updated SmartScreen note.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | GITHUB_TOKEN may lack `actions: read` for the SignPath action**
    - File: `.github/workflows/release.yml:16` (workflow `permissions: contents: read`), used by the steps at lines 115 and 155
    - Category: Integration
    - Problem: The workflow grants the job token only `contents: read`. To my knowledge `signpath/github-action-submit-signing-request@v1` has a `github-token` input defaulting to `github.token`, which is forwarded so SignPath can read the job/run details for origin verification and download the uploaded artifact through the Actions API. Those endpoints belong to the `actions` permission scope; with `actions: none` the token gets 403 "Resource not accessible by integration". This could not be confirmed here (no web access), so it is a plausibility finding, but if correct the first real signing run fails.
    - Why it matters: Signing would fail only at the first real release after the human setup (`signpath-setup`), costing a release cycle and a manual debugging round.
    - Suggested fix: Add job-level permissions to `build` (`contents: read` and `actions: read`; job-level permissions replace the workflow-level block, so list both), or confirm against the action's README during `signpath-setup` and mention it in docs/CODE_SIGNING.md step 8 as something to check if the request fails.

## P3 Low

- [ ] **CR-2 | Third-party action that receives the signing token is pinned to a mutable tag**
    - File: `.github/workflows/release.yml:115`, `.github/workflows/release.yml:155`
    - Category: Security
    - Problem: `signpath/github-action-submit-signing-request@v1` receives `SIGNPATH_API_TOKEN`, but `v1` is a movable tag. The repo uses tags for `actions/*`, but this is the only third-party action and it handles the highest-value credential in the workflow.
    - Why it matters: A moved or compromised tag could exfiltrate the token able to submit signing requests (manual approval limits, but does not remove, the impact).
    - Suggested fix: Pin to a full commit SHA with a `# v1.x` comment (can be done during `signpath-setup` once the SHA can be looked up).

- [ ] **CR-3 | Second `npm run dist` rebuilds the renderer and bundles for nothing**
    - File: `.github/workflows/release.yml:135`
    - Category: Quality
    - Problem: `npm run dist` runs `npm run build -w @thicket/renderer && node scripts/build.mjs` before electron-builder; with `--prepackaged` those outputs are unused.
    - Why it matters: Adds several minutes to an already long Windows job and makes the step look like it repackages the app.
    - Suggested fix: Call `npx electron-builder --config electron-builder.yml --publish never ...` in that step (within `apps/desktop`), or add a small script for packaging only.

- [ ] **CR-4 | Unwrapped long line in install guide**
    - File: `docs/user/install.md:11`
    - Category: Quality
    - Problem: The edited paragraph leaves one line of about 150 characters, while the rest of the file wraps at about 100.
    - Why it matters: Inconsistent with the file's formatting; minor.
    - Suggested fix: Re-wrap the paragraph.

## Review conclusion

No material issues found. CR-1 cannot be confirmed without the SignPath action's documentation, but it is cheap to fix and should be addressed or explicitly checked during `signpath-setup`. Note for the parent: SPEC.md still says "Unsigned for now" (Release) and lists signed builds as out of scope; the task explicitly requires signing (SPEC's own "Should" item), so this is a SPEC wording issue for humans, not a defect of this change.

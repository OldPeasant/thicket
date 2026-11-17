# Code Review

Date: 2026-11-17

Task: win-signing - Release: sign Windows builds with SignPath

Scope: second review round on the final code, whole task diff `git diff fbb8c3a5..HEAD` (commits
e54a194c, f98e6a53, 1e19e7c2, 2758fbf2; `tasks/` and `reviews/` only read for context). Focus:
the fixes for CR-1, CR-3 and CR-4 from round one, and anything they introduced.

Requirements:
- tasks/win-signing.md (goal, acceptance criteria, recorded assumptions)
- SPEC.md section 3 "Release" (Should: Windows signing via the SignPath Foundation)
- docs/ARCHITECTURE.md (release/packaging notes)
- AGENTS.md, parent agent instructions (CR-2 intentionally kept: tag pin, note in docs)
- Round-one review.md and fixes.md in reviews/win-signing/

Git range:
- Branch: main
- HEAD: 2758fbf2
- Base/start: fbb8c3a55cec8c348d1614dd740a7183b8c6c19c
- Commits reviewed: 4

Summary: 0 P0, 0 P1, 0 P2, 1 P3

Verified fixes:
- CR-1 (`actions: read`): `.github/workflows/release.yml:49-51` gives the `build` job
  `contents: read` and `actions: read`. Job-level permissions replace the workflow-level block, so
  listing `contents: read` again is correct (checkout still works); the `release` job keeps its own
  `contents: write`. No write scope was added. The spec asserts the exact map
  (`release-workflow.spec.ts:228`), and docs/CODE_SIGNING.md explains the permission.
- CR-3 (no rebuild): the `--prepackaged` step (`release.yml:135-146`) now runs
  `npx electron-builder --config electron-builder.yml --publish never $ARGS --prepackaged
  release/win-signed "-c.extraMetadata.version=$version"` with `working-directory: apps/desktop`.
  - Same config and options as the `dist` script (`apps/desktop/package.json:28`), same project
    directory (`npm run dist -w apps/desktop` also ran in apps/desktop), so `directories.output:
    release`, `artifactName` and the extraMetadata version are unchanged. Output names stay
    `thicket-<version>-win-x64.exe` / `.zip`.
  - `release/win-signed` resolves relative to apps/desktop, which matches the SignPath
    `output-artifact-directory: apps/desktop/release/win-signed` (checked by the spec at line 204).
  - Resolution of `npx electron-builder`: electron-builder is a devDependency of the workspace
    and hoisted to the root (`node_modules/.bin/electron-builder` exists, no
    `apps/desktop/node_modules/.bin`). npm 7+ auto-detects the workspace root as local prefix
    when run inside a workspace folder and puts every ancestor `node_modules/.bin` on PATH, so the
    locally installed version is used; on Windows Git Bash the runner's `npx` shell shim is found
    the same way as the `npm` used by the other steps. Arguments after the command name are passed
    through to electron-builder unchanged (npx stops parsing its own options at the first
    positional). `CSC_IDENTITY_AUTO_DISCOVERY=false` is still set. The renderer and bundles are
    inside `win-signed/resources` already, and `--prepackaged` skips packing, fuses and
    `npmRebuild`, so dropping the build steps loses nothing.
  - Test: the fake `npx` records the exact argv and the test checks the dist script still uses the
    same options (lines 388-416), so drift between both paths is caught.
- CR-4: docs/user/install.md paragraph rewrapped to at most 100 columns, wording unchanged.
- Unsigned path (unchanged by the fixes): the signing gate, the `dir=()` expansion and all
  `steps.signing.outputs.enabled == 'true'` conditions are as in round one; without the secret
  and variable the Windows build runs `npm run dist` with the same arguments as before the task.
- Checksums: still computed in the release job from the `installers-*` artifacts, after the signed
  installer replaced the unsigned one; the `unsigned-*` artifacts do not match that pattern.
- No secrets, tokens or credentials in the diff; tests use fictitious values only.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-2 | Third-party action that receives the signing token is pinned to a mutable tag (deferred)**
    - File: `.github/workflows/release.yml:119`, `.github/workflows/release.yml:160`
    - Category: Security
    - Problem: `signpath/github-action-submit-signing-request@v1` receives `SIGNPATH_API_TOKEN`
      but is referenced by the movable `v1` tag. Still present; the parent deliberately kept it
      because the commit SHA cannot be looked up here, and docs/CODE_SIGNING.md now tells a
      maintainer to pin it.
    - Why it matters: A moved or compromised tag could exfiltrate the token (manual approval in
      SignPath limits the impact).
    - Suggested fix: Pin to a full commit SHA with a `# v1.x` comment during `signpath-setup`.
      Accepting it as deferred is reasonable; listed only so the disposition stays traceable.

## Review conclusion

No material issues found. The fixes for CR-1, CR-3 and CR-4 are correct and introduce no new
issues; CR-2 remains open by the parent's documented decision. Note from round one still applies:
SPEC.md "Release" wording ("Unsigned for now") is a SPEC text issue for humans, not a defect here.

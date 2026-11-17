---
title: Release: sign Windows builds with SignPath
status: in_progress
owner: dell26/agent-3
deps: [release-ci,installer-smoke,packaged-hardening]
touches: [.github/workflows/release.yml,apps/desktop/electron-builder.yml,apps/desktop/scripts,README.md,docs/CODE_SIGNING.md]
prio: 3
lease_until: 2026-11-17T05:42:40Z
---
## Goal
Sign the Windows release artefacts through the SignPath Foundation's free open source programme, using the official GitHub Action `signpath/github-action-submit-signing-request` (read its README and SignPath's docs for the exact inputs). Both `Thicket.exe` (the app itself, also inside the portable zip) and the NSIS installer must be signed: an installer whose embedded app is unsigned still triggers SmartScreen and AppLocker publisher rules. A likely shape: build `win-unpacked` unsigned, upload it with `actions/upload-artifact`, sign it, build the NSIS installer and zip from the signed folder (electron-builder `--prepackaged`), then sign the installer. Compute `SHA256SUMS.txt` after signing. Signing only runs when the `SIGNPATH_API_TOKEN` secret and the `SIGNPATH_ORGANIZATION_ID` variable exist; without them the workflow builds unsigned exactly as today and logs that it skipped signing (forks, before the human setup is done). Write `docs/CODE_SIGNING.md`: the code signing policy text the SignPath Foundation requires (team roles, who approves signing requests, privacy note: Thicket sends no telemetry), the SignPath project, artifact configuration and signing policy settings a human must create, and the secret/variable names. README: SignPath attribution line as the programme requires, and the Windows SmartScreen paragraph updated (signed from the first signed release on; older releases unsigned).

## Acceptance criteria
- [ ] Workflow validates locally (actionlint), including the signing job
- [ ] Without the SignPath secret the release workflow still builds unsigned artefacts and logs that signing was skipped (verified by reading the workflow logic with actionlint plus a dry run or test of the condition, e.g. `act` or a script test; skip with reason if neither works here)
- [ ] Signed and unsigned builds name and checksum the same artefacts as before (NSIS installer, portable zip, SHA256SUMS.txt computed after signing)
- [ ] docs/CODE_SIGNING.md has the policy text and the step-by-step SignPath setup for a human; README has the attribution and the updated SmartScreen note
- [ ] A real signed release needs the human setup: skip with reason; `signpath-setup` covers it

## Notes
See SPEC.md (Release) and docs/ARCHITECTURE.md.

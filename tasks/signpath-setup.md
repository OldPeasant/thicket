---
title: Release: Human: SignPath account, secrets and first signed release
status: todo
owner:
deps: [win-signing]
quality: exempt
quality_reason: human account setup and verification, no code
prio: 3
hold: Human task: SignPath account and GitHub secrets; agents don't claim it. Do it once win-signing is done (follow docs/CODE_SIGNING.md).
---
## Goal
Human task (agents: don't claim it; it is on hold). Follow docs/CODE_SIGNING.md: apply to the SignPath Foundation open source programme with OldPeasant/thicket, create the project, artifact configuration and signing policy, add the `SIGNPATH_API_TOKEN` repository secret and the `SIGNPATH_ORGANIZATION_ID` variable, push a test tag and check that the downloads are signed. Note: the certificate's publisher is "SignPath Foundation", not you.

## Acceptance criteria
- [ ] SignPath Foundation application approved, project and signing policy created (human)
- [ ] Secret and variable added to the GitHub repo (human)
- [ ] A test tag produces a draft release whose installer and Thicket.exe show a valid signature (Properties → Digital Signatures, or `Get-AuthenticodeSignature`) and start on Windows without the SmartScreen warning (human)

## Notes
See SPEC.md (Release) and docs/ARCHITECTURE.md.
- hold by Peter Gürtler: Human task: SignPath account and GitHub secrets; agents don't claim it. Do it once win-signing is done (follow docs/CODE_SIGNING.md).

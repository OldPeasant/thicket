---
title: Release (Should): Update available notice
status: in_progress
owner: dell26/agent-1
deps: [app-settings,app-layout]
touches: [apps/desktop/src/update,packages/renderer/src/app/update]
prio: 3
lease_until: 2026-11-17T06:46:53Z
---
## Goal
Check the GitHub releases API at start (and daily) unless disabled in settings; show a non-modal notice with a link to the release.

## Acceptance criteria
- [ ] Unit tests with recorded API responses: newer, same, pre-release ignored, network error silent
- [ ] Setting off → no request made (test)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 07:29+0100 by dell26/agent-1): Repo for the check is OldPeasant/thicket (README release link); /releases list is used (not /releases/latest) so pre-releases are filtered explicitly: flagged prerelease, drafts and tags with a semver pre-release suffix are ignored.

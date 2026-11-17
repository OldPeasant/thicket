---
title: Release (Should): Update available notice
status: in_progress
owner: dell26/agent-1
deps: [app-settings,app-layout]
touches: [apps/desktop/src/update,packages/renderer/src/app/update]
prio: 3
lease_until: 2026-11-17T07:02:06Z
---
## Goal
Check the GitHub releases API at start (and daily) unless disabled in settings; show a non-modal notice with a link to the release.

## Acceptance criteria
- [ ] Unit tests with recorded API responses: newer, same, pre-release ignored, network error silent
- [ ] Setting off → no request made (test)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 07:29+0100 by dell26/agent-1): Repo for the check is OldPeasant/thicket (README release link); /releases list is used (not /releases/latest) so pre-releases are filtered explicitly: flagged prerelease, drafts and tags with a semver pre-release suffix are ignored.
- ASSUMPTION (2026-11-17 07:29+0100 by dell26/agent-1): Unpackaged runs (dev, e2e, version 0.0.0) never call GitHub unless THICKET_UPDATE_CHECK=1, so tests/CI don't hit the API and dev builds don't always show a notice.
- ASSUMPTION (2026-11-17 07:29+0100 by dell26/agent-1): Daily re-check is a 24h timer in each window's renderer; main caches a successful answer for 1h and shares in-flight requests so several windows don't multiply requests. Dismissal is per window and not persisted.
- ASSUMPTION (2026-11-17 07:29+0100 by dell26/agent-1): The notice link opens via window.open -> main's setWindowOpenHandler, which calls shell.openExternal only for https://github.com/OldPeasant/thicket/releases/... URLs and still denies the window (no contract change needed).

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
- [x] Unit tests with recorded API responses: newer, same, pre-release ignored, network error silent
  - verified (2026-11-17 07:41+0100 by dell26/agent-1): cd apps/desktop && npx vitest run src/update src/main -> 119 passed; checker.spec.ts 'UpdateChecker with recorded API responses' uses fixtures/releases.json, releases-prerelease.json, rate-limited.json: newer (0.2.0 -> 0.3.0 update), same (0.3.0 no update), pre-release ignored (flag and -beta tag), network error/HTTP 403/timeout silent (no update, logged only); renderer: cd packages/renderer && npx ng test --include src/app/update --include src/app/layout/app-shell.spec.ts -> 97 passed (check failure silent)
- [x] Setting off → no request made (test)
  - verified (2026-11-17 07:42+0100 by dell26/agent-1): checker.spec.ts 'the checkForUpdates setting' (off: fetch not called; handler via mainHandlers off: no request) + renderer update-notice.spec.ts 'setting off: no check is requested, not at start and not daily' (0 app.checkForUpdate requests over 3 days of fake timers) -> all pass in the runs above (119 desktop, 97 renderer)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 07:29+0100 by dell26/agent-1): Repo for the check is OldPeasant/thicket (README release link); /releases list is used (not /releases/latest) so pre-releases are filtered explicitly: flagged prerelease, drafts and tags with a semver pre-release suffix are ignored.
- ASSUMPTION (2026-11-17 07:29+0100 by dell26/agent-1): Unpackaged runs (dev, e2e, version 0.0.0) never call GitHub unless THICKET_UPDATE_CHECK=1, so tests/CI don't hit the API and dev builds don't always show a notice.
- ASSUMPTION (2026-11-17 07:29+0100 by dell26/agent-1): Daily re-check is a 24h timer in each window's renderer; main caches a successful answer for 1h and shares in-flight requests so several windows don't multiply requests. Dismissal is per window and not persisted.
- ASSUMPTION (2026-11-17 07:29+0100 by dell26/agent-1): The notice link opens via window.open -> main's setWindowOpenHandler, which calls shell.openExternal only for https://github.com/OldPeasant/thicket/releases/... URLs and still denies the window (no contract change needed).

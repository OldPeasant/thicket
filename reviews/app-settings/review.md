# Code Review

Date: 2026-11-16

Task: app-settings - M0: Settings store in main (settings.json, app.* methods)

Scope: `git diff e46732c..HEAD` (all task commits up to 21f43f0; committed changes only). Second pass on the final code, including verification of the CR-1 fix from the first pass.

Requirements:
- tasks/app-settings.md acceptance criteria and recorded assumptions
- SPEC.md (settings in `userData/settings.json`, `app.*` settings methods, page sizes, styles/modes)
- docs/ARCHITECTURE.md (main process layout, settings paragraph, contract conventions)
- AGENTS.md, docs/QUALITY.md
- reviews/app-settings/fixes.md (CR-1 fix description)

Git range:
- Branch: main
- HEAD: 21f43f0 (app-settings: back up an unreadable settings.json before overwriting it (CR-1))
- Base/start: e46732c98118f1cae207337fdc22e418298430c0
- Commits reviewed: 5 (3613a30 settings store; 2e365ba main handlers, broadcaster and wiring; b21a38b ARCHITECTURE.md; 6f8d535 test-writer tests and first review; 21f43f0 CR-1 fix)
- Uncommitted changes: the working tree has an uncommitted change to `apps/desktop/src/settings/store.spec.ts` (+86 lines, apparently from a concurrent test-writer run). It is not part of the reviewed revision and was not reviewed.

Summary: 0 P0, 0 P1, 0 P2, 1 P3

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-2 | A corrupt file that could not be moved aside at start is overwritten by the first set without a backup**
    - File: `apps/desktop/src/settings/store.ts:222`
    - Category: Correctness
    - Problem: `backUpCorrupt()` logs and continues when the rename to `settings.json.corrupt-<time>` fails (EBUSY/EPERM from a lock on Windows, EACCES on the folder). The store then uses the defaults, but nothing marks the file as still pending a backup. The first `app.settings.set` writes the temp file and renames it over `settings.json`, so the bad file is destroyed and no backup ever exists. This is the same pattern CR-1 fixed for unreadable files, but the corrupt path does not use the new `unreadable`/move-aside-before-write mechanism. The test "a corrupt file that cannot be moved aside still gives the defaults (logged)" (`store.spec.ts:137`) stops before any `set`, so it does not cover this.
    - Why it matters: Acceptance criterion 1 promises "corrupt file -> defaults + backup of the bad file". A file that is only slightly broken (for example a hand edit with a trailing comma) is the case where the user most wants the backup. In this path the content is lost the first time the user changes a setting.
    - Suggested fix: In the `catch` of `backUpCorrupt()`, set a pending-backup flag so `write()` tries the move again before the first write (reuse `backUpUnreadable()`, perhaps renamed to a general move-aside, with the `corrupt` kind). Add a test where the first rename fails at open and a later `set` either backs up the corrupt content first or rejects without overwriting it.

## CR-1 verification (first pass)

CR-1 (a non-ENOENT read failure at start let the next set overwrite the stored settings with defaults) is fixed in 21f43f0:
- `load()` sets `unreadable = true` on a non-ENOENT read error (`store.ts:175-177`). `write()` calls `backUpUnreadable()` before writing the temp file (`store.ts:163`).
- `backUpUnreadable()` renames the file to `settings.json.unreadable-<time>`. On ENOENT it goes ahead. On any other error it throws before any write, so `apply()` leaves `current` unchanged, no listener runs, and the flag stays set so the next set retries (`store.ts:208-220`). The serialized queue recovers through `run.catch`.
- Regression tests in `describe('SettingsStore unreadable file')` cover all three paths: backup then write with only one backup, ENOENT, and a failed move followed by a retry. The class comment and docs/ARCHITECTURE.md describe the behavior.

## Notes (not findings)

- Acceptance criterion 1: `store.spec.ts` covers defaults, per-key fallback, unknown keys dropped on load and on set, and corrupt-file backups for several malformed layouts. CR-2 above is the one uncovered sub-case.
- Acceptance criterion 2: `store.spec.ts` checks the write order (flushed temp file, then rename) and simulates a crash between write and rename with an injected `rename`. It checks that the previous file is intact, that the stale temp file is removed at the next start, and the restart.
- Acceptance criterion 3: I reran `npm run test:electron` (repo root; builds the renderer and desktop, then runs the Electron vitest config) -> 3 files, 17 tests passed, including `apps/desktop/test/settings.electron.spec.ts`. That test uses electron-shell's `launchApp` harness with `THICKET_USER_DATA` and checks that the renderer receives exactly one `app.settings.changed` event with the full payload after `app.settings.set`.
- I reran `npx vitest run --project desktop` -> 7 files, 130 tests passed.
- Contract and integration: `BROADCAST_STREAMS.settingsChanged`, the `settingsChanged` schema and the `SettingsChanged` type match what main emits (`satisfies SettingsChanged`). Handlers receive contract-parsed params, so invalid or unknown keys are refused with `INVALID_PARAMS` before they reach the store. Each window's broadcaster sink is removed on reload and close. A failing sink is logged and does not stop the others.
- Behavior covered by recorded assumptions and therefore not reported: the chosen defaults, the `{version, settings}` layout, reading a newer version leniently and writing it back as version 1, no event when nothing changed, and the `THICKET_USER_DATA` override.

## Review conclusion

No material issues found. CR-1 is fixed. CR-2 is a low-priority robustness gap the parent may fix or accept.

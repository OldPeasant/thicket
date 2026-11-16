# Code Review

Date: 2026-11-16

Task: app-settings - M0: Settings store in main (settings.json, app.* methods)

Scope: `git diff e46732c..HEAD` (task commits after the base; committed changes only, working tree clean)

Requirements:
- tasks/app-settings.md acceptance criteria and recorded assumptions (`python tasks.py assumptions`)
- SPEC.md sections 4-6 (styles/modes in settings, page sizes 20/50/100/500, `app.*` settings get/set, `userData/settings.json`)
- docs/ARCHITECTURE.md (main process layout, settings paragraph, contract conventions)
- AGENTS.md, docs/QUALITY.md

Git range:
- Branch: main
- HEAD: b21a38b2ec9f51211411475d0d58e9f399c8faf8
- Base/start: e46732c98118f1cae207337fdc22e418298430c0
- Commits reviewed: 3 (3613a30 settings store; 2e365ba main handlers, broadcaster and wiring; b21a38b ARCHITECTURE.md settings paragraph). The commit ids named in the review request (38ac946, 8b19fb3) are not in the current history; the commits above are the ones between the base and HEAD now, and b21a38b was added while this review ran.

Summary: 0 P0, 0 P1, 0 P2, 1 P3

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | A non-ENOENT read failure at startup lets the next set overwrite the stored settings with defaults**
    - File: `apps/desktop/src/settings/store.ts:165`
    - Category: Correctness
    - Problem: When `readFile` fails with anything other than `ENOENT` (EACCES, EBUSY/EPERM from a locking scanner on Windows, EMFILE), `load()` logs and keeps `DEFAULT_SETTINGS`, but leaves the store fully writable. The first `app.settings.set` afterwards writes `DEFAULTS + change` to the temp file and renames it over `settings.json`, replacing the user's file that was merely unreadable for a moment. Unlike the corrupt-file path, nothing is kept aside. The unit test at `store.spec.ts` ("a file that cannot be read (not ENOENT)") only covers EISDIR, where the later rename would fail anyway.
    - Why it matters: A transient read error silently loses every saved setting the first time the user changes one setting.
    - Suggested fix: After a non-ENOENT read error, either copy the existing file aside (same as the corrupt backup) before the first write, or retry the read once before the first write. Add a unit test with an injected `readFile` that rejects with EACCES followed by a `set`.

## Notes (not findings)

- Acceptance criterion 1 is covered by `store.spec.ts`: defaults, per-key fallback, unknown keys dropped on load and on set, and corrupt-file backups for not-JSON, empty, array, no version, non-object settings and `null`.
- Acceptance criterion 2: `store.spec.ts` checks the write order (temp file with `flush: true`, then rename) and simulates a crash between write and rename through an injected `rename`. Previous content, in-memory state, cleanup of the stale temp file and a restart are all checked.
- Acceptance criterion 3: `apps/desktop/test/settings.electron.spec.ts` uses electron-shell's `launchApp` harness with `THICKET_USER_DATA`. It sets settings from the renderer and expects one `app.settings.changed` event with the full payload, a refused invalid set, and the settings kept after a restart. I did not run this Electron test in this review. At review time `python tasks.py verify app-settings` showed no evidence for any criterion. The parent must run `npm run test:electron` (or the equivalent desktop script) and record the actual result before claiming criterion 3.
- I ran `npx vitest run src/settings src/main` in `apps/desktop`: 5 files, 76 tests passed.
- The contract additions (`BROADCAST_STREAMS.settingsChanged`, `settingsChanged` schema, `SettingsChanged` type) match the payload the main process emits (`satisfies SettingsChanged`) and the stream-list test. The handlers use the contract's parsed params, so invalid or unknown keys are refused with `INVALID_PARAMS` before they reach the store. Each window's broadcaster sink is removed on reload and close.
- Behavior covered by recorded assumptions and not reported: the chosen defaults, writing a newer-version file back as version 1 without its unknown keys, and no event when nothing changed.

## Review conclusion

No material issues found.

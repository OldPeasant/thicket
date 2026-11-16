# Code Review

Date: 2026-11-16

Task: app-settings - M0: Settings store in main (settings.json, app.* methods)

Scope: `git diff e46732c..HEAD` (all task commits up to 523e847; committed changes only). Third pass on the final code, including verification of the CR-2 fix from the second pass and a re-check of the CR-1 fix from the first pass. Extended from 875b681 to the final revision 523e847, which only adds test-writer tests (`git diff 875b681 523e847`: `apps/desktop/src/settings/store.spec.ts`, +118 lines).

Requirements:
- tasks/app-settings.md acceptance criteria and recorded assumptions
- SPEC.md (settings in `userData/settings.json`, `app.*` settings methods, page sizes, styles/modes)
- docs/ARCHITECTURE.md (main process layout, settings paragraph, contract conventions)
- AGENTS.md, docs/QUALITY.md
- reviews/app-settings/fixes.md (CR-1 and CR-2 fix descriptions)

Git range:
- Branch: main
- HEAD: 523e847 (app-settings: third-pass corrupt-file tests); reviewed revision 523e84770471637365c0b0a9ae1299f5ca0f8e82
- Base/start: e46732c98118f1cae207337fdc22e418298430c0
- Commits reviewed: 8 (3613a30 settings store; 2e365ba main handlers, broadcaster and wiring; b21a38b ARCHITECTURE.md; 6f8d535 first-pass tests and review; 21f43f0 CR-1 fix; 4a43fc8 second-pass tests and review; 875b681 CR-2 fix; 523e847 third-pass corrupt-file tests)
- Uncommitted changes: at 523e847, only `reviews/app-settings/tests.md` and this report were modified in the working tree. No code or test files had uncommitted changes.

Summary: 0 P0, 0 P1, 0 P2, 0 P3

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

None.

## CR-2 verification (second pass)

CR-2 (a corrupt file that could not be moved aside at start was overwritten by the first set without a backup) is fixed in 875b681:
- The boolean `unreadable` flag is now `pendingBackup: 'corrupt' | 'unreadable' | undefined` (`store.ts:107`). If the load-time rename in `backUpCorrupt()` fails with anything other than ENOENT, it sets `pendingBackup = 'corrupt'` (`store.ts:237`). ENOENT means the file is already gone, so nothing is pending.
- `write()` calls `moveAsideBeforeWrite(kind)` before it writes the temp file (`store.ts:170`). That method renames the file to `settings.json.<kind>-<time>`. On a non-ENOENT failure it logs and throws before any write, so `apply()` leaves `current` unchanged, no listener runs, and the flag stays set for the next set. The flag is cleared only after a successful move or ENOENT (`store.ts:215-227`). The serialized queue recovers through `run.catch` (`store.ts:139`).
- New regression tests in `describe('SettingsStore corrupt file')` cover three cases. In the first, the backup happens at the first set, and only one backup is made. In the second, the move fails again at set: the set rejects, the file, settings and listeners are untouched, and a later set retries and succeeds. In the third, a load-time ENOENT is not retried. The class comment and the settings paragraph in docs/ARCHITECTURE.md describe the retry.

## CR-1 re-check (first pass)

CR-1 still holds. On a non-ENOENT read error, `load()` sets `pendingBackup = 'unreadable'` (`store.ts:182-185`), and the same `moveAsideBeforeWrite` path guards the first write. The log messages are the same as before, now built from `kind`. The tests in `describe('SettingsStore unreadable file')` still pass.

## Notes (not findings)

- I ran `npx vitest run --project desktop` (repo root, clean working tree at 875b681) -> 7 files, 138 tests passed. Rerun at 523e847 (no uncommitted code or test changes) -> 7 files, 143 tests passed.
- Delta 875b681..523e847: five new tests in `describe('SettingsStore corrupt file')`. They cover these cases:
  - a pending corrupt file is not moved by a set that changes nothing or that the schema refuses;
  - concurrent sets produce exactly one backup, and the final file holds the last values;
  - a move that fails during a set, with a second set queued behind it, is retried by that second set;
  - a crash between the temp write and the rename after the move keeps the backup, and a restart uses the defaults without a second backup;
  - a load-time move failure without an error code is retried.
  The tests check behavior through the real file system and an injected `rename`, and they match the store code at `store.ts:139`, `store.ts:155-157`, `store.ts:170` and `store.ts:237`. No production code changed, so the findings above are unchanged.
- Acceptance criterion 1: `store.spec.ts` covers defaults, per-key fallback, unknown keys dropped on load and on set, corrupt-file backups for several malformed layouts, and now the failed-backup retry.
- Acceptance criterion 2: `store.spec.ts` checks the write order (flushed temp file, then rename) and simulates a crash between write and rename with an injected `rename`. It checks that the previous file is intact, that the stale temp file is removed at the next start, and the restart. The store code on this path did not change since the second pass.
- Acceptance criterion 3: `apps/desktop/test/settings.electron.spec.ts` uses electron-shell's `launchApp` harness with `THICKET_USER_DATA`. In the second pass I ran `npm run test:electron` and it passed. The main/window/broadcast code has not changed since then, but I did not rerun it in this pass.
- `python tasks.py verify app-settings` shows no evidence recorded yet for criteria 1-3. The parent worker must record it before `done`. This is not a code finding.
- Contract and integration did not change since the second pass. `BROADCAST_STREAMS.settingsChanged`, the `settingsChanged` schema and the `SettingsChanged` type match what main emits. Handlers receive contract-parsed params. Each window's broadcaster sink is removed on detach.
- Behavior covered by recorded assumptions and therefore not reported: the chosen defaults, the `{version, settings}` layout, reading a newer version leniently and writing it back as version 1, no event when nothing changed, and the `THICKET_USER_DATA` override.

## Review conclusion

No material issues found. CR-1 and CR-2 are fixed.

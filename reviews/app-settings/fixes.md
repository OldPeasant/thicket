# Fix Report

Date: 2026-11-16

Task: app-settings - M0: Settings store in main (settings.json, app.* methods)

Scope: current task; findings CR-1 (first review pass, reviewed HEAD 6f8d535, fixed in 21f43f0) and CR-2 (second review pass, reviewed HEAD 4a43fc8) from `reviews/app-settings/review.md` (base e46732c98118f1cae207337fdc22e418298430c0). The CR-2 changes are uncommitted working-tree changes; the parent worker commits them.

## Fixed findings

### CR-1 — A non-ENOENT read failure at startup lets the next set overwrite the stored settings with defaults

Files changed:
- `apps/desktop/src/settings/store.ts`
- `apps/desktop/src/settings/store.spec.ts`
- `docs/ARCHITECTURE.md`

Problem:
When `readFile` of `settings.json` failed at start with an error other than ENOENT (EACCES, a lock, ...), the store used the defaults and the first `set()` renamed `DEFAULTS + change` over the existing file. The user's settings were lost and no copy was kept.

Fix:
`load()` now sets a private `unreadable` flag after such a failure. Before the next write, `write()` calls the new `backUpUnreadable()`. It renames the file to `settings.json.unreadable-<time>`, using the same ISO stamp format as the corrupt backup (shared through a small `backupName()` helper), and logs the move. If the rename fails with ENOENT, the write goes ahead. Any other failure is logged and thrown before the temp file is written, so `set()` rejects and the settings, file and listeners stay unchanged. The flag stays set, so the next `set()` tries again. After a successful move (or ENOENT) the flag is cleared. The class doc comment, the `now` option comment and the settings paragraph in `docs/ARCHITECTURE.md` now describe this.

Regression tests (new `describe('SettingsStore unreadable file')`):
- readFile rejects with EACCES. The file is untouched at start. The first `set()` moves it to `settings.json.unreadable-2026-11-16T12-34-56-789Z` with its original content and writes the new file. A second `set()` makes no second backup.
- An unreadable file that is gone by the first `set()` (ENOENT on the rename): the store writes normally and creates no backup.
- The backup rename fails with EBUSY: `set()` rejects, the original file is untouched, there is no temp file and no backup, the in-memory settings are unchanged and no listener is called. Once the rename works, a later `set()` succeeds, the backup holds the original content, the new file is written and the listener is called once.

Validation:
- `npx vitest run --project desktop` (repo root) — Pass (7 files, 130 tests)
- `npm run check` (repo root: lint, typecheck, unit tests) — Pass

### CR-2 — A corrupt file that could not be moved aside at start is overwritten by the first set without a backup

Files changed:
- `apps/desktop/src/settings/store.ts`
- `apps/desktop/src/settings/store.spec.ts`
- `docs/ARCHITECTURE.md`

Problem:
When the rename of a corrupt `settings.json` to `settings.json.corrupt-<time>` failed at load (EBUSY, EPERM, EACCES), `backUpCorrupt()` only logged. The first `set()` then renamed the new file over the corrupt one, so its content was lost and no backup existed, which breaks acceptance criterion 1 ("corrupt file -> defaults + backup of the bad file").

Fix:
The CR-1 mechanism now covers both cases. The boolean `unreadable` flag became `pendingBackup: 'unreadable' | 'corrupt' | undefined` (type `BackupKind`), and `backUpUnreadable()` became `moveAsideBeforeWrite(kind)`, which renames the file to `settings.json.<kind>-<time>` before the first write. As before, ENOENT means the write goes ahead. Any other failure is logged and thrown before the temp file is written, so `set()` rejects, nothing changes and the next `set()` retries. When the corrupt-file rename at load fails with anything other than ENOENT, `backUpCorrupt()` now sets `pendingBackup = 'corrupt'`. ENOENT means the file is already gone, so nothing is pending. The unreadable-file behavior and its log messages are unchanged. The class doc comment and the settings paragraph in `docs/ARCHITECTURE.md` describe the retry.

Regression tests (in `describe('SettingsStore corrupt file')`):
- The corrupt-backup rename fails at open, so the file is still there and unchanged. The rename then works: the first `set()` creates `settings.json.corrupt-2026-11-16T12-34-56-789Z` with the original content and writes the new file. A second `set()` creates no second backup.
- The backup rename still fails (EBUSY) at `set()`: `set()` rejects, the corrupt file is untouched, no temp file or backup exists, the in-memory settings are unchanged and no listener is called. Once the rename works, a later `set()` backs up the original content, writes the new file and calls the listener once.
- The corrupt file disappears during the load-time rename (ENOENT): no retry is attempted and `set()` writes normally.

The existing test "a corrupt file that cannot be moved aside still gives the defaults (logged)" still passes unchanged. I did not run the new tests against the pre-fix code, because the temporary file swap needed approval. By inspection, the old code overwrote the corrupt file on the first `set()` and made no backup, so the first two new tests would fail on it.

Validation:
- `npx vitest run --project desktop` (repo root) — Pass (7 files, 138 tests)
- `npm run check` (repo root: lint, typecheck, unit tests) — Pass

## Not fixed

None.

## Validation summary

Focused tests:
- CR-1 pass: `npx vitest run --project desktop` — Pass, 7 files, 130 tests
- CR-2 pass: `npx vitest run --project desktop` — Pass, 7 files, 138 tests

Full test suite:
- CR-1 pass: `npm run check` — Pass. Lint and typecheck passed (they are chained with `&&` before the tests). Root vitest: 22 files, 1321 tests passed. Renderer `ng test`: 5 files, 181 tests passed.
- CR-2 pass: `npm run check` — Pass. Lint and typecheck passed. Root vitest: 22 files, 1329 tests passed. Renderer `ng test`: 5 files, 181 tests passed.

Lint/type-check/build:
- `npm run lint`, `npm run typecheck` (inside `npm run check`) — Pass

`.taskcheck`:
- Pass. `.taskcheck` runs `npm run check`, which passed as shown above. The fixer did not run it as a separate command.

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.

# Fix Report

Date: 2026-11-16

Task: app-settings - M0: Settings store in main (settings.json, app.* methods)

Scope: current task; finding CR-1 from `reviews/app-settings/review.md` (base e46732c98118f1cae207337fdc22e418298430c0, reviewed HEAD 6f8d535). Uncommitted working-tree changes; the parent worker commits them.

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

## Not fixed

None.

## Validation summary

Focused tests:
- `npx vitest run --project desktop` — Pass, 7 files, 130 tests

Full test suite:
- `npm run check` — Pass. Lint and typecheck passed (they are chained with `&&` before the tests). Root vitest: 22 files, 1321 tests passed. Renderer `ng test`: 5 files, 181 tests passed.

Lint/type-check/build:
- `npm run lint`, `npm run typecheck` (inside `npm run check`) — Pass

`.taskcheck`:
- Pass. `.taskcheck` runs `npm run check`, which passed as shown above. The fixer did not run it as a separate command.

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.

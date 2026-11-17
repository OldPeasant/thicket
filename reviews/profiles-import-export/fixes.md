# Fix Report

Date: 2026-11-17

Task: profiles-import-export - M2: Import from Compass and URIs, export without secrets

Scope: current task; findings CR-1..CR-5 from `reviews/profiles-import-export/review.md` and TW-1 from `reviews/profiles-import-export/tests.md`

## Fixed findings

### CR-1 — Thicket-format import stores secret URI options in connections.json

Files changed:
- `apps/desktop/src/profiles/import/uri.ts`
- `apps/desktop/src/profiles/import/compass.ts`
- `apps/desktop/src/profiles/import/import.spec.ts`

Problem:
`parseThicket` passed each validated profile through unchanged, so `proxyPassword`, `tlsCertificateKeyFilePassword` and `AWS_SESSION_TOKEN` in a shared file's connection string were saved to connections.json and sent to the renderer.

Fix:
Added `stripUriSecrets(uri)` to `uri.ts`. It reuses the existing `takeSecrets` logic and returns the cleaned URI plus the kinds it removed. When nothing is removed, it returns the URI unchanged so that re-import deduplication still works. `parseThicket` now cleans every entry's connection string this way. A shared file is treated as untrusted, so the removed values are dropped rather than stored. The entry gets a notice that names the removed options. An entry whose URI can't be parsed is skipped, and the reason never contains the password. Added a parse-level test (all three options, grep that no value is left, notice text, a clean URI kept byte-identical) and a handler-level test (CR-5).

Validation:
- `cd apps/desktop && npx vitest run src/profiles src/main` — Pass

### CR-2 — Thicket import keeps `secretMode: 'saved'` without any stored secret

Files changed:
- `apps/desktop/src/profiles/import/compass.ts`
- `apps/desktop/src/profiles/import/import.spec.ts`

Problem:
A hand-written Thicket entry with `secretMode: 'saved'` was imported as `saved` even though no secret was stored for it, so the user would never be asked for the password.

Fix:
`parseThicket` now turns `saved` into `ask`, the same way `exportFile` does. `none` and `ask` are kept. Added a test, and the CR-5 handler test checks the same thing on the stored profile.

Validation:
- `cd apps/desktop && npx vitest run src/profiles src/main` — Pass

### CR-3 — Failures to save imported secrets are never logged in the app

Files changed:
- `apps/desktop/src/main/handlers.ts`
- `apps/desktop/src/main/index.ts`
- `apps/desktop/src/main/handlers.spec.ts`

Problem:
`mainHandlers` did not pass a `log` to `importExportHandlers`, so failures from `secrets.set` during an import were never logged.

Fix:
Added an optional `log` to `MainHandlerDeps` and passed it on to `importExportHandlers`. `index.ts` now passes ``(message) => log(`profiles: ${message}`)``, the same prefix the profiles store uses, so lines appear as `[main] profiles: ...`. Added a test: when `secrets.set` fails, the failure reaches the given log, the log does not contain the password, and the profile falls back to `ask`.

Validation:
- `cd apps/desktop && npx vitest run src/profiles src/main` — Pass

### CR-4 — Stale architecture note and unused `PlannedPage`

Files changed:
- `docs/ARCHITECTURE.md`
- `packages/renderer/src/app/layout/planned-page.ts` (deleted)

Problem:
ARCHITECTURE.md still described the import route as a `PlannedPage` placeholder. It did not mention the `src/profiles/import` module, the file format, or the desktop app's new `@thicket/core` dependency.

Fix:
- The layout section now routes `NAV.importCompass` to `ImportExportPage`.
- New "Import/export (`src/profiles/import/`)" bullet in the main-process section covering the handlers, the size limit, the Compass/Thicket formats, secret handling, deduplication, the export format, and the `@thicket/core/uri` dependency.
- New `ImportExportPage` bullet in the "Connection editor" section.

A grep across the repo (excluding node_modules, dist and .git) found `PlannedPage` only in its own file, the old doc line, and historical review reports. It had no spec and was not exported from any index.ts, so I deleted it.

Validation:
- `npm run check` (lint, typecheck, renderer and all unit tests) — Pass

### CR-5 — Untested handler paths: Thicket file through the handler, oversized file, read-only store

Files changed:
- `apps/desktop/src/profiles/import/import.spec.ts`

Problem:
The review listed three handler paths without tests.

Fix:
The test-writer had already covered:
- the size limit ("refuses a file larger than MAX_IMPORT_FILE_BYTES before reading it");
- the read-only store, through `profiles.importUris`;
- a Thicket file round trip through `profiles.importCompass`.

What was missing is now one handler test, "profiles.importCompass reads a Thicket file: strips secrets, skips invalid entries (CR-5)". It reads a Thicket file through `profiles.importCompass` and checks that:
- the result is contract-valid;
- an invalid entry is skipped;
- the secret option is stripped and a notice is added;
- `saved` becomes `ask` and no secret is stored;
- a read-only store maps to `UNSUPPORTED` on this path too.

Validation:
- `cd apps/desktop && npx vitest run src/profiles src/main` — Pass

### TW-1 — `colorOf` resolves inherited object keys

Files changed:
- `apps/desktop/src/profiles/import/compass.ts`

Problem:
`COMPASS_COLORS[color]` returned inherited members for keys such as `constructor` or `__proto__`. Saving such a profile then failed with a DataCloneError.

Fix:
`colorOf` now looks a key up only when `Object.hasOwn(COMPASS_COLORS, color)` is true. The two existing tests for this now pass and were left unchanged.

Validation:
- `cd apps/desktop && npx vitest run src/profiles src/main` — Pass

## Not fixed

None.

## Validation summary

Focused tests:
- `cd apps/desktop && npx vitest run src/profiles src/main` — Pass (6 files, 191 tests)
- `npx vitest run packages/contract` — Pass (4 files, 733 tests)

Full test suite:
- `npm run check` — Pass (lint + prettier + typecheck; root vitest 65 files / 3600 tests; renderer `ng test` 81 files / 2436 tests). The first run failed only on prettier formatting of `import.spec.ts`. I fixed that with `npx prettier --write` and the rerun passed.

Lint/type-check/build:
- Included in `npm run check` — Pass

`.taskcheck`:
- Not run directly because the sandbox refused to execute it. It only runs `npm run check`, which passed (see above).

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.

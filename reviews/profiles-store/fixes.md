# Fix Report

Date: 2026-11-16

Task: profiles-store - M1: Connection profiles store (connections.json)

Scope: the three P3 findings in `reviews/profiles-store/review.md` (CR-1, CR-2, CR-3)

## Fixed findings

### CR-1 — Retried v0 migration orphans passwords of id-less entries in secrets.bin

Files changed:
- `apps/desktop/src/profiles/store.ts`
- `apps/desktop/src/profiles/store.spec.ts`

Problem:
`migrateV0` gave a v0 entry without an `id` a fresh `newId()` on every migration attempt. When the
rewrite of connections.json failed after the password had been moved into secrets.bin, the retry
used a different id and the password stored under the first id was orphaned.

Fix:
An id-less (or empty-id) v0 entry now gets `v0-<first 32 hex chars of sha-256>` of
`JSON.stringify([index, entry with the password removed from uri])`. The id is the same for the same
file content on every attempt and across restarts; the index keeps identical entries apart, and the
`v0-` prefix plus 128 bits of hash makes a collision with an explicit v0 id implausible (the existing
duplicate-id check still moves such a file aside). The password is excluded from the hashed content
so connections.json carries no value derived from it. `migrate()` no longer takes a `newId`
parameter (only `save`/`duplicate` use `newId`). The fixture and edge-case tests that expected
`id-1` now expect an id matching `/^v0-[0-9a-f]{32}$/`. Regression test added: "a retried migration
gives an id-less entry the same id, so no secret is orphaned" (rename fails once, retry migrates
under the same ids, secrets.bin holds only those ids, `migrate()` on the same content gives the same
ids).

Validation:
- `npx vitest run apps/desktop/src` — Pass (9 files, 220 tests)

### CR-2 — Any secrets.bin error during migration permanently discards the migrated password

Files changed:
- `apps/desktop/src/profiles/store.ts`
- `apps/desktop/src/profiles/store.spec.ts`

Problem:
Every error from `secrets.set` during migration switched the profile to `secretMode: 'ask'`, and the
v0 file was then overwritten without the password, even for transient errors (EACCES, ENOSPC).

Fix:
The migration secrets loop falls back to `ask` only for `SecretStorageUnavailableError` (imported
from `../secrets`); any other error is rethrown, so the load fails before the rewrite, the v0 file
stays intact and the migration is retried on the next operation. The existing test "asks for the
password when secrets.bin cannot take it" still covers the unavailable case. New test: "a secrets.bin
write error other than "unavailable" keeps the v0 file and retries" (set fails with a plain error ->
operation rejects, v0 file unchanged, nothing stored; after the error clears the migration stores the
password and keeps `secretMode: 'saved'`).

Validation:
- `npx vitest run apps/desktop/src` — Pass

### CR-3 — ARCHITECTURE.md Secrets bullet still says the profiles store applies defaultSecretMode

Files changed:
- `docs/ARCHITECTURE.md`

Problem:
The Secrets bullet said the profiles store uses `status().defaultSecretMode` for new profiles; the
store does not.

Fix:
The Secrets bullet now says the store uses `kinds()` and `delete(id)` only, never rewrites
`secretMode`, and the renderer's connection form takes `defaultSecretMode` from
`profiles.secretStorage` for new profiles. The Profiles bullet now mentions the `ask` fallback only
for unavailable secret storage, the deterministic `v0-<sha-256>` id for id-less entries, and that
saved profiles keep the `secretMode` the caller sends.

Validation:
- `npm run check` (includes `prettier --check .`) — Pass

## Not fixed

None.

## Validation summary

Focused tests:
- `npx vitest run apps/desktop/src` — Pass (9 files, 220 tests)

Full test suite:
- `npm run check` — Pass (unit: 29 files, 1592 tests; renderer: 5 files, 181 tests)

Lint/type-check/build:
- `npm run check` (eslint --max-warnings 0, prettier --check, type check) — Pass
- `npx prettier --write` on the changed files — no changes needed

`.taskcheck`:
- Pass (`.taskcheck` runs `npm run check`)

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.

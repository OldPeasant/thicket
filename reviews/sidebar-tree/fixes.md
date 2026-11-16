# Fix Report

Date: 2026-11-16

Task: sidebar-tree - M1: Sidebar tree of connections, databases, collections (round 3 fixes)

Scope: the one validated finding in `reviews/sidebar-tree/round3/review.md` (CR-1, P2). Base add6545e8ae22053fd562cc7544640b14abdd408, fixes made on top of c5711986477f369251708e5921846d0063482ec5.

## Fixed findings

### CR-1 — A cancelled or older `conn.open` answer overwrites the connection state after Disconnect

Files changed:
- `packages/renderer/src/app/sidebar/sidebar-tree.service.ts`
- `packages/renderer/src/app/sidebar/sidebar-tree.service.spec.ts`

Problem:
`connect()` had no request identity. When the user chose Disconnect while connecting, the `conn.open` answer arrived late (the backend rejects it with `CANCELLED`) and set the profile to `error` ("Connection failed: The operation was cancelled.") instead of leaving it not connected. If the user reconnected before the old request failed, the late rejection marked the new, working connection as failed.

Fix:
`connect()` now takes a generation under the key `conn:<profileId>`, the same mechanism the list and stats loads use (`next` / `current`). It applies the `conn.open` result or error, and loads the databases, only while that generation is current. Otherwise it returns the current state unchanged. The generation becomes stale in three ways:
- a newer `connect()` for the profile;
- `forgetProfile()`, which `disconnect()` and the `disconnected`/`error` status broadcasts call. Its matcher takes the text after the first `:` and compares it with the profile id, so `conn:<profileId>` matches, and a different profile's key does not;
- `backend.restarted`, which invalidates every key except `profiles`.

Nothing else changed. A current attempt behaves as before.

Tests added (`sidebar-tree.service.spec.ts`, "connections"):
- Disconnect while connecting, then `conn.open` rejects with `CANCELLED`: the state stays `disconnected`, `connect()` resolves with `disconnected`, and no database list is requested.
- Disconnect while connecting, then a late `conn.open` success: ignored, so the state stays `disconnected` and no database list is requested.
- Reconnect before the old request fails, the new attempt connects, then the old one rejects with `CANCELLED`: the profile stays `connected` and its databases stay loaded.
- A newer connect without a disconnect: a late failure of the older attempt does not override the newer `connected` state.

Validation:
- `cd packages/renderer && npx ng test --include='src/app/sidebar/*.spec.ts'` — Pass (2 files, 166 tests)
- `npm run check` (repo root) — Pass

## Not fixed

None.

## Validation summary

Focused tests:
- `npx ng test --include='src/app/sidebar/*.spec.ts'` (packages/renderer) — Pass: 2 files, 166 tests.

Full test suite:
- `npm run check` (repo root) — Pass. Lint, prettier and type check passed. Root vitest: 44 files, 2684 tests passed. Renderer: 46 files, 1004 tests passed.

Lint/type-check/build:
- Included in `npm run check` — Pass.

`.taskcheck`:
- Not run separately. It runs `npm run check`, which passed.

Remaining unresolved findings:
0

## Final status

All validated findings fixed and validation passed.

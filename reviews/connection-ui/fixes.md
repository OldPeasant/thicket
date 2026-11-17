# Fix Report

Date: 2026-11-17

Task: connection-ui - M1: Connection editor and manager

Scope: current task. Findings approved by the parent worker from `reviews/connection-ui/tests.md` (TW-1) and `reviews/connection-ui/review.md` (CR-1, CR-2, CR-3, CR-5, CR-6). Task base 9d2524478e7bf26f37e1ec73ebb4f721753be056, fixes in commit dd51ff076c1ef0f5450b108b46fe15f11edfc3bc on top of 8ca68f6.

## Fixed findings

### TW-1 / CR-1 — Secret URI options saved in the profile's connectionString and shown unmasked

Files changed:
- `packages/renderer/src/app/connections/connection-form.model.ts`
- `packages/renderer/src/app/connections/connection-editor.html`
- `packages/renderer/src/app/connections/connection-form.model.spec.ts`
- `packages/renderer/src/app/connections/connection-editor.spec.ts`

Problem:
`uriModel()` removed only the user password. `proxyPassword`, `tlsCertificateKeyFilePassword` and the `AWS_SESSION_TOKEN` auth mechanism property from a pasted URI (or an old saved profile) went verbatim into the `ProfileDraft` sent to `profiles.save` and `conn.test`, and appeared unmasked in the URI preview and URI tab.

Fix:
New `stripUriSecrets(model)` removes these secrets from the model in place (known fields, case-insensitive keys, repeated or invalid values that core keeps in `extra`, and only the secret entries of `authMechanismProperties`, keeping e.g. `SERVICE_NAME`) and returns the names of what it removed. It runs in `applyConnectionString` and `editorStateFromProfile` (so the editor state never holds such a secret) and again in `uriModel` (defense in depth for every draft and preview). `connectionStringText` additionally passes its output through core's `mask()`. The editor shows a `dropped-secrets` note ("Not stored: ... from the connection string") while the state lists removed secrets. The secrets are not routed into the keychain: `conn.test` only carries the user `password`, so typed proxy/TLS secrets cannot follow the same flow as the password; no new secret-entry UI was built (later tasks).

Validation:
- `cd packages/renderer && npx ng test --watch=false --include='src/app/connections/**/*.spec.ts'` — Pass (3 files, 112 tests, including the test-writer's `never contains secret URI options` and new per-key tests for apply, load, draft build and masked text)
- `npm run test:e2e -- test/e2e/connections.e2e.ts` — Pass (2 tests)

### CR-2 — Failed setSecret after a successful save of a new profile led to a duplicate on retry

Files changed:
- `packages/renderer/src/app/connections/connection-editor.ts`
- `packages/renderer/src/app/connections/connection-editor.spec.ts`

Problem:
The editor adopted the saved profile (id, loadedDraft, sidebar reload) only after `profiles.setSecret` succeeded; a failing setSecret left the state without the id, so pressing Save again created a second profile.

Fix:
After `profiles.save` succeeds the editor registers the profile with the safety service, reloads the sidebar and adopts the saved profile (id, base, loadedDraft) while keeping the typed password, then calls `setSecret`. A failure is shown as "Saved, but the password could not be stored: ...", with no navigation, so a retry updates the same profile and stores the password. Navigation to `/connections/:id` now depends on the route having no id (`this.id() === undefined`), so it also happens after a successful retry.

Validation:
- New spec `a failed setSecret keeps the new profile: a retry updates it instead of creating another` — Pass (second `profiles.save` carries `id: 'new-id'`, two `setSecret` calls for `new-id`, final URL `/connections/new-id`)

### CR-3 — Save results were not tied to the current load

Files changed:
- `packages/renderer/src/app/connections/connection-editor.ts`
- `packages/renderer/src/app/connections/connection-editor.spec.ts`

Problem:
A Save finishing after a route switch to another profile set the editor state to the old profile and could navigate away.

Fix:
`save()` captures `loadGeneration` and skips state, notice, error, storedSecrets and navigation updates when a newer load started; the sidebar reload and safety registration still happen. Edits made while the password was being stored are kept (the final state update only replaces the state the save itself set).

Validation:
- New spec `switching to another profile while Save runs shows the new profile, not the saved one` — Pass

### CR-5 — Ask-each-time e2e did not show that secrets.bin could change

Files changed:
- `test/e2e/connections.e2e.ts`

Problem:
`secrets.bin unchanged` was compared against a baseline that was probably `null`, so it could not fail if the environment could not write secrets.

Fix:
The test first creates a `saved`-mode control profile with a password (asserting the editor shows no `no-keychain` note), saves it and asserts that `secrets.bin` now exists and differs from before. That file becomes the baseline for the ask-each-time checks, which then go through the manager's New button.

Validation:
- `npm run test:e2e -- test/e2e/connections.e2e.ts` (int-harness mongo fixture) — Pass, 2 passed

### CR-6 — Ready editor had no level-1 heading

Files changed:
- `packages/renderer/src/app/connections/connection-editor.html`
- `packages/renderer/src/app/connections/connection-editor.css`
- `packages/renderer/src/app/connections/connection-editor.spec.ts`

Problem:
In the ready state the page heading was a `span`.

Fix:
It is now an `h1` (`.where-heading`, inline, inheriting font and color from `.where`, so the look is unchanged; no colors added). The wrapping `p` became a `div` because an `h1` cannot sit inside a `p`.

Validation:
- New spec `the ready editor has a level-1 page heading` — Pass

## Not fixed

### CR-4 — The pure form model and the manager page have no committed tests

Status:
Invalid

Reason:
Already resolved by the test-writer's committed specs (`connection-form.model.spec.ts`, `connections-page.spec.ts` in 8ca68f6), as stated by the parent worker; no change needed.

## Validation summary

Focused tests:
- `cd packages/renderer && npx ng test --watch=false --include='src/app/connections/**/*.spec.ts'` — Pass (3 files, 112 tests)

Full test suite:
- `npm run check` (eslint --max-warnings 0, prettier --check, tsc/ngc type checks of all workspaces, vitest 48 files / 2989 tests, renderer ng test 64 files / 1581 tests) — Pass
- `npm run test:e2e -- test/e2e/connections.e2e.ts` — Pass (2 passed; renderer build prints the existing initial-bundle budget warning)

Lint/type-check/build:
- Included in `npm run check` — Pass; renderer and desktop builds in `test:e2e` — Pass

`.taskcheck`:
- Pass (it runs `npm run check`, see above)

Remaining unresolved findings:
0

Task-scoped coverage was not rerun by the fixer; the test-writer's report asks for a rerun without the TW-1 filter, which is now possible because the test passes.

## Final status

All validated findings fixed and validation passed.

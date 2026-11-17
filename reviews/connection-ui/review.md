# Code Review

Date: 2026-11-17

Task: connection-ui - M1: Connection editor and manager

Scope: second review pass of the committed task changes, `git diff 9d2524478e7bf26f37e1ec73ebb4f721753be056..dd51ff0 -- packages test docs` (task commits b36d7dd, 123af50, a4388a3, 8ca68f6, dd51ff0), with a focus on whether the earlier findings CR-1..CR-6 are fixed and on the fix commit dd51ff0 (stripUriSecrets/mask, the save() order and generation guard, the setSecret failure path, the e2e secrets.bin control). On local main these commits were rebased as c0c0d72..5aa43a1. `git diff dd51ff0 5aa43a1` shows changes only in `tasks/`, so the code is the same. Uncommitted test-writer files are not part of this review.

Requirements:
- tasks/connection-ui.md (goal, 3 acceptance criteria, recorded assumptions including the 01:11 one on dropped secret URI options)
- SPEC.md M1 "Connections" (secrets only in the OS keychain, masked URIs, theme tokens)
- docs/ARCHITECTURE.md "Connection editor"
- reviews/connection-ui/review.md (first pass, CR-1..CR-6), reviews/connection-ui/fixes.md
- core `packages/core/src/uri/mask.ts`, route config `packages/renderer/src/app/app.routes.ts`

Git range:
- Branch: main
- HEAD: 26608b8 (code identical to dd51ff0)
- Base/start: 9d2524478e7bf26f37e1ec73ebb4f721753be056
- Commits reviewed: 5 (b36d7dd, 123af50, a4388a3, 8ca68f6, dd51ff0)

Commands run:
- `cd packages/renderer && npx ng test --watch=false --include='src/app/connections/connection-editor.spec.ts' --include='src/app/connections/connection-form.model.spec.ts' --include='src/app/connections/connections-page.spec.ts'` -> 3 files, 112 tests passed
- `python tasks.py verify connection-ui` -> no criterion has recorded evidence yet. This is expected before `done`, and the parent worker must record it.

Summary: 0 P0, 0 P1, 1 P2, 0 P3

## Status of the earlier findings

- CR-1 (secret URI options saved and shown unmasked): resolved. `stripUriSecrets` removes `proxy.password`, `tls.certificateKeyFilePassword`, `AWS_SESSION_TOKEN` in `auth.mechanismProperties` (case-insensitive), and the same keys when core leaves them in `extra` (repeated or invalid values, including the raw `authMechanismProperties` string). Other properties such as `SERVICE_NAME` are kept. It runs in `applyConnectionString`, in `editorStateFromProfile`, and again in `uriModel`, so every saved draft, `conn.test` draft and preview is stripped. `connectionStringText` also passes its output through core `mask()`. The editor and model specs check save, test, preview and the URI tab for each key. The note does not echo any secret value. It lists only option names.
- CR-2 (duplicate profile after a failed setSecret): resolved. After `profiles.save` succeeds, the editor adopts the saved profile (id, `loadedDraft`, safety registration, sidebar reload) before it calls `setSecret`. A failure shows "Saved, but the password could not be stored", and the typed password stays in the field. A retry sends `id: 'new-id'`, and navigation now depends on `this.id() === undefined`, so the retry still navigates. A spec covers this.
- CR-3 (Save not tied to the current load): partly resolved. A profile switch inside the same editor instance is now guarded by `loadGeneration`, and a spec covers it. The new-profile navigation case that the first review also named is still open. See CR-1 below.
- CR-4 (no model or manager tests): resolved. `connection-form.model.spec.ts` and `connections-page.spec.ts` are committed (8ca68f6, dd51ff0) and pass.
- CR-5 (weak secrets.bin evidence): resolved. The ask-each-time e2e first saves a `saved`-mode control profile, asserts that no `no-keychain` note is shown, and asserts that `secrets.bin` now exists and differs from its earlier content. That file is the baseline for the "unchanged" checks. The new save order sets the "Saved" notice only after `setSecret` returns, so the read after `saved-notice` is not racy.
- CR-6 (no h1 in the ready editor): resolved. The heading is now an `h1` inside a `div`, and a spec checks it.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | Leaving a new profile while its Save runs still navigates the user back to the saved profile**
    - File: `packages/renderer/src/app/connections/connection-editor.ts:560-566` (navigation), `:152` (destroy hook), `:498-499` (generation capture)
    - Category: Correctness
    - Problem: the generation guard only detects a switch inside the same component instance. `connections/new` and `connections/:id` are separate route configs (`app.routes.ts:38`, `:52`), so leaving `/connections/new` (for example through the sidebar's "Edit connection…" on another profile, "Manage connections", or any other page) destroys the editor. The destroy hook only aborts a running test and does not bump `loadGeneration`. When the pending `profiles.save` (and `setSecret`) of the destroyed instance resolves, `current()` is still true and `this.id()` is still `undefined`. It then calls `router.navigate(['/connections', profile.id], { replaceUrl: true })`, which replaces the page the user moved to with the new profile's editor. The first review named this case ("For a new profile it also `router.navigate`s back to the new profile's page after the user already left"). The added spec only switches the `id` input on the same instance, so it does not cover this case.
    - Why it matters: an out-of-order async result overrides the user's newer navigation. With a slow keychain or IPC, the user can end up editing a different profile than the one they opened.
    - Suggested fix: mark the instance destroyed in the `DestroyRef` callback, for example by `++this.loadGeneration` or a `destroyed` flag that `current()` checks, and skip the state, notice and navigation updates (keep the sidebar reload and safety registration). Add a spec that destroys the fixture, or navigates the router away from `/connections/new`, while `profiles.save` is pending, and asserts that the URL does not change afterwards.

## P3 Low

None.

## Checked without findings

- `stripUriSecrets` mutates only the clone in `uriModel` and the freshly parsed models in `applyConnectionString` and `editorStateFromProfile`. It never mutates the shared state. When nothing was dropped, `droppedSecrets` is removed from the state, so a later clean paste clears the note.
- `save()`: `saving` blocks double submits for the whole save plus setSecret. Every exit path, including a profile switch and both failure branches, resets `saving` in `finally`. `profiles.save` errors are reported only for the current load. Edits made while `setSecret` runs are kept (`s === pending` check). The sidebar reload and safety registration also happen when the user switched profiles.
- Mode switches on an existing profile: `storedSecrets` drops `password` when the mode is no longer `saved`. When the save is for a stale load, the guard prevents updates to the new profile's `storedSecrets`.
- Masking: `connectionStringText` masks the userinfo password (`MASK`) and, through core `mask()`, any secret query option that might still be present. No secret value appears in the `dropped-secrets` note, in errors, or in test fixtures (the fixtures use fictitious values, and the e2e passwords are generated at run time).
- Theme: the fix adds only `.where-heading` CSS, which inherits font and color and adds no literal colors.

## Review conclusion

Material issues found; fix before completing the task.

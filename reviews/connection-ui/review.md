# Code Review

Date: 2026-11-17

Task: connection-ui - M1: Connection editor and manager

Scope: committed changes of the task, `git diff a59b2e2..f4164af -- packages test docs` (connection editor, manager page, pure form model, SharedArrayBuffer stub + main.ts, sidebar entry points, routes/navigation/app.config, core `./uri` export, angular.json, e2e specs, architecture notes). The untracked `packages/renderer/src/app/connections/connection-form.model.spec.ts` present in the working tree (test-writer work in progress) is not part of the reviewed scope.

Requirements:
- tasks/connection-ui.md (goal, 3 acceptance criteria, 6 recorded assumptions)
- SPEC.md M1 "Connections" and the theme requirement (tokens only, no hard-coded colors)
- docs/ARCHITECTURE.md "Connection editor", "Sidebar tree"; contract `packages/contract/src/profiles.ts`
- backend `packages/backend/src/connections/options.ts` and `manager.ts`, desktop `apps/desktop/src/profiles/store.ts` (integration)
- docs/QUALITY.md (report contract)

Git range:
- Branch: main
- HEAD: f4164af
- Base/start: a59b2e2d5d8739329eef5c13bb945385b053b9ed
- Commits reviewed: 3 (dba5cf8, d1dd886, f4164af)

Commands run:
- `cd packages/renderer && npx ng test --watch=false --include='src/app/connections/connection-editor.spec.ts' --include='src/shared-array-buffer-stub.spec.ts'` -> 2 files, 15 tests passed
- Same command including the untracked test-writer spec `connection-form.model.spec.ts` -> 1 failed (it asserts that a profile draft built from a URI with `proxyPassword` / `tlsCertificateKeyFilePassword` contains no secret; it does, see CR-1), 60 passed

Summary: 0 P0, 1 P1, 3 P2, 2 P3

## P0 Critical

None.

## P1 High

- [ ] **CR-1 | Secrets in URI query options (proxyPassword, tlsCertificateKeyFilePassword, authMechanismProperties tokens) are written into connections.json and shown unmasked**
    - File: `packages/renderer/src/app/connections/connection-form.model.ts:164` (`uriModel`), `:276` (`profileDraftFromState` -> `toConnectionString(model)`), `:180` (`connectionStringText`)
    - Category: Security
    - Problem: `uriModel()` removes only `model.password`. Core's `ConnectionUriModel` also carries `proxy.password` (`proxyPassword`), `tls.certificateKeyFilePassword` (`tlsCertificateKeyFilePassword`) and `auth.mechanismProperties` (which may hold `AWS_SESSION_TOKEN`), and `toConnectionString()` serializes all of them (`packages/core/src/uri/convert.ts:219-222`, `:309-312`). A URI pasted into the Connection string tab such as `mongodb://alice@h/?proxyHost=p&proxyUsername=u&proxyPassword=...` therefore ends up verbatim in `draft.connectionString`. The contract's guard `hasPassword()` (`packages/contract/src/profiles.ts:50`) only checks the userinfo, and `ProfilesStore.save` accepts it, so the secret is persisted in plain text in `connections.json` (and sent in `conn.test` drafts). `connectionStringText()` also prints these values unmasked in the URI preview strip and the URI tab, although core offers `mask()` for exactly these keys. The untracked test-writer spec reproduces it: the saved draft contained `tlsCertificateKeyFilePassword=fictitious-Pa55&...&proxyPassword=fictitious-Pa55`.
    - Why it matters: SPEC M1 "Secrets (passwords, key passphrases, tokens) only in the OS keychain ... profiles without secrets in connections.json"; SPEC line 267 "logs and error messages mask passwords in URIs". The editor's own doc claims `profileDraftFromState` "Never contains the password".
    - Suggested fix: in `uriModel()` (or before building the saved/tested draft) strip `proxy.password`, `tls.certificateKeyFilePassword` and secret `mechanismProperties` entries; either move them into the matching secret kinds (`proxyPassword`, `tlsKeyPassphrase`, ...) via `profiles.setSecret` on Save, like the user password, or refuse them with an editor problem. Render the preview/URI tab with these values masked. Add a model/component test for each key.

## P2 Medium

- [ ] **CR-2 | New profile: a failed setSecret after a successful profiles.save leaves the editor without the new id, so retrying Save creates a duplicate profile**
    - File: `packages/renderer/src/app/connections/connection-editor.ts:499-536`
    - Category: Correctness
    - Problem: `save()` first awaits `profiles.save` (profile created, id assigned by main), then `profiles.setSecret`. If `setSecret` throws (keychain locked/failing, `SecretStorageUnavailableError`), the catch only sets `saveError`; `state` keeps `id: undefined`, `loadedDraft` stays stale and no navigation happens. Pressing Save again sends a draft without `id`, so main creates a second profile. The sidebar is not reloaded either, so the first copy is invisible until the next reload.
    - Why it matters: double profiles on a recoverable error path; the user cannot tell the profile was already created.
    - Suggested fix: after `profiles.save` succeeds, adopt the returned profile (id, `loadedDraft`, safety registration, `reloadProfiles`) before calling `setSecret`, and report a setSecret failure as "saved, but the password could not be stored"; add a test with a failing `profiles.setSecret`.

- [ ] **CR-3 | A Save answer is not tied to the current load: switching profiles while Save runs shows the old profile under the new route**
    - File: `packages/renderer/src/app/connections/connection-editor.ts:515-534`
    - Category: Correctness
    - Problem: `loadProfile()` guards its answers with `loadGeneration`, and aborts a running test, but `save()` does not check the generation after its awaits. If the route switches to another profile (same editor instance via `withComponentInputBinding`, e.g. the sidebar's "Edit connection…" on another connection) while Save is in flight, the finishing save sets `state` to the previously edited profile A while `id()` is B (or, if B's load finishes later, the order decides what is shown). Editing and saving then writes to A under B's URL. For a new profile it also `router.navigate`s back to the new profile's page after the user already left.
    - Why it matters: out-of-order async results can make the user edit the wrong profile.
    - Suggested fix: capture `loadGeneration` at the start of `save()` and skip the state/notice/navigation updates when it changed (still reload the sidebar); add a spec that switches `id` while `profiles.save` is pending.

- [ ] **CR-4 | The pure form model and the manager page have no committed tests**
    - File: `packages/renderer/src/app/connections/connection-form.model.ts`, `packages/renderer/src/app/connections/connections-page.ts`
    - Category: Tests
    - Problem: the committed specs cover the editor component only. The model's precedence rules (`editorStateFromProfile`: profile fields win over URI options; mechanism mapping incl. non-form mechanisms such as MONGODB-X509/PLAIN), `profileDraftFromState` mirroring (TLS key file kept only with a certificate file, read preference tags, write concern, timeouts, proxy, SSH) and `hostSummary`/`folderNames`, plus `groupByFolder` and delete (disconnect, close tabs) on the manager page, have no tests. CR-1 is exactly the kind of defect such tests catch (the untracked test-writer spec already found it).
    - Why it matters: this is the mapping the backend's `clientConfig` consumes; regressions there change what the driver connects with.
    - Suggested fix: commit model unit tests and a `ConnectionsPage` spec (grouping order, delete confirm closes the profile's tabs and reloads the sidebar, duplicate navigates to the copy).

## P3 Low

- [ ] **CR-5 | The ask-each-time e2e does not show that secrets.bin would change at all in this environment**
    - File: `test/e2e/connections.e2e.ts:106-143`
    - Category: Tests
    - Problem: "secrets.bin unchanged" is asserted against `before`, which is likely `null`, and no test in the file saves a password in `saved` mode (in the e2e environment the default is probably `ask` because the keychain is weak or unavailable). The assertion cannot fail if the secret store cannot write in this setup, so it does not prove the ask path skips a write that would otherwise happen.
    - Why it matters: criterion 3 evidence is weaker than it reads.
    - Suggested fix: add a control step (a `saved`-mode profile with a password, asserting secrets.bin changes) or assert the reported storage level; record the storage level in the verify evidence.

- [ ] **CR-6 | The ready editor has no level-1 heading**
    - File: `packages/renderer/src/app/connections/connection-editor.html:40-41`
    - Category: Quality
    - Problem: in the loading and error states the page heading is an `h1` element (`data-testid="page-heading"`), but in the ready state the heading text is a `span` while the sections use `h2` elements. Screen-reader heading navigation lands on h2 groups without a page heading. (Tabs themselves are fine: roving tabindex, arrow keys, `aria-selected`/`aria-controls`.)
    - Why it matters: minor accessibility inconsistency with the other pages.
    - Suggested fix: make the "New connection"/"Edit connection" line an `h1` (visually styled as now).

## Checked without findings

- Password never in the saved `connectionString` or in `connections.json` for the userinfo password (model `uriModel(state, undefined)`, contract `hasPassword` guard, component and e2e assertions); `setSecret` only for `saved` with a typed password.
- Mode switches on an existing profile: `ProfilesStore.save` deletes the stored password when `secretMode` stops being `saved` (`apps/desktop/src/profiles/store.ts:262-269`); the editor updates `storedSecrets` accordingly.
- `conn.test`: `{ profileId }` only while the loaded draft is unchanged and no password typed; otherwise a draft with `id` plus the typed password; the backend's `matchesSaved` keeps stored secrets away from a changed target, and ask mode drops a stored password (`manager.ts:278`).
- Profile fields vs URI vs `clientConfig`: the form mirrors auth, TLS, read preference/tags, write concern, app name, timeouts and proxy into profile fields, which `clientConfig` passes as driver options; SSH and `tls.keyFile` are kept from the loaded profile.
- Editor load: generation counter drops stale `profiles.get` answers; a running test is aborted on profile switch and on destroy; CANCELLED returns to idle.
- SharedArrayBuffer stub: installed only when the global is missing; `webidl-conversions` calls the getters inside try/catch, so the throwing getters mean "not shared"; construction throws; bson detects buffers via `toStringTag`, unaffected.
- Theme: every `var(--...)` used in the new CSS is defined in the token sets (or locally: `--profile-color`, `--swatch`, `--spine`); the only literal colors are the `PROFILE_COLORS` presets (recorded assumption).
- Routes: `connections/new` and `connections/import/compass` precede `connections/:id`; lazy loading keeps `whatwg-url` out of the initial bundle.
- Acceptance-criteria evidence: `python tasks.py verify connection-ui` shows none recorded yet; the parent must still record it (criteria 2 and 3 require running the e2e against the mongo fixture).

## Review conclusion

Material issues found; fix before completing the task.

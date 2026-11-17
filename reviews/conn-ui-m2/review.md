# Code Review

Date: 2026-11-17

Task: conn-ui-m2 - M2: Connection editor for SSH, X.509, proxy and read preference

Scope: `git diff f94e6cf..aa77cf8` (task code commits a9c1310, 0c7ce7e, 7fceb46, test-writer c05e8df, fixes aa77cf8; 2df263b holds only the first review report). Re-review of the final code with focus on the commits after 7fceb46; production code: `packages/renderer/src/app/connections/` (connection-form.model.ts, connection-editor.ts/.html/.css, host-key.service.ts, host-key-dialog.ts/.css), `packages/renderer/src/app/layout/app-shell.ts`, `test/e2e/ssh.e2e.ts`, `test/integration/fixtures/ssh.ts`.

Reviewed revision: aa77cf816cbef0c84eaf4d15d1c6f8ae824c2cea

Requirements:
- tasks/conn-ui-m2.md (goal, 2 acceptance criteria, CR-2/CR-3 constraints from the x509-proxy review, recorded assumptions)
- SPEC.md, docs/ARCHITECTURE.md, AGENTS.md, docs/QUALITY.md
- packages/contract/src/profiles.ts (profileSsh, profileTls, profileProxy, readPreferenceTagSet, profileWriteConcern, SECRET_KINDS), packages/contract/src/conn.ts (sshHostKeyPrompt, conn.test, conn.trustHostKey)
- Backend consumers: packages/backend/src/connections/options.ts, packages/backend/src/connections/manager.ts, packages/backend/src/ssh/tunnel.ts
- reviews/conn-ui-m2/fixes.md (fixer's account, checked against the code)

Git range:
- Branch: main (local, task work not yet pushed)
- HEAD: aa77cf816cbef0c84eaf4d15d1c6f8ae824c2cea
- Base/start: f94e6cf312b7efef453e423d6a70bafc02d1e8ab
- Commits reviewed: 6 (5 with code or tests)
- Uncommitted changes: none at review start

Commands run (read-only):
- `git diff 7fceb46..aa77cf8` and `git diff f94e6cf..aa77cf8`: read in full for production files
- `cd packages/renderer && npx ng test` -> 73 test files, 2228 tests passed

Summary: 0 P0, 0 P1, 0 P2, 0 P3 open (4 P3 from the first pass, all resolved)

## What was checked

- Secrets: typed SSH password, SSH key passphrase, client key passphrase and proxy password live only in `EditorState.secrets`. `profileDraftFromState` and `connectionStringText` never read them. `stripUriSecrets` still removes `proxyPassword`, `tlsCertificateKeyFilePassword` and `AWS_SESSION_TOKEN`. Secrets are stored only with `profiles.setSecret`, using kinds from `SECRET_KINDS`, and only those the current settings use. These match what the backend reads. Copy puts the masked text on the clipboard. No logging or debug output was added. The e2e checks that `connections.json` does not contain the generated SSH password.
- CR-2/CR-3 constraints from the x509-proxy review: `editorProblems` refuses `tlsKeyFile` without `certificateKeyFile`, and refuses tags when the read preference is unset or `primary`. The draft also drops both in those cases. Tag sets map to `{ name, value }` pairs.
- Contract alignment: draft `ssh`, `proxy`, `readPreferenceTags` and `writeConcern` match the zod schemas. `conn.test` still sends exactly one of `profileId` and `profile`.
- Host key dialog: `role="alertdialog"`, `aria-modal`, labelled and described. "Don't trust" gets focus first, Escape rejects, Tab stays inside, and focus is returned on close. AppShell makes the rest of the window inert, and shortcuts are suppressed through `modal()`; the new app-shell spec covers both.
- Theme: all colors in the new CSS use tokens that exist in `app/theme/tokens.css`.
- Tests: model, component, dialog and app-shell specs cover SSH, proxy, X.509, tags and write-concern validation, URI sync in both directions, secret exclusion and storage, and the dialog's focus, queueing, errors and timeouts. The e2e creates and saves the profile, trusts the host key, connects, reconnects without a prompt, and runs Test connection through the tunnel.
- Note for the parent: the e2e skips itself when no container runtime is available. Evidence for criterion 1 must come from a run that executed it, not one that skipped.

## Status of the first-pass findings

- [x] **CR-1 | Empty SSH port is refused although the field shows 22 as its default** (P3, Correctness): **resolved**. `connection-form.model.ts:413` now validates `ssh.port ?? SSH_DEFAULT_PORT`, the same as the proxy port. `connection-form.model.spec.ts:594-596` and `connection-editor.spec.ts:1258` check that an empty port is accepted and saved as 22. 0, 65536, 22.5 and text are still refused.
- [x] **CR-2 | Switching to X.509 keeps a hidden authSource in the connection string** (P3, Correctness): **resolved**. `setMechanism` deletes `auth.source` when X.509 is chosen (`connection-editor.ts:371`). `uriModel` drops it for X.509, so a pasted or loaded `authSource` cannot reach the preview, the copied string or the saved string (`connection-form.model.ts:302`). The draft never sets `auth.authSource` for X.509 (`:498`), and the backend still uses `$external`. Covered by `connection-form.model.spec.ts:710` and `connection-editor.spec.ts:971`.
- [x] **CR-3 | Host key dialog loses keyboard focus while an answer is being sent** (P3, Accessibility): **resolved**. `answer()` focuses the dialog container (`tabindex="-1"`, which has the keydown handler) before the buttons are disabled. While busy, Escape is ignored by the `busy()` guard. A second `afterRenderEffect` puts focus back on "Don't trust" after a failed answer, unless the user already moved focus to another element in the dialog (`host-key-dialog.ts:130-146`). Covered by `host-key-dialog.spec.ts:136`.
- [x] **CR-4 | Dropped-secret note points to fields that may not exist** (P3, Quality): **resolved**. The note mentions a field only when `proxyPassword` or `tlsCertificateKeyFilePassword` was dropped (`droppedHasField`, `connection-editor.ts:179`). The `AWS_SESSION_TOKEN` case gets only the "not stored" sentence. Covered by `connection-editor.spec.ts:859`. A small gap remains, too minor for a new finding: the proxy password and key passphrase fields only appear once a proxy user, or TLS with a client certificate, is set, so "below" can point to a field that is not shown yet.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

None open. The fix commits introduced no new issues: the changes are limited to the four findings above, with matching tests, and the full renderer suite passes.

## Review conclusion

No material issues found.

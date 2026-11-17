# Code Review

Date: 2026-11-17

Task: conn-ui-m2 - M2: Connection editor for SSH, X.509, proxy and read preference

Scope: `git diff f94e6cf..HEAD` (task commits a9c1310, 0c7ce7e, 7fceb46), production code reviewed primarily: `packages/renderer/src/app/connections/` (connection-form.model.ts, connection-editor.ts/.html/.css, host-key.service.ts, host-key-dialog.ts/.css), `packages/renderer/src/app/layout/app-shell.ts`, `test/e2e/ssh.e2e.ts`, `test/integration/fixtures/ssh.ts`. Specs read for coverage of the acceptance criteria only.

Requirements:
- tasks/conn-ui-m2.md (goal, 2 acceptance criteria, CR-2/CR-3 constraints from the x509-proxy review, recorded assumptions)
- SPEC.md, docs/ARCHITECTURE.md, AGENTS.md, docs/QUALITY.md
- packages/contract/src/profiles.ts (profileSsh, profileTls, profileProxy, readPreferenceTagSet, profileWriteConcern, SECRET_KINDS), packages/contract/src/conn.ts (sshHostKeyPrompt, conn.test, conn.trustHostKey)
- Backend consumers: packages/backend/src/connections/options.ts, packages/backend/src/connections/manager.ts (stored-secret rules for drafts), packages/backend/src/ssh/tunnel.ts

Git range:
- Branch: main (local, task work not yet pushed)
- HEAD: 7fceb46
- Base/start: f94e6cf312b7efef453e423d6a70bafc02d1e8ab
- Commits reviewed: 3
- Uncommitted changes: none at review start

Summary: 0 P0, 0 P1, 0 P2, 4 P3

## What was checked

- Secrets: typed SSH password, SSH key passphrase, client key passphrase and proxy password live only in `EditorState.secrets`; `profileDraftFromState` and `connectionStringText` never read them; `stripUriSecrets` still removes `proxyPassword` / `tlsCertificateKeyFilePassword` / `AWS_SESSION_TOKEN` from the URI and draft. Secrets are stored only via `profiles.setSecret` with kinds from `SECRET_KINDS`, and only the kinds the current settings use (`usedSecretKinds`), matching what the backend reads (`sshPassword`, `sshKeyPassphrase`, `tlsKeyPassphrase`, `proxyPassword`). The copy button copies the masked text. No logging or debug output added. The e2e reads `connections.json` and asserts the generated SSH password is absent.
- CR-2 / CR-3 constraints: `editorProblems` refuses `tlsKeyFile` without `certificateKeyFile` and tags with mode unset/`primary`; the draft additionally drops tags in those cases and drops `keyFile` without a certificate. Tag sets map to `{ name, value }` pairs; empty tag names are refused.
- Contract alignment: draft `ssh` matches `profileSsh` (port defaulted, `privateKeyFile` only for `privateKey`); `proxy` matches `profileProxy` (default 1080); `writeConcern.w` number/string as allowed; `conn.test` still sends exactly one of `profileId`/`profile`.
- Save flow: extra secrets are stored after the profile is adopted, failures are reported per kind and keep the typed values for a retry; stale-generation guards are kept.
- Host key dialog: `role="alertdialog"`, `aria-modal`, labelled/described, "Don't trust" focused first, Escape rejects (propagation stopped), Tab trapped, focus returned on close; queue in arrival order, de-duplicated, timers per prompt, NOT_FOUND closes the question, other errors are shown. AppShell makes sidebar, splitter, work area and status bar inert while it is open, and global shortcuts are suppressed through `modal()`.
- Theme: all colors in the new CSS use tokens that exist in `app/theme/tokens.css` (`--accent-soft`, `--accent-contrast`, `--danger-bg`, `--shadow-pop`, ...); no hard-coded colors.
- Tests: model and component specs cover SSH/proxy/X.509/tags/write-concern validation, URI sync in both directions, secret exclusion and secret storage; the dialog spec covers focus, Escape, queueing, NOT_FOUND, errors and timeout; the e2e creates, saves, trusts the host key, connects, reconnects without a prompt and runs Test connection through the tunnel.
- Note for the parent: `python tasks.py verify conn-ui-m2` shows both criteria unverified at review time; the e2e skips itself when no container runtime is available, so criterion 1 needs a run that actually executed (not skipped).

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

- [ ] **CR-1 | Empty SSH port is refused although the field shows 22 as its default**
    - File: `packages/renderer/src/app/connections/connection-form.model.ts:410`
    - Category: Correctness
    - Problem: `editorProblems` checks `validPort(ssh.port)`, so clearing the SSH port field (whose placeholder is `sshDefaultPort`, `connection-editor.html:346`) blocks save/test with "The SSH port is a whole number from 1 to 65535." The draft code (`connection-form.model.ts:554`, `ssh.port ?? SSH_DEFAULT_PORT`) and the proxy validation (`:420`, `model.proxy.port ?? PROXY_DEFAULT_PORT`) both treat an empty port as the default, so the fallback in the draft is dead code and the two port fields behave differently. The spec at `connection-form.model.spec.ts:589` locks in `undefined` as an error.
    - Why it matters: A user who clears the field, seeing "22" as placeholder, gets an error that contradicts the UI; inconsistent behavior between the SSH and proxy port fields.
    - Suggested fix: Validate `ssh.port ?? SSH_DEFAULT_PORT` (as for the proxy) and adjust the spec, or drop the placeholder/default fallback and keep the field required.

- [ ] **CR-2 | Switching to X.509 keeps a hidden authSource in the connection string**
    - File: `packages/renderer/src/app/connections/connection-editor.ts:354` (with `connection-editor.html:510`)
    - Category: Correctness
    - Problem: `setMechanism` deletes `model.auth.source` only for `NONE`. For `MONGODB-X509` the template hides the "Authentication database" field, but an auth source typed earlier (e.g. `admin` from a SCRAM setup or a pasted URI) stays in the model, so the preview, the copied string and the saved `connectionString` contain `authSource=admin&authMechanism=MONGODB-X509`. The backend overrides it with `$external` (`packages/backend/src/connections/options.ts:111`), but the user can neither see nor clear the value in the form, and the copied connection string is one the Node driver rejects for X.509 (the backend comment there notes another authSource "only makes the driver refuse").
    - Why it matters: The "copyable connection string" feature yields a string that fails outside Thicket, caused by a field the user cannot see.
    - Suggested fix: Delete `model.auth.source` (or set `$external`) when switching to `MONGODB-X509`, and/or show the field read-only; add a model or component test.

- [ ] **CR-3 | Host key dialog loses keyboard focus while an answer is being sent**
    - File: `packages/renderer/src/app/connections/host-key-dialog.ts:64` and `:73`
    - Category: Quality (accessibility)
    - Problem: Both buttons get `[disabled]="hostKeys.busy()"`. Disabling the focused button makes the browser move focus to `body`, outside the dialog's `(keydown)` handler, so Escape and the Tab trap stop working. When the answer fails with a non-NOT_FOUND error, `busy` returns to false and the error is shown, but focus is not put back into the dialog (the `afterRenderEffect` only refocuses when the prompt id changes).
    - Why it matters: Keyboard and screen reader users lose their place in a modal security prompt after a failed answer and must tab back into it.
    - Suggested fix: Keep the buttons focusable while busy (e.g. `aria-disabled` and ignore clicks in `answer`, which already guards `busy()`), or move focus to the dialog container/the reject button when the error appears; add a spec assertion on focus after a failed answer.

- [ ] **CR-4 | Dropped-secret note points to fields that may not exist**
    - File: `packages/renderer/src/app/connections/connection-editor.html:131`
    - Category: Quality
    - Problem: The note now says "enter them in the proxy password or key passphrase field" for every dropped option, including `authMechanismProperties AWS_SESSION_TOKEN` (no such field in this editor), and for `proxyPassword` / `tlsCertificateKeyFilePassword` the target fields are only shown when a proxy user, or TLS with a client certificate, is set (`usedSecretKinds`).
    - Why it matters: Misleading guidance about where a secret can be entered; minor.
    - Suggested fix: Name the field per dropped option (proxy password -> "Proxy password", certificate key password -> "Key passphrase"), and keep the generic "not stored" wording for options without a field.

## Review conclusion

No material issues found. The four P3 findings are non-blocking cleanups; the parent should still record executed (not skipped) evidence for both acceptance criteria before completing the task.

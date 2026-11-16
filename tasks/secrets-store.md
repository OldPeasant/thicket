---
title: M1: Secrets in the OS keychain via safeStorage
status: in_progress
owner: dell26/agent-2
deps: [electron-shell]
touches: [apps/desktop/src/secrets]
prio: 1
lease_until: 2026-11-16T19:17:02Z
---
## Goal
secrets.bin encrypted with safeStorage, keyed by profile id; detection of Linux `basic_text` backend; served to the backend over the privileged port only.

## Acceptance criteria
- [ ] Unit tests with a fake safeStorage: set/get/delete, file corruption handled
- [ ] On `basic_text` the status API reports `weak` and profiles default to not saving passwords (test)
- [ ] Renderer cannot request a secret: contract test shows no renderer-routable method returns a secret

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-16 19:43+0100 by dell26/agent-2): Status API is a new main-routed contract method profiles.secretStorage -> { level: secure|weak|unavailable, backend, defaultSecretMode: saved|ask }; the contract had no status method and SPEC lists profiles.* as main's group
- ASSUMPTION (2026-11-16 19:43+0100 by dell26/agent-2): On Linux basic_text (and 'unknown') the store calls safeStorage.setUsePlainTextEncryption(true) so a user who explicitly chooses 'save' can still store secrets (reported weak, setSecret returns secureStorage:false); with no encryption at all setSecret fails with UNSUPPORTED
- ASSUMPTION (2026-11-16 19:43+0100 by dell26/agent-2): secrets.bin is one JSON document encrypted as a whole (hides profile ids too); a file that fails to decrypt/parse is renamed to secrets.bin.corrupt-<timestamp> and the store starts empty, rather than refusing to start
- ASSUMPTION (2026-11-16 19:43+0100 by dell26/agent-2): profiles.setSecret/clearSecret handlers are served now without checking that the profile exists; profiles-store should add that check and call SecretsStore.delete(id) on profiles.delete
- ASSUMPTION (2026-11-16 19:52+0100 by dell26/agent-2): Refines the move-aside assumption: on a weak backend (basic_text) a secrets.bin that cannot be decrypted is left in place and the store is locked for the session (reads empty, set/clear -> UNSUPPORTED), since it was most likely written with a keyring absent this session; only secure-backend decrypt failures and invalid content are moved aside
- ASSUMPTION (2026-11-16 19:56+0100 by dell26/agent-2): Keyring vs corrupt on weak backends is told apart by Chromium os_crypt's ciphertext prefix (v10 = basic_text, verified on Electron 45 by secrets.electron.spec.ts; v11 = libsecret/KWallet key, from Chromium source, not verifiable here without a keyring): only undecryptable v11 files lock the store, everything else is moved aside

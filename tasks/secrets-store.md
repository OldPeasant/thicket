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
- [x] Unit tests with a fake safeStorage: set/get/delete, file corruption handled
  - verified (2026-11-16 19:59+0100 by dell26/agent-2): npx vitest run --project desktop --project contract -> 865 passed; apps/desktop/src/secrets/store.spec.ts (FakeSafeStorage: set/get/delete, overwrite, persistence without plain text, 0600 + atomic temp/rename, concurrency, corrupt files of 15+ kinds moved aside to secrets.bin.corrupt-<time> and store keeps working, weak-backend v11 lock vs v10/garbage moved aside); store.ts coverage 145/146 stmts, 124/124 lines
- [x] On `basic_text` the status API reports `weak` and profiles default to not saving passwords (test)
  - verified (2026-11-16 19:59+0100 by dell26/agent-2): store.spec.ts 'Linux basic_text is weak: profiles default to not saving passwords' + handlers.spec.ts profiles.secretStorage -> {level:'weak', backend:'basic_text', defaultSecretMode:'ask'} pass; real Electron 45: npm run test:electron (secrets.electron.spec.ts with --password-store=basic, temp --user-data-dir) -> 17 passed, status weak/basic_text/ask, setSecret -> secureStorage:false
- [x] Renderer cannot request a secret: contract test shows no renderer-routable method returns a secret
  - verified (2026-11-16 19:59+0100 by dell26/agent-2): packages/contract/src/no-secrets.spec.ts walks every renderer-routable method's result/stream schema and all broadcast payloads -> no text field named like a secret (self-test finds secrets.get, which is privileged-only and unroutable); apps/desktop/src/secrets/no-secrets-to-renderer.spec.ts serves main's renderer port with a stored secret -> secrets.get/main.ping UNKNOWN_METHOD, no response contains the value; npm run test:electron -> renderer secrets.get refused UNKNOWN_METHOD; all pass

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-16 19:43+0100 by dell26/agent-2): Status API is a new main-routed contract method profiles.secretStorage -> { level: secure|weak|unavailable, backend, defaultSecretMode: saved|ask }; the contract had no status method and SPEC lists profiles.* as main's group
- ASSUMPTION (2026-11-16 19:43+0100 by dell26/agent-2): On Linux basic_text (and 'unknown') the store calls safeStorage.setUsePlainTextEncryption(true) so a user who explicitly chooses 'save' can still store secrets (reported weak, setSecret returns secureStorage:false); with no encryption at all setSecret fails with UNSUPPORTED
- ASSUMPTION (2026-11-16 19:43+0100 by dell26/agent-2): secrets.bin is one JSON document encrypted as a whole (hides profile ids too); a file that fails to decrypt/parse is renamed to secrets.bin.corrupt-<timestamp> and the store starts empty, rather than refusing to start
- ASSUMPTION (2026-11-16 19:43+0100 by dell26/agent-2): profiles.setSecret/clearSecret handlers are served now without checking that the profile exists; profiles-store should add that check and call SecretsStore.delete(id) on profiles.delete
- ASSUMPTION (2026-11-16 19:52+0100 by dell26/agent-2): Refines the move-aside assumption: on a weak backend (basic_text) a secrets.bin that cannot be decrypted is left in place and the store is locked for the session (reads empty, set/clear -> UNSUPPORTED), since it was most likely written with a keyring absent this session; only secure-backend decrypt failures and invalid content are moved aside
- ASSUMPTION (2026-11-16 19:56+0100 by dell26/agent-2): Keyring vs corrupt on weak backends is told apart by Chromium os_crypt's ciphertext prefix (v10 = basic_text, verified on Electron 45 by secrets.electron.spec.ts; v11 = libsecret/KWallet key, from Chromium source, not verifiable here without a keyring): only undecryptable v11 files lock the store, everything else is moved aside

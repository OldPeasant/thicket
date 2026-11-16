---
title: M2: X.509, SOCKS5 proxy, read preference and write concern
status: in_progress
owner: felix/agent-2
deps: [conn-manager]
touches: [packages/backend/src/connections/options,test/integration/fixtures/x509]
prio: 2
lease_until: 2026-11-16T23:51:56Z
---
## Goal
Client certificate (cert+key or PEM bundle with passphrase) and MONGODB-X509 auth; SOCKS5 proxy options; read preference/tags and write concern from the profile.

## Acceptance criteria
- [x] Integration tests: X.509 user authenticates with generated client cert; wrong cert → AUTH_FAILED
  - verified (2026-11-17 00:32+0100 by felix/agent-2): npx vitest run --config test/integration/vitest.config.ts x509 proxy (Docker fixtures) -> 2 files, 18 passed; x509.int.spec.ts: generated client cert (PEM bundle, encrypted bundle, separate cert/key) authenticates; same-CA cert without user and mismatching user name -> AUTH_FAILED
- [x] Proxy: connection through a SOCKS5 container works (int test)
  - verified (2026-11-17 00:32+0100 by felix/agent-2): npx vitest run --config test/integration/vitest.config.ts x509 proxy (Docker, serjs/go-socks5-proxy fixture) -> 18 passed; proxy.int.spec.ts 'SOCKS5 proxy': connects through the SOCKS5 container to a replica set whose member names resolve only behind the proxy (without proxy -> DNS_ERROR)
- [ ] secondaryPreferred read preference routes reads to a secondary (int test checks `hello.me`)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 00:14+0100 by felix/agent-2): Contract: profile gains proxy {host, port, username?} (password = new secret kind proxyPassword, only from stored secrets), readPreferenceTags as arrays of {name,value} pairs (the contract test forbids free-form records), writeConcern {w, journal, wtimeoutMS} and tls.keyFile for separate cert/key files. Renderer form fields come with conn-ui-m2.
- ASSUMPTION (2026-11-17 00:14+0100 by felix/agent-2): MONGODB-X509 always sends authSource $external (other values would only make the driver refuse), needs tls.enabled + certificateKeyFile (AUTH_FAILED otherwise), ignores secretMode/password, and sends the user name only when the profile has one.
- ASSUMPTION (2026-11-17 00:14+0100 by felix/agent-2): Separate cert + key files are read by clientConfig (readFileSync, driver cert/key/passphrase options) because the driver only reads PEM bundles itself; an unreadable file is TLS_ERROR.
- ASSUMPTION (2026-11-17 00:14+0100 by felix/agent-2): Server UserNotFound (code 11) maps to AUTH_FAILED only for connect errors (X.509 subject without a user); browse keeps it SERVER_ERROR. ERR_OSSL_* (wrong key passphrase) is TLS_ERROR. A client certificate from a foreign CA is answered by mongod with a closed socket, so it surfaces as TIMEOUT/NETWORK_ERROR, not as a TLS code.
- ASSUMPTION (2026-11-17 00:14+0100 by felix/agent-2): AC3 is met at driver level (client read preference: driver find/hello with client.readPreference go to the secondary). The backend's raw db.command reads/writes ignore client read preference/write concern; follow-up task raw-cmd-read-pref created instead of widening this task into docs/browse.
- ASSUMPTION (2026-11-17 00:14+0100 by felix/agent-2): SOCKS5 int fixture uses docker.io/serjs/go-socks5-proxy:latest (small, user/password auth via env) on a private network with a 2-member replica set whose names resolve only behind the proxy.

# Architecture

Status: **M0 in progress** — the workspace scaffold and the Angular renderer shell exist;
the other M0 tasks create the rest of what this file describes. Keep this
file current when the structure changes: agents read it before every task.

## Stack
| Part | Choice |
|---|---|
| Runtime | Node 24 LTS, npm workspaces (one root `package-lock.json`) |
| Desktop shell | Electron (current stable), packaged with electron-builder |
| UI | Angular 22, standalone components, signals (as in JSON Canopy) |
| MongoDB | official `mongodb` Node driver, `bson`, `mongodb-connection-string-url` |
| SSH tunnels | `ssh2` |
| Shell-syntax parsing | own parser in `packages/core/src/shellsyntax` (no `eval`; see below) |
| Schema analysis | `@mongodb-js/mongodb-schema` |
| Embedded shell | mongosh packages (`@mongosh/service-provider-node-driver`, the browser/Electron runtime) — confirm with a spike task in M4 |
| Contract validation | `zod` |
| Tests | Vitest (+ `@vitest/coverage-v8`), Testcontainers, Playwright (`_electron`) |
| Lint/format | ESLint (typescript-eslint, angular-eslint), Prettier |

Versions installed by the scaffold (root `devDependencies`): TypeScript `~6.0.3` (Angular 22 and
typescript-eslint 8 both require `<6.1`, so not TypeScript 7), Vitest + `@vitest/coverage-v8` 5.1,
ESLint 10 flat config (`eslint.config.mjs`) with typescript-eslint 8.72 `strict` + `stylistic`
(not type-aware, to keep the check fast), `eslint-config-prettier`, Prettier 3.10, `@types/node` 24.
Vitest uses `test.projects` in the root `vitest.config.ts` (`vitest.workspace.ts` is deprecated);
each workspace's `vitest.config.ts` calls `workspaceConfig()` from `vitest.shared.ts`.
Workspace packages are named `@thicket/<folder>` and export their TypeScript source
(`"exports": "./src/index.ts"`) until a build task needs compiled output.

Renderer (`packages/renderer`, an Angular CLI workspace with its own `angular.json`): Angular
22.2, standalone components, signals, zoneless (`provideZonelessChangeDetection`, no zone.js),
`@angular/build` (esbuild). Its specs run with `ng test` (`@angular/build:unit-test`, Vitest
runner, jsdom, AOT-compiled templates so `templateUrl`/`styleUrl` work), not with the root Vitest
projects; the root `test` script runs `vitest run` and then `npm run test -w packages/renderer`.
Spec files may use Vitest globals or import from `vitest`. `typecheck` runs `ngc` with
`strictTemplates` (template type errors) and `tsc` for the specs.
- `npm run build -w packages/renderer`: production build into `packages/renderer/dist/`
  (`index.html` at the top, `<base href="./">`, relative asset URLs) for Electron's `loadFile`.
- `npm run dev -w packages/renderer`: `ng serve` on http://localhost:4200.
- No network resources: the Tron fonts (Orbitron, Share Tech Mono) are committed woff2 files in
  `packages/renderer/src/assets/fonts/`, referenced by relative `url()` in `src/styles.css` and
  bundled by the build into `dist/media/`, never loaded from a CDN. Their SIL OFL 1.1 text with
  the copyright lines (`src/assets/fonts/OFL.txt`) is copied next to them into `dist/media/OFL.txt`
  (`assets` in `angular.json`);
  `src/no-network.spec.ts` fails on remote `src`/`href`/`url()`/`@import` in `src/`. The CSP
  meta tag in `src/index.html` is `default-src 'self'; script-src 'self'` (+ inline styles, which
  Angular's component styles need).

Library choices other than Electron, Angular and the MongoDB driver may be changed by the M0 stack
task if it finds a better fit; record the change here and with `tasks.py assume`.

## Layout
```
apps/desktop/          Electron main process, preload script, electron-builder config, app icons
packages/contract/     IPC envelope, method/param/result types, zod schemas, error codes
packages/core/         pure TS, no Electron/Node APIs: BSON value model, diff → update ops,
                       conflict filters, shell-syntax ⇄ EJSON, paging math
packages/backend/      runs in an Electron utilityProcess: driver connections, SSH tunnels,
                       cursors/streams, import/export, schema analysis, mongosh host
packages/renderer/     Angular app; src/app/explorer/ is the copied and extended JSON Canopy explorer
test/integration/      Testcontainers fixtures and integration tests (npm run test:int)
test/e2e/              Playwright Electron tests (npm run test:e2e)
docs/                  this file, design notes
tasks/                 TFP task board (managed by tasks.py, never edited by hand for status)
```

## Processes
```
┌──────────── renderer (Angular, sandboxed) ────────────┐
│  window.thicket.request / cancel / on   (preload)     │
└───────────────┬───────────────────────────────────────┘
                │ MessagePort (contract envelope, EJSON text for documents)
┌───────────────┴──────── backend (utilityProcess) ─────┐
│  driver clients, ssh2 tunnels, cursors, mongosh        │
└───────────────┬───────────────────────────────────────┘
                │ privileged port (secrets, file dialogs, settings)
┌───────────────┴──────── main process ─────────────────┐
│  windows, menus, safeStorage (secrets.bin), dialogs,   │
│  connections.json, update check                        │
└────────────────────────────────────────────────────────┘
```
- `safeStorage` only works in the main process: the backend asks main for a profile's secrets
  when it connects, over a port the renderer can't reach. Secrets never go to the renderer.
- The main process brokers the renderer ↔ backend `MessagePort` at window creation.
- One backend process serves all windows; a crash is detected and the backend restarted, with open
  connections marked "disconnected".
- The renderer CSP: `default-src 'self'; script-src 'self'` (+ `'unsafe-eval'` only if Ajv's
  runtime compilation is kept for `$jsonSchema` validation; prefer validating in the backend).

### Electron shell (`apps/desktop`, M0)
- Build: `scripts/build.mjs` (esbuild) bundles `src/main/index.ts` → `dist/main.cjs` (the package's
  `main`), `src/preload/index.ts` → `dist/preload.cjs` (sandboxed: CommonJS, only `electron` is
  required at runtime) and `packages/backend/src/server/entry.ts` → `dist/backend.cjs` (the
  utilityProcess). `npm run start` (root) builds the renderer and these bundles and starts Electron;
  `npm run dev` (root) bundles, starts `ng serve` and Electron with `THICKET_DEV_SERVER` (renderer
  live reload; main/preload/backend changes need a restart).
- The renderer is served from `thicket://app/index.html` (`protocol.handle`, files from
  `packages/renderer/dist` or `THICKET_RENDERER_DIR`) with the CSP as a response header; every
  http(s) response (dev server) gets it via `onHeadersReceived`. Window settings, CSP, navigation /
  `window.open` / webview / permission guards are pure functions in `src/main/security.ts`.
- Ports: per window (and per reload) main creates two `MessageChannelMain`s and sends one end of
  each to the preload on IPC channel `thicket:port` with `{ target: 'main' | 'backend' }`. Main
  serves its end with `serve()` (`packages/backend/src/server/rpc.ts`); the backend gets the other
  end of the backend channel as a `{ type: 'renderer' }` control message on `process.parentPort`.
- Preload (`src/preload/bridge.ts`): `thicket.request({ id, method, params })` resolves with the
  `Response` (never rejects for contract errors), routed by `route(method)`; requests wait until
  their port arrives. `thicket.cancel(id)` goes to the owner of a request id or stream id (map
  filled from responses with a `streamId`). `thicket.on(stream, listener)` or `thicket.on(listener)`
  (every event); early events of a new stream are buffered until someone listens.
- Backend restarts (`src/main/backend-host.ts`): on the utilityProcess `exit` main starts a new one
  (immediately; with back-off 250 ms … 10 s when it keeps dying within 10 s) and hands every window
  a new backend port with `restarted` info; the preload fails the old process's requests
  (`INTERNAL`) and streams (`error` event) and emits `backend.restarted` (`BackendRestarted`).
- Privileged port: one `MessageChannelMain` per backend process, `{ type: 'privileged' }`; main
  serves `privilegedMethods` (contract `backend.ts`: `main.ping`, `secrets.get`) on it. These
  methods are not in `methods`, so `route()` and the backend's renderer-facing `serve()` refuse
  them (`UNKNOWN_METHOD`).
- Settings (`src/settings/store.ts`, `SettingsStore`): `userData/settings.json` as
  `{ "version": 1, "settings": {...} }`. Missing file → `DEFAULT_SETTINGS`; unknown keys are
  dropped and invalid values fall back to their default per key; a file that is not JSON or not
  in that layout is renamed to `settings.json.corrupt-<time>` and the defaults are used (if that
  rename fails, it is retried before the first write, like below). A file
  that exists but cannot be read also gives the defaults and is renamed to
  `settings.json.unreadable-<time>` before the first write (if that fails, the set fails). Writes go
  to `settings.json.tmp` (flushed) and are renamed over the file (a stale temp file is removed at
  start); writes are serialized. Main serves `app.settings.get/set` and, after a set that changed
  something, broadcasts `app.settings.changed` (payload `SettingsChanged`) to every window through
  `Broadcaster` (`src/main/broadcast.ts`) on the window's main port. `THICKET_USER_DATA` overrides
  Electron's `userData` folder (tests).
- Query history (`src/history/`, `HistoryStore`, contract `history.*`, routed to main):
  `userData/history/<sha-256 of [profileId, db, coll]>.json` per collection (`{ version: 1,
  profileId, db, coll, entries: [{ query, at }] }`, newest first, at most `HISTORY_LIMIT` = 50;
  a query equal in every trimmed field moves to the top; an all-empty query is not recorded) and
  `userData/favorites.json` (`{ version: 1, favorites: [{ id, profileId, db, coll, name, query,
  at }] }`, names unique per collection ignoring case: saving a taken name replaces it). Queries
  are the query bar's text as typed (shell syntax), not EJSON. Files are read lazily, written
  atomically (`.tmp` + rename), operations serialized; an invalid file is renamed
  `<file>.corrupt-<time>`. The renderer's `QueryHistory` (per collection view) and
  `QueryHistoryMenu` (`packages/renderer/src/app/collection/history/`) record every query the
  user runs (not the tab's opening query or Reset) and re-run a picked entry by filling the bar.
- Secrets (`src/secrets/`): `SecretsStore` keeps `secrets.bin` in `userData` — one JSON document
  `{ version: 1, profiles: { <profileId>: { <SecretKind>: value } } }` encrypted as a whole with
  `safeStorage`'s async API, rewritten atomically (temp file + rename, mode 0600), operations
  serialized. A file that can't be decrypted or isn't valid is renamed to
  `secrets.bin.corrupt-<time>` and the store starts empty — except with a `weak` backend and a
  keyring-encrypted file (Chromium's `v11` prefix; basic_text writes `v10`, checked by
  `test/secrets.electron.spec.ts`): that file is left in place and the store is locked for the
  session: reads are empty, `setSecret`/`clearSecret` → `UNSUPPORTED`.
  While encryption is unavailable the file is left alone; `setSecret`, and `clearSecret` while the
  file exists, answer `UNSUPPORTED`. `status()`
  (`profiles.secretStorage`): `secure` (keychain, DPAPI, libsecret, KWallet), `weak` (Linux
  `basic_text` or `unknown`: Electron's plain-text key is switched on, `defaultSecretMode: 'ask'`,
  `setSecret` answers `secureStorage: false`), `unavailable` (`setSecret` → `UNSUPPORTED`).
  Renderer-facing: `profiles.secretStorage`, `profiles.setSecret`, `profiles.clearSecret`
  (`secretsHandlers`); values only go out via `secrets.get` on the privileged port. The profiles
  store uses `kinds()` for `profiles.get`'s `storedSecrets` and `delete(id)` on profile deletion;
  it never rewrites `secretMode`. The renderer's connection form takes `defaultSecretMode` from
  `profiles.secretStorage` for new profiles. Tests use `FakeSafeStorage`
  (`src/secrets/testing.ts`). `packages/contract/src/no-secrets.spec.ts` fails when any
  renderer-visible result, stream or broadcast schema gets a text field named like a secret.
- Profiles (`src/profiles/`): `ProfilesStore` keeps `connections.json` in `userData` —
  `{ version: 1, profiles: [Profile…] }` (creation order; contract `profile` schema, so no
  password in a connection string). Version 0 (a bare array of `{ id?, name, uri, group, readonly,
  isProduction, askPassword }`, fixture `fixtures/connections.v0.json`) is migrated on load: the
  URI's password moves to `secrets.bin` (falling back to `secretMode: 'ask'` only when secret
  storage is unavailable; other errors keep the v0 file for a retry), the file is rewritten; an
  entry without an id gets a deterministic `v0-<sha-256>` id. Saved profiles keep the
  `secretMode` the caller sends. Writes are atomic like
  `settings.json` (`connections.json.tmp`, flushed, renamed; a stale temp is removed on load);
  an invalid file is renamed `connections.json.corrupt-<time>`; a newer version is read but
  changes answer `UNSUPPORTED`. `delete` also removes the profile's secrets, `duplicate` copies
  none, and switching `secretMode` away from `saved` clears the saved password.
  `profilesHandlers` serve `profiles.list/get/save/delete/duplicate` and gate
  `profiles.setSecret` on the profile existing (`NOT_FOUND`).
- Saved pipelines (`src/pipelines/`): `PipelinesStore` keeps `pipelines.json` in `userData` —
  `{ version: 1, pipelines: [SavedPipeline…] }` (contract `savedPipeline`: `pipelineId`, `name`,
  `profileId`/`db`/`coll`, `stages: [{ stage: <canonical EJSON>, enabled }]`, `updatedAt`).
  Names are unique per collection ignoring case: `pipelines.save` under a taken name replaces
  that pipeline (keeps its id), `pipelines.rename` to a taken name answers `CONFLICT`. Missing,
  corrupt, unreadable and newer files and the atomic writes behave like `connections.json`.
  `pipelinesHandlers` serve `pipelines.list/save/rename/delete`.
- Import/export (`src/profiles/import/`): `importExportHandlers` serve `profiles.importCompass`
  (a file chosen with the native open dialog in `main`, at most `MAX_IMPORT_FILE_BYTES`),
  `profiles.importUris` and `profiles.export` (native save dialog; the renderer never names a
  path). `parseImportFile` reads a Compass export (`type: 'Compass Connections'`, version 1,
  possibly as EJSON; passphrase-encrypted `connectionSecrets` are left out with a notice) or a
  Thicket export; `profileFromUri` (`uri.ts`, mirrors the editor's `profileDraftFromState`) turns
  a connection string into a profile and takes its secrets out (password, `proxyPassword`,
  `tlsCertificateKeyFilePassword`, `AWS_SESSION_TOKEN`). Secrets go to `secrets.bin` only with a
  `secure` keychain, else they are dropped and the profile asks (with a notice); entries equal in
  name and connection string to an existing profile are skipped. `exportFile` writes
  `{ type: 'Thicket Connections', version: 1, profiles: [Profile without id] }` with `saved`
  turned into `ask` and secrets stripped from the connection string; importing such a file strips
  them again and never stores a secret. The desktop app depends on `@thicket/core` for this
  (`@thicket/core/uri`).
- Connections (`packages/backend/src/connections/`, backend): `ConnectionManager` keeps one
  driver client per profile id (`connecting` → `connected` / `error`; closed ones are forgotten
  and report `disconnected`) and serves `conn.test/open/close/status/serverInfo`
  (`connHandlers`). It loads the profile from main over the privileged port
  (`profiles.forConnect`, `NOT_FOUND` for unknown ids) and its secrets (`secrets.get`); a
  `password` in the request wins, and `secretMode: 'ask'` ignores a stored one. A `conn.test`
  draft with an `id` gets that profile's stored secrets only while its connection string, auth,
  TLS, SSH and proxy settings equal the saved profile's. Concurrent `conn.open`s of one profile share
  one connect (the first caller's `password`); each caller's cancel ends only its own wait, and
  the connect is closed (`CANCELLED`) once every caller cancelled or `conn.close` ran; a client
  abandoned mid-connect is closed again when the driver's connect settles. `clientConfig()`
  keeps the saved connection string as the URI (hosts, SRV, `replicaSet`, `directConnection`)
  and passes the form fields and secrets as driver options (`auth`, `authMechanism`
  SCRAM-SHA-1/256, `authSource`, `tls`, `tlsCAFile`, `tlsCertificateKeyFile` + passphrase,
  allow-invalid flags, read preference, `appName` (default `Thicket`), timeouts), so passwords
  never enter the URI; the other mechanisms (OIDC, Kerberos) answer `UNSUPPORTED`
  until their tasks.
  LDAP (`PLAIN`, task ldap-auth, `packages/backend/src/auth/ldap/`): user name from the profile, else
  the connection string, and the `password` secret go to the driver as `auth`, always with
  `authSource: '$external'`; no user name, no password or `secretMode: 'none'` → `AUTH_FAILED`.
  Integration fixture `test/integration/fixtures/ldap.ts`: MongoDB Enterprise 8.0 + OpenLDAP
  (`osixia/openldap`) on a private network, user-to-DN mapping, simple bind, generated passwords.
  MONGODB-X509 (task x509-proxy) needs TLS with a client certificate (`AUTH_FAILED` otherwise),
  always uses `authSource: '$external'`, and sends a user name only when the profile has one
  (else the server takes the certificate subject). The client certificate is a PEM bundle
  (`tls.certificateKeyFile` → `tlsCertificateKeyFile`) or certificate + `tls.keyFile`, which
  `clientConfig()` reads itself (driver `cert`/`key`/`passphrase`; unreadable → `TLS_ERROR`);
  the key passphrase is the `tlsKeyPassphrase` secret.
  MONGODB-AWS (task aws-auth, `packages/backend/src/auth/aws/`, always `authSource: '$external'`):
  driver 7 takes AWS credentials only from `authMechanismProperties.AWS_CREDENTIAL_PROVIDER` (a
  user/password or `AWS_SESSION_TOKEN` is refused, so a user name in the URI is `AUTH_FAILED`).
  With `auth.username` (the access key ID) the secret access key is the `password` secret (typed at
  connect, or the stored `password` kind: the profile's primary secret and what the connection
  editor saves; with `secretMode: 'ask'` only the typed one). It wins over a stored
  `awsSecretAccessKey`, which is only a fallback for `secretMode: 'saved'`. An optional
  `awsSessionToken` is added; the credentials are given
  as a static provider (missing secret or `secretMode: 'none'` → `AUTH_FAILED`). Without a user name
  the driver uses the default chain (`fromNodeProviderChain()` of `@aws-sdk/credential-providers`,
  a backend dependency the driver needs for MONGODB-AWS at all: environment, SSO, shared
  config/`AWS_PROFILE`, web identity, ECS/EC2 role); a chain without credentials is a `MongoAWSError`
  → `AUTH_FAILED`. Real Atlas verification is the human task `aws-verify`.
  MONGODB-OIDC (task oidc-auth, `packages/backend/src/auth/oidc/`, `authSource: '$external'`, the
  user name only a principal hint): the driver's `OIDC_HUMAN_CALLBACK` is
  `OidcAuthenticator.callbackFor()`. It discovers the issuer the server announces
  (`/.well-known/openid-configuration`, https only except loopback; the document must name that
  issuer), then: a refresh token from the driver → refresh; else the profile's `oidcTokens` cache
  (memory of this process first, else the stored secret) for the same issuer + client id →
  refresh with its refresh token (a refused refresh → interactive), or reuse an access token
  valid for > 60 s when there is no refresh token; else interactive. Interactive per
  `auth.oidcFlow`: `authCode` = authorization code + PKCE S256, the sign-in page opened by main
  (privileged `oidc.openBrowser` → `shell.openExternal`, http/https only), redirect to a one-shot
  loopback server on `http://localhost:27097/redirect` (mongosh/Compass's URI, so IdP apps
  registered for them work; 127.0.0.1 + ::1); `deviceCode` = RFC 8628 (with PKCE, Keycloak
  enforces it per client), polling at the IdP's interval; `auto` (default) = browser, device
  flow when the browser or the loopback port is unavailable. Scopes: `openid`, the server's
  `requestScopes`, `offline_access` when offered. The backend broadcasts `oidc.prompt`
  (`OidcPrompt`: `browser` with the URL, `device` with user code and verification URI,
  `finished`); no tokens in it. New tokens go to main's privileged `oidc.saveTokens`, kept as the
  `oidcTokens` secret only with `secure` storage (else memory only, `saved: false`) and only for an
  existing profile; an unsaved draft (`conn.test`) caches nothing. `conn.close`/cancel aborts a
  waiting sign-in (`CANCELLED`); the driver's own limit is 5 min. A connect that fails with
  `AUTH_FAILED` after the callback handed out tokens forgets them (`OidcAuthenticator.refused` →
  memory and keychain), so the next connect signs in interactively. The discovery fetch is shared
  per issuer and bound by its 30 s timeout only; each connect waits on it with its own signal.
  The driver sends tokens only to its default `ALLOWED_HOSTS` (Atlas, localhost/127.0.0.1/::1);
  `auth.oidcTrustedEndpoint: true` (mongosh's `--oidcTrustedEndpoint`) sets them to the
  connection string's own hosts (`mongodb+srv://`: `*.<SRV name's parent domain>`, where the
  driver requires the SRV results to be); the driver's refusal is `AUTH_FAILED` naming that
  option. Integration fixture
  `test/integration/fixtures/oidc.ts`: Keycloak 26 (HTTPS, per-run CA, realm import with a public
  PKCE client that allows the device grant and an audience mapper) and MongoDB Enterprise 8.0
  sharing Keycloak's network namespace, so `https://localhost:<P>/realms/thicket` is the same
  issuer for the test and mongod (mongod trusts the CA through its system bundle); headless
  Chromium (`npx playwright install chromium-headless-shell`) signs in on Keycloak's pages.
  `proxy` → `proxyHost`/`proxyPort`
  (+ `proxyUsername` and the `proxyPassword` secret; a user without a stored password is
  `AUTH_FAILED`) through the `socks` package (a backend dependency the driver loads lazily).
  `readPreferenceTags` (contract: tag sets as `{ name, value }` pairs, no free-form records) and
  `writeConcern` (`w`, `journal`, `wtimeoutMS`) become the client's defaults. Raw `db.command()`s
  ignore those defaults, so the backend applies them itself (task `raw-cmd-read-pref`,
  `browse.ts`): reads pass `db.readPreference` (`readOptions`); cursor commands (docs/agg/io
  `Operation.open`, browse `runCursor`) run as driver cursors (`ReadCursor`,
  `db.runCursorCommand`, `raw: true`) so `getMore`/`killCursors` go to the server that opened
  the cursor; a cancel's `currentOp`/`killOp` use the same read preference. Document writes
  (`Operation.write`: docs.insert/update/delete, io.import) run on the primary with the write
  concern as the command's `writeConcern` field (`withWriteConcern`); a write concern error
  answers `SERVER_ERROR` "applied but not acknowledged". Reads that belong to a write (preview,
  expected count, conflict detail) use the primary. Schema, index and user/role commands stay on
  the primary without the write concern.
  `toConnectError()` classifies driver errors by walking `cause`, `errors` and the server
  selection `reason`: `AUTH_FAILED` > `TLS_ERROR` > `DNS_ERROR` > `NETWORK_ERROR` > `TIMEOUT` >
  `SERVER_ERROR` (`ERR_OSSL_*`, e.g. a wrong key passphrase, is TLS; the server's `UserNotFound`
  counts as `AUTH_FAILED` only for connect errors, e.g. an X.509 subject without a user); messages start with a readable prefix and are masked (`maskText` + the
  connect's secret values), as is every log line. Later handlers get a connected client with
  `manager.client(profileId)` (`NOT_CONNECTED` otherwise).
- SSH tunnels (`packages/backend/src/ssh/`, task ssh-tunnel, `ssh2`): for a profile with `ssh`
  the manager first runs `openSshTunnel()` (password = `sshPassword` secret, private key file +
  optional `sshKeyPassphrase` secret, or the agent at `SSH_AUTH_SOCK` / `pageant`), then gives the
  driver the tunnel as its SOCKS5 proxy: a local SOCKS5 server on `127.0.0.1` (random port,
  random user/password per tunnel, `socks.ts`) turns every driver socket into one SSH
  `forwardOut` channel to the host the driver asked for. So each replica set member gets its
  own forwarded channel under the name the set reports (resolved by the SSH server), and
  `mongodb+srv://` is resolved by the driver (locally) before any socket goes through the
  tunnel. `ssh` + `proxy` in one profile is `INVALID_PARAMS`. The tunnel is closed with the
  connection (`conn.close`, failed connect, end of `conn.test`): channels, local port, SSH
  session. An SSH session lost while the connection is open (keepalive, server restart) closes
  the tunnel; the connection becomes `error` (`SSH_ERROR`), the backend broadcasts `conn.status`,
  and the next `conn.open` builds a new tunnel. Host keys: `KnownHosts` keeps `userData/known_hosts` (OpenSSH format, `[host]:port`,
  reads hashed entries); main passes `THICKET_USER_DATA` to the backend process. A known key
  connects; a host listed with other keys only is refused (`SSH_ERROR`, detail `reason:
  'hostKeyChanged'`, the message names the file to edit); an unknown key pauses the handshake
  timeout and asks: the backend broadcasts `ssh.hostKey` (`SshHostKeyPrompt`: `promptId`, host,
  port, key type, `SHA256:` fingerprint) to every window and waits up to 5 min for
  `conn.trustHostKey({ promptId, trust })` (then appends the key); "no", the time out or no
  window fail with `SSH_ERROR` (`reason: 'hostKeyRejected'`); a cancelled connect (`conn.close`,
  request cancel) ends the question and fails with `CANCELLED`, and a server that closes the
  connection meanwhile ends it too (`SSH_ERROR`). Other failures are
  `SSH_ERROR` with readable messages (authentication, missing/wrong passphrase, unreachable,
  timeout = `connectTimeoutMS`, default 20 s). The bundles keep ssh2's optional native
  `cpu-features` external (ssh2 falls back to JS). Integration fixture
  `test/integration/fixtures/ssh.ts`: `linuxserver/openssh-server` (forwarding switched on) in
  front of a two-member set whose names only sshd resolves.
- Streams (`serve()` in `packages/backend/src/server/rpc.ts`): a streaming handler calls
  `context.openStream(producer)` and returns `{ streamId }`. The producer starts after the
  response was sent, gets a `StreamSink` (`send(payload)`, validated against the method's
  `stream` schema; `signal`) and resolves with the delivered count → `end` event (`{ delivered }`),
  or rejects → `error` event. A `{ cancel: streamId }` aborts the signal; the `CANCELLED` error
  event is sent once the producer settled (after its cleanup), at the latest after
  `STREAM_CANCEL_GRACE_MS` (5 s). After `serve()`'s stop function, running streams are aborted
  and send nothing more (like requests); their grace timers are cleared.
- Document reads (`packages/backend/src/docs/query/`, `docsQueryHandlers`): `docs.find` (streamed
  `{ docs }` batches of `batchSize`, default 100, in display order), `docs.count` (aggregation
  `$match`/`$limit`/`$group`), `docs.estimatedCount` (`count` command), `docs.get` (with
  `sliceAbove`: top-level array sizes are read on the server, longer arrays come back `$slice`d,
  keeping the user's projection: the `$slice` operator for exclusion projections, the `$slice`
  expression for inclusion ones, classified with core's `isInclusion`), `docs.getSlice`
  (`$slice`/`$size` in an aggregation, so only the items travel; numeric path components are
  `INVALID_PARAMS`, a path through an array or a non-document parent is `NOT_FOUND`). `docs.get`
  and `docs.getSlice` match `{_id: {$eq: id}}`. `docs.find` turns `after`/`before`/`fromEnd`
  into the server query with paging-core's `findPlan` (`before`/`fromEnd` need a `limit` > 0:
  their rows are buffered to be sent in display order) and widens the projection with
  `projectionWithSortKeys` for sorts of plain directions; a find whose connection `conn.close`
  closed ends `CANCELLED`. Raw commands like `browse` (lossless EJSON). Every command of one
  operation carries a `comment` (`thicket:<random>`); a cancel finds it in `currentOp`
  (`$ownOps` when not allowed otherwise; probed every 100 ms until it shows up or the command
  settles, at most 4 s), `killOp`s it and `killCursors` an open cursor, also one returned by a
  late reply (`Operation`).
- Document writes (`packages/backend/src/docs/write/`, `docsWriteHandlers`, behind the write
  guard): raw `insert`/`update`/`delete` commands through `Operation` (cancellable, canonical
  EJSON params, so BSON types are kept). `docs.insert` adds an ObjectId `_id` where missing and
  returns every id. `docs.update` (operator documents only) / `docs.replace` (no `$` keys) /
  `docs.delete` match `{$and: [{_id: {$eq: id}}, expected]}`; no match → `CONFLICT` with
  `ConflictDetail` (`current`: the server version, `null` when deleted), except a delete of a
  document that is gone, which answers `deleted: false`. `docs.previewMany` = `docs.count`'s
  aggregation + a `find` sample (default 20); `docs.updateMany` (operators or pipeline) /
  `docs.deleteMany` refuse with `CONFLICT` (no detail) when more documents match than the
  confirmed `expectedCount` (best effort: count, then write; not atomic). Write and write-concern errors in a reply → `SERVER_ERROR`.
- Import/export (`packages/backend/src/io/`, `ioHandlers`; JSON and JSON Lines, CSV/BSON answer
  `UNSUPPORTED` until io-advanced): routed to the backend, which asks main over the privileged port
  for the native dialog (`dialog.saveFile` / `dialog.openFile`, `apps/desktop/src/dialogs`, parented
  to the focused window; a cancelled dialog answers `streamId: null` / `null`). `io.export` reads
  the find (filter, projection as given, sort, collation, hint, skip, limit) or aggregation cursor
  in batches of 1 000 through `Operation` and writes each batch (with back pressure) before the
  next `getMore`: JSON is one array, JSONL one document per line, relaxed EJSON unless `canonical`;
  a failed or cancelled export removes the file. `io.previewImport` remembers the path under an
  opaque `fileToken` (the last 100) and returns the first `sampleSize` (20) documents that parse.
  `io.import` streams the file (`JsonScanner`: one array or documents one after another, split by
  bracket depth, so a malformed document fails alone; `LineScanner` for JSONL), parses each value
  with `EJSON.parse(relaxed: false)` and inserts raw `insert` commands of ≤ 1 000 docs / 8 MB.
  `IoProgress.index` of an error is the 1-based line where the document starts; the errors of the
  first 100 lines are kept, in line order. `stopOnError` (default true) ends the stream with the
  error of the earliest failed line (a server refusal found while flushing wins over a later line
  that did not parse) after a last progress event (earlier lines stay inserted); otherwise failed
  documents are skipped, and an ordered insert continues after the failed one. A broken file
  structure, or one value longer than `MAX_VALUE_CHARS` (64 Mi characters: an unclosed `{`, a
  minified file read as JSONL; this bounds the memory, also for `io.previewImport`), always
  stops the same way (earlier documents inserted, last progress, `INVALID_PARAMS` "Line N: …");
  a failed write to the export file (cannot be created, disk full) answers `INTERNAL`. `end.delivered` is the number of
  documents written (export) or inserted (import). `io.import` is behind the write guard.
- Indexes (`packages/backend/src/indexes/`, `indexHandlers`): `idx.list` (`listIndexes`, server
  order), `idx.stats` (`$collStats` `indexSizes` + `$indexStats` usage; summed over shards,
  earliest `since`; without the `indexStats` privilege sizes only), `idx.create` (`createIndexes`,
  options passed as given; without `options.name` the driver's default name `a_1_b_-1`, which it
  answers), `idx.drop` (one index by name; `*` is `INVALID_PARAMS`), `idx.hide` (`collMod`
  `index.hidden`). The writes are behind the write guard; int tests `test/integration/indexes.int.spec.ts`.
- Write guard (`packages/backend/src/guard/`): `startBackend` wraps every handler of a
  `WRITE_METHODS` method with `guardWrites()`, which loads the profile from main (fresh, per
  write) and throws `READ_ONLY` for read-only profiles (even when confirmed), and
  `CONFIRMATION_REQUIRED` without `confirmed: true` on production profiles and for
  `docs.updateMany` / `docs.deleteMany` everywhere. `conditional` writes are checked only when
  `CONDITIONAL_WRITES` says the params write (`agg.run` with a `$out`/`$merge` stage); a
  conditional method without an entry there is always checked.
- Wiring diagnostics in the contract: `app.ping` (main), `backend.ping` (backend; also checks the
  privileged port), `backend.sleep` (cancellable wait for tests).
- Tests: unit specs next to the code; `npm run test:electron` (root: builds the renderer first)
  starts the real app with Playwright's `_electron` driver (`playwright-core`) and checks pings,
  cancel, restart after `SIGKILL`, the CSP header and the navigation guards; `dev.electron.spec.ts`
  checks the `npm run dev` path (`ng serve` + `THICKET_DEV_SERVER`). On Linux it needs a
  display: `xvfb-run -a npm run test:electron`, or without one it uses `--ozone-platform=headless`
  (also forced with `THICKET_TEST_HEADLESS=1`). Not part of `npm run check`.
- Packaging (`apps/desktop/electron-builder.yml`): `npm run dist` (root, delegates to
  `npm run dist -w apps/desktop`) builds the renderer, the bundles and unsigned installers for the
  current OS into `apps/desktop/release/`: AppImage, deb and rpm on Linux (rpm needs `rpmbuild`,
  package `rpm`), dmg (arm64 + x64, ad-hoc signed with `identity: '-'`, no Developer ID) on macOS,
  NSIS + zip (x64) on Windows (building NSIS on Linux needs wine). `npm run dist:dir -w
  apps/desktop` builds the same but only the unpacked app (`release/linux-unpacked/` etc.). App id `io.github.oldpeasant.thicket`,
  product name Thicket (also `productName` in `package.json`, so `userData` is `…/Thicket`).
  The asar holds only `dist/*.cjs` and `package.json`: everything else is bundled, so the
  `@thicket/*` packages are devDependencies. The renderer goes to `resources/renderer` (main uses
  it when `app.isPackaged`; a packaged app ignores `THICKET_DEV_SERVER` / `THICKET_RENDERER_DIR`,
  `main/renderer-source.ts`). `electronFuses` hardens the packaged binary: RunAsNode,
  NODE_OPTIONS and `--inspect` off, only `app.asar` loaded, asar integrity validated (macOS,
  Windows); the backend is a utilityProcess, so it needs none of them. No fuse controls
  Chromium's `--remote-debugging-port`: the packaged app still accepts it (the smoke test uses
  it), so anyone able to launch the binary with arguments can attach over CDP and drive the
  renderer, including `thicket.request` against saved connections. This is an accepted residual
  risk; refusing the switch in packaged builds is a possible follow-up. A native module added later must be external in `build.mjs` and a
  `dependency`; electron-builder rebuilds it for Electron and unpacks `*.node` from the asar.
  `electron` is pinned to an exact version (electron-builder requires it). Placeholder icon:
  `build/icon.png`, generated by `npm run icon -w apps/desktop`. Smoke test of a packaged build:
  `node scripts/smoke-packaged.mjs <executable> [screenshot.png]` (in `apps/desktop`: attaches
  over CDP, `--remote-debugging-port`, since `--inspect` is fused off; window, `thicket://app`,
  both pings, screenshot, fuse wire (not for AppImages), `ELECTRON_RUN_AS_NODE` / `--inspect` /
  dev env overrides ignored; AppImages run with `APPIMAGE_EXTRACT_AND_RUN=1`).
- Windows code signing (`docs/CODE_SIGNING.md`): only in `.github/workflows/release.yml`, through
  SignPath, when the `SIGNPATH_API_TOKEN` secret and `SIGNPATH_ORGANIZATION_ID` variable exist
  (`apps/desktop/scripts/signpath-enabled.mjs`): `--dir` build, sign `Thicket.exe`, NSIS + zip
  from the signed folder with `--prepackaged`, sign the installer. Local `npm run dist` stays
  unsigned.
- The Electron binary is downloaded by the `electron` package's postinstall; if
  `node_modules/electron/dist` is missing (install scripts disabled), run
  `node node_modules/electron/install.js`.

## API between parts
See SPEC.md section 4. `packages/contract` is the single source of truth; renderer and backend both
import it. Every new method gets: types, zod schema, a backend handler, a contract test.

Contract layout (`packages/contract/src/`):
- `envelope.ts` (Request/Response/Event/Cancel, broadcast stream names), `errors.ts` (stable
  `ERROR_CODES`), `common.ts` (shared fields, `ejsonDocument`/`ejsonArray`/`ejsonValue` for every
  document, query part, pipeline or BSON value — always canonical EJSON text, never objects).
- One file per method group (`profiles.ts`, `conn.ts`, `db.ts`, `coll.ts`, `docs.ts`, `agg.ts`,
  `idx.ts`, `schema.ts`, `io.ts`, `shell.ts`, `admin.ts`, `app.ts`), each exporting
  `<group>Methods = defineMethods({...})`: per method `route` (`main`|`backend`), strict `params`
  schema, `result` schema, `write` (`always`|`conditional`) and, for streaming methods, the `stream`
  data payload schema. `index.ts` merges them into `methods`.
- Helpers: `route(method)`, `parseParams`/`parseResult` (readable `INVALID_PARAMS` errors),
  `WRITE_METHODS`, types `ParamsOf<M>`, `ResultOf<M>`, `StreamDataOf<M>`.
- Writes carry `profileId` and optional `confirmed`; the backend refuses them on read-only
  profiles and requires `confirmed: true` for every write on production profiles and for
  `docs.updateMany` / `docs.deleteMany` on every profile.
- Cancel routing: a request and its stream belong to the process that served the request
  (`route(method)`). The preload sends `cancel` to the owner of the target: by the request's
  method for a request id, and through a streamId → owner map (kept by the preload, filled from
  responses with a `streamId`) for a stream id. `io.*` is routed to the backend (it asks main
  for the native dialog), so its streams and cancels need no forwarding.
- File paths: the renderer never sends paths for `io.*` (opaque tokens from native dialogs). The
  exception is the profile's TLS/SSH file paths, which are stored in the profile; the renderer
  gets them from `profiles.chooseFile` (native dialog in `main`).
- Renderer side (`packages/renderer/src/app/api/`): `ThicketBridge` is the shape of
  `window.thicket` (`request(Request): Promise<Response>`, `cancel(id)`, `on(listener) → off`; the
  renderer picks request ids). Components use `ApiService`: `request(method, params, { signal })`
  resolves with `ResultOf<M>` or rejects with `ApiError` (`code`, `message`, `detail`,
  `explanation`); `stream(method, params, { onStart })` is a cold Observable of `StreamDataOf<M>`
  (one request per subscription, cancelled on unsubscribe; `share()` to share it). `onStart` gets
  the request's result (e.g. `path` of `io.export`) before any data; `streamId: null` (cancelled
  dialog) completes without data. `broadcasts(BROADCAST_STREAMS.x)` / `events(name)` for pushed events.
  `ERROR_MESSAGES` / `describeError()` give readable texts per error code. Specs use
  `FakeThicketBridge` + `provideFakeThicket()` from `app/api/testing`.
- Adding a method: add it to its group file, add a valid/invalid sample to `SAMPLES` in
  `index.spec.ts` (the test fails otherwise), and to `EXPECTED_WRITES` if it writes.

## Main window layout (`packages/renderer/src/app/layout`)
- Routes: `''` is `AppShell` (sidebar, splitter, tab strip, work area, status bar); its child routes
  are the "start page" shown when no tab is active: `''` → `Welcome`, `NAV.connections`
  (`/connections`, manager), `NAV.newConnection` (`/connections/new`) and
  `editConnectionUrl(id)` (`/connections/:id`) → the connection pages (lazy, see "Connection
  editor"), `NAV.importCompass` (`/connections/import/compass`) → `ImportExportPage` (lazy, see
  "Connection editor"). Routes bind parameters to inputs
  (`withComponentInputBinding`). `dev/explorer` stays outside
  the shell. Any `NavigationEnd` shows the routed page (`WorkspaceService.showHome()`).
- Tabs: `WorkspaceService` (`tabs`, `activeId`, `open/close/activate/cycle/move/showHome`); a tab is
  `{ id, kind: 'collection' | 'shell' | 'admin', title, detail?, production?, data? }`, opening a
  known id selects it. Views register per kind with `provideTabView(kind, Component)` (the
  component gets the tab as its required `tab` input; `TabPlaceholder` otherwise). Every open tab
  stays rendered (hidden when inactive), so its state survives switching. Keys (document level):
  Ctrl/Cmd+W closes the active tab (always consumed, so it never closes the window),
  Ctrl+Tab / Ctrl+Shift+Tab and Ctrl+PageDown/PageUp cycle, Ctrl+Shift+PageDown/PageUp move.
- Sidebar width: setting `sidebarWidth` (`SIDEBAR_WIDTH` in the contract: 180…560, default 260),
  `SidebarWidthService` (`preview` while dragging, `commit` saves once on release; arrow keys,
  Home/End and double click on the splitter). The width is the `--sidebar-width` property on the
  shell. The sidebar content is `SidebarTree` (below).
- Status bar: `StatusService.setConnection({ name, state, production?, readonly? })` and
  `begin(label, progress?) → { update, done }` / `track(label, promise)` for running operations.

## Connection editor (`packages/renderer/src/app/connections`)
- `connection-form.model.ts` (pure): the editor's `EditorState` is core's `ConnectionUriModel`
  (`@thicket/core/uri`, never the core root) plus name, color, folder, mechanism, the typed
  password, `secretMode` and the flags. The form fields and the "Connection string" tab edit the
  same model: `connectionStringText()` prints it (password as `MASK` `****`),
  `applyConnectionString()` parses a typed URI (a password in it moves to the password field;
  `****` keeps the typed one). `profileDraftFromState()` writes the whole URI without password
  as `connectionString` and mirrors the form fields into the profile's own fields (`auth`, `tls`,
  read preference, app name, timeouts), which the backend passes as driver options; fields the
  form doesn't edit yet (SSH, `tls.keyFile`) are kept from the loaded profile. A user name
  without `authMechanism` becomes SCRAM-SHA-256 (the contract has no "negotiate").
- `ConnectionEditor` (`/connections/new`, `/connections/:id`): Save = `profiles.save`, then
  `profiles.setSecret('password')` only for `secretMode: 'saved'` with a typed password (else a
  saved password stays); new profiles take `defaultSecretMode` from `profiles.secretStorage`, a
  `weak` store shows a warning, `unavailable` disables "save". Test connection sends
  `{ profileId }` while the loaded profile is unchanged and no password was typed (so the stored
  secrets are used), else the draft (+ the typed password, also in "ask" mode, never stored);
  errors show the code, `ERROR_MESSAGES` and the backend's message. After Save it calls
  `SidebarTreeService.reloadProfiles()`.
- `ImportExportPage` (`connections/import/`, `/connections/import/compass`, linked from the
  manager and the welcome page): import a Compass or Thicket file, import a list of connection
  strings (one per line), export selected profiles without secrets; shows imported, skipped and
  notices, then calls `SidebarTreeService.reloadProfiles()`.
- `ConnectionsPage` (`/connections`): profiles grouped by folder (`groupByFolder`), edit,
  duplicate, delete (asked inline; closes the connection and its tabs). The sidebar links to it
  (`sidebar-manage`) and has "Edit connection…" in a connection's context menu.
- `mongodb-connection-string-url` loads `whatwg-url` → `webidl-conversions`, which needs
  `SharedArrayBuffer` at load time; the renderer isn't cross-origin isolated, so `main.ts` first
  imports `shared-array-buffer-stub.ts` (installs a throwing stand-in only when it is missing).
  The connection routes are lazy, so `whatwg-url` stays out of the initial bundle.
- e2e: `test/e2e/connections.e2e.ts` (mongo8 fixture + a user created by the test).

## Sidebar tree (`packages/renderer/src/app/sidebar`)
- `SidebarTreeService` (root): profiles from `profiles.list` (registered in `ProfileSafetyService`;
  `reloadProfiles()` is what the connection editor calls after a save or delete), connection
  states (`conn.open/close/status`, the `conn.status` broadcast; `backend.restarted` clears
  everything), and `Load<T>` (`loading` / `loaded` / `error`) per database list, collection list,
  `db.stats` and `coll.stats`, loaded on demand. A slower older answer never overwrites a newer
  one, and answers still running when a connection is forgotten (disconnect, error, backend
  restart) are dropped. A current list answering `NOT_CONNECTED` marks the connection
  disconnected. Forgotten connections collapse their databases in the tree.
- Writes go through `WriteGuard`: `db.create` (with the first collection), `coll.create`,
  `coll.rename`, and `db.drop` / `coll.drop` always with the confirm dialog and the name typed
  (`alwaysConfirm` + `typeToConfirm`). Drop and rename close the affected collection tabs.
- `SidebarTree` renders the visible rows flat (`role="tree"`, `aria-level`); arrows move and
  expand/collapse, Enter/click opens a collection tab; right click, Shift+F10 or the menu key opens
  the context menu. Write items use `[appWriteControl]` (disabled with the read-only hint). Names
  are typed into the sidebar's own prompt (client-side name checks: `dbNameProblem`,
  `collNameProblem`); profiles with `secretMode: 'ask'` get a password prompt before `conn.open`.
  The prompt is modal: `SidebarTreeService.promptOpen()` makes `AppShell` ignore the tab
  shortcuts and set everything but the sidebar `inert`. Status lines (loading, error, empty) are
  non-focusable `treeitem`s that the arrow keys skip.
- Collection tabs: id `collectionTabId(profileId, db, coll)`, kind `collection`, `data` is
  `CollectionTabData` (`profileId`, `db`, `coll`, `type`).
- The profile's `color` draws the connection's dot and the guide line down its subtree (user data,
  the only color not from the tokens). e2e: `test/e2e/sidebar.e2e.ts` (mongo fixture).

## Collection tab (`packages/renderer/src/app/collection`)
- `CollectionView` is the `collection` tab view (`provideTabView` in `app.config.ts`). It provides
  its own `CollectionResults` and its own instances of the explorer services, so search, collapse
  and columns are per tab; the explorer is read-only here (`EditModeService.setReadOnly`) until
  doc-edit-save, and its root table is horizontal (one row per document).
- Query bar: set as the mongosh call (`db.<coll>.find(filter, projection).sort().collation()
  .limit()`). `parseQuery()` (`query.util.ts`) parses every field with core's shell-syntax parser;
  any error is shown under the bar (`aria-invalid`/`aria-describedby`) and nothing is sent.
  Parsed parts go out as canonical EJSON. `limit` (0 = none) caps the whole result: pages end at
  it, the count is clipped and the last page is read with skip.
- `CollectionResults` drives paging-core (`@thicket/core/paging`): it sends the paging sort
  (`{_id: 1}` when none) for every page, `after`/`before` bounds from the edge rows' sort-key
  values (from the canonical EJSON text, so bounds are canonical EJSON too), `skip` for jumps and
  `fromEnd` for the last page. A page replaces the shown one, and a new page size applies, only
  once the page arrived completely; Cancel unsubscribes the stream (the backend kills the
  operation), aborts a count and moves focus to Run.
- Counts: an empty filter gets `docs.estimatedCount` (`~N`); with a filter there is no count until
  "Count exactly" (`docs.count`). A last page read from the end without an exact count (none, or
  only an estimate) has no known number: the pager says "Last N" (or "N pages before the last"),
  Previous/Next page by range from its edge rows, a jump by number reads with skip, and once
  counted exactly the page is read again aligned to the page boundaries. In skip mode (collation,
  a sort that is not range-pageable) there is no `before` bound, so Last without an exact count
  counts exactly first and then reads the last page. An empty page past page 1 says so
  ("No documents on this page") rather than blaming the filter; a page beyond the limit is not
  read (a notice says why).
- Views: table (explorer, `tables` layout), document list (one `app-json-form` per document), raw
  (shell syntax via `printShellSyntax`, or the canonical EJSON as received). e2e:
  `test/e2e/collection.e2e.ts` (10 000 documents).
- Paging inside documents (task doc-paging): arrays and objects with more entries than the
  `nestedPageSize` setting (`NestedPageSizeService`, default 100) show one page at a time with
  `app-pager` (first/previous/page field/next/last, `nested-pager-*` test ids) instead of
  Canopy's "show more"; the page per node instance (`uid`; the form's `form:<uid>`) lives in
  `PageService` (pure math in `explorer/page.util.ts`), edits stay in the document. Large
  documents: `docs.find` takes `slice: { above, docBytes }` (`LARGE_DOC_BYTES` = 1 MiB): in a
  document above `docBytes` the backend (`sliceLargeArrays`) cuts top-level arrays longer than
  `above` to their first `above` items and lists them in the batch's `sliced` (documents without
  `_id` stay whole: `docs.getSlice` can't address them). The collection view
  registers each cut array with `ArraySliceService` (source: `docs.getSlice`); `app-json-table`
  shows it as a sparse array of its full length, reads other pages on demand (cached per loaded
  document), and keeps it and everything below read-only (`locked`); the document counts as
  partial for Save. A saved large document is read back with `docs.get` `sliceAbove` (cut again;
  a failed read-back keeps its `sliced` entry). Inner pages reset when a new result page arrives
  (`CollectionResults.pageLoads`). e2e: `test/e2e/doc-paging.e2e.ts` (50 000 items, server
  profiler as the log).
- Raw editor (`packages/renderer/src/app/raw-editor`, `RawEditor`, `app-raw-editor`): each
  document of the document list has a **Raw** toggle that swaps its form for a CodeMirror 6
  editor of the whole document (`@codemirror/*`, JavaScript highlighting for shell syntax, JSON for
  EJSON; colors from the theme tokens). It is behind `@defer` in `collection-view.html`, so
  CodeMirror is a lazy chunk (~450 kB) and stays out of the initial bundle. Text ⇄ model is
  `raw-text.ts` (`printRaw`/`parseRaw`: core's shell-syntax parser and `parseEJsonDocument`,
  never `eval`); errors carry offset/line/column (EJSON syntax errors from the JSON reader's
  "position N", EJSON value errors have no place) and are marked in the text (`setDiagnostics`),
  shown under it (`role="alert"`, `aria-describedby`) and the cursor jumps there. The format
  toggle converts the current text, unapplied changes included; unreadable text stays in its
  format. **Apply** (Ctrl+Enter) records the text with `DocumentEdits.edit()` (refused when the
  `_id` changed or is missing); without unapplied changes the text follows the edit session
  (undo, explorer edits, save), with them it stays and shows "Not applied" (Reset discards).
  `no-eval.spec.ts` walks the editor's whole import graph (own code, core, `bson`, CodeMirror,
  Lezer; ESM, `require`, dynamic imports) and fails on `eval`/`new Function`/string timers;
  ESLint's `no-eval`/`no-implied-eval`/`no-new-func` cover renderer and core sources. Specs that
  render it call `installJsdomLayoutStubs()` (`raw-editor/testing.ts`: jsdom has no `Range`
  rectangles for CodeMirror's measuring).

## Users and roles (`packages/renderer/src/app/admin/users`, backend `src/admin/users`)
- Tab kind `users`, id `usersTabId(profileId, db)`, data `UsersTabData` (`profileId`, `db`);
  opened by "Users and roles" in the sidebar's database menu (`SidebarTreeService.openUsers`).
  Read-only: users (direct roles, roles held through them, all privileges, custom data,
  restriction count) and roles (own privileges, parents, all privileges; built-in on request).
  A role of the same database is a link to it. `users-roles.model.ts` reduces the EJSON entries.
- Backend `admin.users`: `usersInfo: 1` for the names, then an exact-match `usersInfo` list with
  `showPrivileges` + `showAuthenticationRestrictions` (the server refuses privileges for
  `usersInfo: 1`); credentials are never asked for and dropped if present. `admin.roles`:
  `rolesInfo: 1` with `showPrivileges` and `showBuiltinRoles`. Integration:
  `test/integration/users-roles.int.spec.ts`.

## Current operations (`packages/renderer/src/app/admin/currentop`, backend `src/admin/currentop`)
- Tab kind `currentop`, id `currentOpTabId(profileId)`, data `CurrentOpTabData` (`profileId`);
  opened by "Current operations" (`menu-current-ops`) in the sidebar's connection menu
  (`SidebarTreeService.openCurrentOps`).
- Backend `admin.currentOp`: the `currentOp` command on `admin` on the primary (the
  connection's default server, so `killOp` reaches the server that listed the opid); `ns` is a
  prefix on name boundaries (`^<ns>(\.|$)`), `minSecsRunning` → `secs_running: { $gte }`,
  `opType` → `op`, `all` → `$all`. `Unauthorized` (no `inprog` privilege) retries with
  `$ownOps`. `currentOp` commands are left out (its own probe can't be tagged with a comment,
  extra fields are filters); `$currentOp` aggregations stay listed; longest running first.
  `admin.killOp` (behind the write guard) parses the canonical EJSON `opId` (integer or
  `"shard:opid"`, else `INVALID_PARAMS`) and sends `killOp`. Int tests `test/integration/currentop.int.spec.ts`.
- Renderer: filters (namespace, minimum seconds, type, idle/system) reload at once; the head
  shows the matching `db.currentOp(…)` call; auto-refresh every 2/5/10 s (default 5) or never,
  the next read scheduled after the previous answer. Running time as text and a log-scaled bar
  (amber from 10 s, red from 60 s). Kill (active operations only, `appWriteControl`) goes
  through `WriteGuard.run` with `alwaysConfirm`, then reads again. `currentop.model.ts` reduces
  the EJSON entries. e2e: `test/e2e/currentop.e2e.ts`.

## Aggregation builder (`packages/renderer/src/app/aggregation`)
- `AggregationView` is the `aggregation` tab view (id `aggregationTabId(profileId, db, coll)`,
  `data` like a collection tab), opened with "Aggregate…" (`open-aggregation`) on the
  collection tab; dropping or renaming the collection closes it too.
- `pipeline.model.ts` (pure): a `Stage` is `{ id, operator, body, enabled }`, the body in shell
  syntax; `parseStage` → `{ [operator]: value }` with line/column errors (core's parser, never
  `eval`). The full-text mode (`printPipeline` / `parsePipeline`) is one shell-syntax array;
  disabled stages are lines starting with `//- ` (comments for the parser) and come back
  disabled.
- Previews: each enabled, valid stage gets `agg.previewStage` with the enabled, valid stages up
  to it (debounced 400 ms, only when its prefix changed, older requests aborted). A stage with an
  error blocks only its own preview; later stages are previewed without it and say so.
  `$out`/`$merge` stages are not previewed. No previews are read in full-text mode (loading ones
  are aborted); applying the text keeps each stage's id by position, so back in the stage list
  only stages whose prefix changed, or whose preview failed, are read again. Each stage's polite
  live region announces "Stage N: <count> from a sample" or the error, and is empty while loading.
- Run: `agg.run` with `$skip`/`$limit` appended (20 per page + 1 to know whether there is a next
  page); a pipeline with `$out`/`$merge` runs unpaged through `WriteGuard.approve` with
  `alwaysConfirm`. Export: core's `generateCode` (`@thicket/core/codegen`) for shell, Node,
  Python and Java, with the profile's connection string. Create view: `agg.createView` through
  `WriteGuard.run`. Saved… opens a panel for the collection's saved pipelines
  (`pipelines.list`, read when opened): Save stores every stage, disabled ones too, as canonical
  EJSON (refused while any stage has an error; in full-text mode the text is applied first);
  Open replaces the builder's stages (arguments reprinted in shell syntax, back in the stage
  list); Rename inline; Delete after a second click. e2e:
  `test/e2e/aggregation.e2e.ts` (demo step 8).

## Schema analysis (`packages/backend/src/schema`, `packages/renderer/src/app/schema-analysis`)
- Backend `schema.analyze` (`schemaHandlers`, `analyzeCollection`): one `aggregate` with
  `$match` (the filter, when not empty) then `$sample` (`DEFAULT_SCHEMA_SAMPLE` = 1 000) through
  `Operation` (cancellable), raw batches decoded without promotion, analyzed with
  `@mongodb-js/mongodb-schema` (`storeValues`, no semantic types) and flattened depth first
  (`flattenSchema`):
  paths dotted, array items `a.[]`, documents in arrays `a.[].b`; type names as `$type` aliases
  (`typeAlias`); shares relative to the parent (see the contract's `schemaField`); `Undefined`
  (missing) is not a type; up to `MAX_SCHEMA_EXAMPLES` distinct canonical-EJSON examples per type,
  only full values: strings, code and binaries the analyzer may have cut at
  `EXAMPLE_LENGTH_LIMIT` (1 000) are left out, so every example works as an equality filter.
  Int tests `test/integration/schema.int.spec.ts`.
- Renderer: **Schema** (`query-schema`) on the collection query bar opens `SchemaPanel`
  (`app-schema-panel`) under the bar for the bar's parsed filter. One row per path: present /
  missing share, a bar of the type shares (`--bson-*` tokens, missing part hatched), type and
  example chips. A click emits `{ key, condition }` (the value, or `{ $type }`; `filterKeyOf`
  drops `[]`); the tab merges it into the filter text (`withFilterField`, shell syntax) and
  focuses the filter, without running. e2e: `test/e2e/schema-analysis.e2e.ts`.

## Indexes tab (`packages/renderer/src/app/indexes`)
- `IndexesView` is the `indexes` tab view (id `indexesTabId(profileId, db, coll)`, `data` like a
  collection tab), opened with "Indexes…" (`open-indexes`) on the collection tab; dropping or
  renaming the collection closes it too. It reads `idx.list` and `idx.stats` together (a failed
  `idx.stats`, e.g. no `indexStats` privilege, only leaves size/usage empty) and shows one row per
  index: key pattern (↑/↓ or the index type; a text index shows its fields from `weights`
  instead of the stored `_fts`/`_ftsx`), option tags (incl. a non-English `default_language` and
  `wildcardProjection`), size, uses with a meter relative to the most used index. Drop
  (`alwaysConfirm`) and hide/unhide go through `WriteGuard`; `_id_` has neither.
- `IndexCreateForm`: key fields (direction or `text`/`2dsphere`/`2d`/`hashed`; `$**` /
  `path.$**` is a wildcard, except `{ "$**": "text" }`, a text index on all string fields, which
  takes weights/language but no wildcard projection) and options (name, unique, sparse, hidden,
  TTL, partial filter; collation, text weights/language, wildcard projection under a
  disclosure). `buildIndex()`
  (`index-form.model.ts`, pure) parses the shell-syntax options and refuses what the server
  would (sparse + partial, TTL on a compound/special/`_id` key, unique hashed/wildcard, a 2d field
  not first, collation with a text or 2d key, …) next to the field; Cancel is disabled while a
  create runs; a live preview shows the `createIndex(…)` call. e2e: `test/e2e/indexes.e2e.ts`.

## Explain plan viewer (`packages/renderer/src/app/explain`)
- **Explain** on the collection query bar (`query-explain`: the parsed query bar as an
  `agg.explain` find) and in the aggregation builder (`agg-explain`: the enabled stages; a pipeline
  with `$out`/`$merge` only with `queryPlanner`) opens `ExplainPanel` (`app-explain-panel`) under
  the bar; it asks `agg.explain` (backend default `executionStats`) again for each Explain, aborting
  the previous request.
- `explain.model.ts` (pure): `summarizeExplain(canonical EJSON)` → stage tree (output on top,
  scans as leaves), totals (returned, keys/docs examined, time), indexes used, COLLSCAN flag.
  Classic (`executionStats.executionStages`), slot-based (`explainVersion` 2: tree from
  `winningPlan.queryPlan`; returned and time from the outermost SBE stage with the same
  `planNodeId`, keys/docs examined from the summed `numReads` of that node's `ixseek`/`ixscan`/
  `ixscan_generic` and `scan`/`seek` stages), aggregate `stages` (a chain with `$cursor` holding
  the query tree) and sharded outputs.
- `ExplainPlan` shows the verdict, totals and tree (flow bar per stage: examined vs returned);
  "Raw output" shows the explain document in the explorer (`ExplainRaw`, read-only, own explorer
  services). Fixtures captured from mongo 8.2 with `explain/fixtures/capture.mjs`. e2e:
  `test/e2e/explain.e2e.ts` (demo step 9; the test creates the index with `idx.create` over the
  bridge, not through the Indexes tab).

## Validator tab (`packages/renderer/src/app/validator`)
- Backend: `packages/backend/src/browse/validator` (`validatorHandlers`): `coll.validator.get`
  (`listCollections` options; level/action default `strict`/`error`, `{}` counts as none),
  `coll.validator.set` (`collMod`; `null` sends `validator: {}`), `coll.validator.check` (the
  `_id`s among at most `MAX_VALIDATOR_CHECK_IDS` given ones whose documents fail: a
  `{ _id: { $in }, $nor: [validator] }` find, so the server evaluates `$jsonSchema`; an optional
  draft `validator` instead of the stored one). Int tests `test/integration/validator.int.spec.ts`.
- `ValidatorView` is the `validator` tab view (id `validatorTabId(profileId, db, coll)`), opened with
  "Validator…" (`open-validator`) on the collection tab; closed with the collection like the
  indexes tab. The validator is edited as shell syntax (`validator.model.ts`, core's parser; empty
  text or `{}` removes it), level and action as selects; Save goes through `WriteGuard` and then
  bumps `ValidatorChanges` for that collection.
- Markers: each collection tab has its own `ValidatorMarks`; whenever its page changes (a saved
  document included) or `ValidatorChanges` bumps, it sends the page's `_id`s to
  `coll.validator.check`. The document list marks failing documents (`data-invalid`,
  `doc-invalid` tag, red edge); every view shows a summary line (`validator-summary`). Marks are
  about the stored documents, not unsaved edits. e2e: `test/e2e/validator.e2e.ts`.

## Write safety in the renderer (`packages/renderer/src/app/safety`)
- Every write UI sends writes through `WriteGuard.run(method, params, options)` (or `approve()`,
  which returns the params to send, e.g. for `agg.run` with `$out` over `ApiService.stream`).
  Read-only profiles reject with `READ_ONLY` before anything is sent; production profiles,
  `docs.updateMany` / `docs.deleteMany` and `alwaysConfirm` open the confirm dialog, and only after
  the user confirms is the request sent with `confirmed: true` (a caller's own `confirmed` is
  dropped). Cancel rejects with `CANCELLED`. `docs.deleteMany` over `TYPE_TO_CONFIRM_ABOVE` (1 000)
  documents (`count` option or `expectedCount`) needs the collection name typed.
- `describeWrite(method, params)` prints the exact operation in mongosh shell syntax
  (`printShellSyntax` from `@thicket/core/shellsyntax`; don't import the `@thicket/core` root in
  the renderer, it pulls in Node-only code).
- `ProfileSafetyService`: the connection UI registers each profile's flags (`set({ id, name,
  readOnly, production })`); `readOnly(id)` / `production(id)` are signals. Write controls use
  `[appWriteControl]="profileId"` (+ `disabledWhen`), which disables them on read-only profiles.
- `ConfirmService.confirm(request, signal?) → Promise<boolean>`; `ConfirmDialog` (in `AppShell`)
  shows one request at a time. Pass the caller's abort signal (as `WriteGuard` does): aborting it
  withdraws the request (its dialog closes or never opens, the promise resolves `false`). While a
  request is shown, `AppShell` makes the rest of the window `inert` and ignores the tab shortcuts.
  Production accent: `.tab.production`, `AppShell` host class `production`
  (red sidebar edge; active tab's `production`, else the status bar's connection) and the status
  bar's `production` class. Dev page `#/dev/safety`; screenshots in `test/e2e/safety.e2e.ts`.
- Bulk update/delete (`packages/renderer/src/app/collection/bulk`, `BulkPanel`, "Update/Delete
  many…" in the collection tab, hidden on read-only profiles): works on the tab's applied filter
  and collation (sort/limit don't apply). The update is shell syntax (operators only, or a
  pipeline; `parseUpdate`). Preview = `docs.previewMany` (count + 5-document sample); the write is
  only possible for a current preview (changing mode, update or applied query makes it stale) and
  goes through `WriteGuard.approve` with `expectedCount` = the previewed count; over
  `TYPE_TO_CONFIRM_ABOVE` the collection name must be typed, for updates as for deletes. Once
  confirmed, the write is sent without a cancel signal (a killed bulk write would be partly
  applied): the panel can't be closed and the tab's Export/Import/bulk toggles are disabled until
  it answers (`writing` output). A `CONFLICT` (more matches now) asks for a new preview. e2e: `test/e2e/bulk.e2e.ts`.
- Edit a field across rows (`packages/renderer/src/app/collection/multi-edit`): the collection
  tab provides `RowSelectionService` (`explorer/services`), which gives the explorer's root table a
  checkbox column in the table view, in edit mode, on writable profiles ("Select all rows" takes the
  rows shown: search and explorer page applied). Selection is by row index; it is cleared when the
  page's `_id` list changes (paging, a new query) or edit mode ends, and moves up when a row is
  deleted. `MultiEditPanel` sets or removes one field (dotted path, value in shell syntax);
  `MultiEdit` refuses rows with unsaved edits and, for partly loaded rows, nested paths and
  top-level fields not loaded whole. `WriteGuard.approveAll` asks one confirm for the batch (always,
  with the document count and the first `BATCH_SHOWN` = 10 operations), then each document gets its
  own conflict-checked `docs.update`, sent one after the other without a cancel signal. Conflicting
  documents are listed (changed ones reloaded, deleted ones removed from the page); the report is
  kept in `MultiEdit.result`, so it outlives the selection. e2e: `test/e2e/multi-edit.e2e.ts`.

## Install (development)
All OSes: Node 24 LTS, 24.15.0 or newer (Angular 22 and jsdom require it), with npm, git, Python 3
(for TFP and native module builds). Then `npm ci` in the repo root.

| | Linux | macOS | Windows |
|---|---|---|---|
| Node 24.15+ | distro package, nvm or fnm | `brew install node@24` or nvm | installer from nodejs.org or `winget install OpenJS.NodeJS.LTS` |
| Native build tools (only if a prebuilt binary is missing) | `gcc-c++ make` / `build-essential` | `xcode-select --install` | Visual Studio Build Tools (C++ workload) |
| Containers for `test:int` | Docker, or Podman with the socket enabled (see below) | Docker Desktop or Podman Desktop | Docker Desktop or Podman Desktop |
| Keychain for running the app | GNOME Keyring or KWallet (libsecret) | built in | built in |
| Packaging extras | `rpm` (`rpmbuild`) for `.rpm` | — | — |

Podman on Linux (rootless; this is what `test:int` is verified with, Fedora, Podman 5.8):
```sh
systemctl --user enable --now podman.socket
export DOCKER_HOST=unix://$XDG_RUNTIME_DIR/podman/podman.sock   # e.g. unix:///run/user/1000/podman/podman.sock
export TESTCONTAINERS_RYUK_DISABLED=true   # Ryuk can't start on rootless Podman
npm run test:int
```
`test/integration/vitest.config.ts` sets `TESTCONTAINERS_RYUK_DISABLED=true` itself when `DOCKER_HOST`
contains `podman`, so `DOCKER_HOST` alone is enough; the global setup's teardown stops the
containers. With Docker no variables are needed.

Windows: run `.taskcheck` and npm scripts from Git for Windows' bash (TFP runs the check in `sh`).

## Commands (root `package.json`, created in M0)
| Command | What it does | Time budget |
|---|---|---|
| `npm run check` | lint + type check + unit tests of all workspaces | < 2 min, this is `.taskcheck` |
| `npm run coverage` | unit tests with V8 coverage | |
| `npm run test:int` | integration tests against containers | slow, own tasks |
| `npm run test:e2e` | Playwright against the built Electron app | slow, own tasks |
| `npm run dev` | renderer dev server + Electron with reload | |
| `npm run start` | build renderer + bundles, start Electron | |
| `npm run test:electron` | the built app under Playwright's Electron driver | ~10 s, not in the check |
| `npm run dist` | installers for the current OS into `dist/` | |
| `npm run test:smoke` | Playwright against the packaged app from its installer | after `dist`; release CI |

## Integration tests
- `npm run test:int` runs `test/integration/**/*.int.spec.ts` (config `test/integration/vitest.config.ts`,
  type-checked and linted by the root `npm run check`, but not run by it).
- `test/integration/fixtures/global-setup.ts` (Vitest `globalSetup`) starts all MongoDB fixtures in
  parallel once per run and shares them with every test file via `inject('mongo')` (a record of
  `FixtureInfo`: `uri`, `host`, `port`, `version`, `replicaSet?`, `tls`) and `inject('tlsCaFile')`.
- Fixtures (`fixtures/mongo.ts`): `mongo8` (8.x standalone), `mongo8rs` (8.x single-node replica set
  `rs0`, URI has `directConnection=true`), `mongo7` (7.0 standalone), `mongo8tls` and `mongo7tls`
  (`requireTLS`, clients without a certificate allowed; connect with `{ tls: true, tlsCAFile }`).
- 8.x is `mongo:8.2`: `mongo:8.0` images refuse to start on Linux kernels 6.19.0-7.0.13
  (SERVER-121912).
- The CA and server certificate are generated per run (`fixtures/certs.ts`, node-forge with keys from
  `node:crypto`) into a temp dir that teardown deletes. Never commit certificates or keys.
- The TLS server certificate's SANs are `localhost`, `127.0.0.1` and `::1`, so the TLS fixtures assume
  the container runtime's host is local. A remote `DOCKER_HOST` would need that host added to the SANs.
- Tests use their own database/collection names so files can share a fixture.
- Fixtures started by their test file (not in the global setup): `fixtures/x509.ts`
  (`startX509Fixture()`: 8.x with `--auth` + `requireTLS`, its own CA from `generateTestPki()`, an
  `$external` user for a generated client certificate; bundle, encrypted bundle, separate
  cert/key files, a certificate without user and one from a foreign CA, all in a temp dir) and
  `fixtures/socks.ts` (`startSocksFixture()`: a private container network with the two-member
  replica set `rs2` (`rs-a:27017` primary, tag `dc: a`; `rs-b:27017` priority 0, tag `dc: b`)
  and a SOCKS5 proxy (`serjs/go-socks5-proxy`, generated user/password). The member names
  resolve only behind the proxy, so set discovery and reads from the secondary work only
  through it.

## End-to-end tests
- `npm run test:e2e` builds the renderer and the Electron bundles, then runs Playwright Test
  (`@playwright/test`, `playwright.config.ts`) on `test/e2e/**/*.e2e.ts`, one worker. On Linux run it
  under `xvfb-run -a`; without a display the harness passes `--ozone-platform=headless`
  (`THICKET_TEST_HEADLESS=1` forces that) and `--ozone-override-screen-size=1920,1080`: the headless
  backend's default screen is 1×1 px, which shrinks the window to 1×1, so clicks miss and nothing
  is painted. `apps/desktop/test/helpers.ts` (`npm run test:electron`) uses the same switches.
  Not part of `npm run check` (type-checked and linted by it).
- Screenshots: always `await screenshot(electronApp, window | locator, path)` from the harness,
  never `page.screenshot()` / `locator.screenshot()`. Why: on headless Linux Chromium only paints
  when asked, so Playwright's screenshot (which waits for a new frame) could hang until its timeout
  after a click switched the view, and `webContents.capturePage()` alone returned the view from
  before the click. The helper makes sure the window has a real size, asks for a repaint, takes
  Playwright's screenshot (5 s timeout) and, if that times out, falls back to
  `capturePageWithRepaint()` (main process: `invalidate()`, wait 400 ms, `capturePage()`, three
  times, keep the last). An element that is hidden or matches nothing still fails with the
  `TimeoutError` (no fallback). `test/e2e/screenshot.e2e.ts` checks it with DISPLAY/WAYLAND_DISPLAY unset:
  after each view switch the PNG shows a marker colour drawn after the switch.
- Import `test`/`expect` from `test/e2e/harness`. Fixtures: `userDataDir` (a fresh temp folder per
  test, passed as `THICKET_USER_DATA`, deleted afterwards), `appEnv` (option), `electronApp`, `window`
  (first window), `appOutput`, and `mongo` (the int-harness fixture named by the worker option
  `mongoFixture`, default `mongo8`, started once per worker; tests using it are skipped when no
  Docker/Podman answers). After every test `electronApp` checks that the real `userData` folder
  (`realUserDataDir()`, Electron's `appData` + app name) is unchanged.
- On failure the harness saves a PNG of every window (`failure-window-<n>.png`) and the app output to
  the test's folder under `test-results/` (git-ignored).
- Installer smoke test: `npm run test:smoke` (`test/e2e/smoke/playwright.config.ts`, not part of
  `test:e2e`) starts the packaged app from the installer in `THICKET_SMOKE_INSTALLER` (default: the
  newest `.AppImage`/`.dmg`/`.exe` for this OS in `apps/desktop/release/`, so run `npm run dist`
  first). `installed-app.ts` makes it runnable as a user would: AppImage as is, dmg mounted with
  `hdiutil`, NSIS installed silently into a temp folder (and uninstalled synchronously with
  `_?=<dir>`). The NSIS installer shares its uninstall entry with a real per-user Thicket and
  replaces it, so on Windows outside CI (`CI` unset) it refuses to run unless
  `THICKET_SMOKE_ALLOW_INSTALL=1`. It checks the welcome screen and, on Linux only (MongoDB
  containers are Linux-only here: Windows runners have Windows containers only, macOS runners no
  Docker; `THICKET_SMOKE_MONGO=1` forces it elsewhere), connects to the `mongo8` fixture through the
  connection editor (skipped without Docker/Podman; `THICKET_SMOKE_MONGO=1` makes that a failure).
  `release.yml` runs it after every build: Linux under `xvfb-run` with `APPIMAGE_EXTRACT_AND_RUN=1`
  and MongoDB, macOS on the arm64 dmg, Windows on the NSIS installer. It does not use
  `_electron.launch` (that needs `--inspect`, which the `EnableNodeCliInspectArguments` fuse turns
  off): it spawns the app with `--remote-debugging-port=0` and attaches with
  `chromium.connectOverCDP`, so it works with the hardened fuses. It needs the renderer's
  `--remote-debugging-port` switch to keep working in packaged builds; breaking that shows only on
  `v*` tag releases, since `test:smoke` is not part of `.taskcheck`.

## Coverage
- Tool: Vitest with `@vitest/coverage-v8`, reporters `text-summary`, `json-summary`, `lcov`.
- Reports: `coverage/` in each workspace (git-ignored).
- Task-scoped coverage for the test-writer:
  `npx vitest run --coverage --coverage.include='<changed file>' --coverage.include='<…>'`
  in the workspace of the changed files (`cd packages/core`, paths relative to that workspace, e.g.
  `--coverage.include='src/index.ts'`); get the list with
  `git diff --name-only $(git merge-base HEAD origin/main) -- '*.ts'`.
  Renderer: `cd packages/renderer && npx ng test --coverage --coverage-include='src/app/app.ts'`
  (repeat `--coverage-include` per file).
- Not part of any workspace, lint, Prettier or Vitest: `dashboard/` (TFP's own Angular app), the TFP
  Python files, `tasks/`, `reviews/`, `.claude/` and Markdown docs (see `.prettierignore`, the
  `ignores` in `eslint.config.mjs`, the explicit `workspaces` list and `test.projects`).
- No repository-wide percentage is enforced.

## Shell syntax (`packages/core/src/shellsyntax`)
- `parseShellSyntax(text)` / `parseShellSyntaxDocument(text)` → `BsonValue`; `printShellSyntax(value,
  { indent })` → text. Used by the raw editor and the query bar; the model ⇄ canonical EJSON is
  `bson/ejson.ts`, so shell ⇄ EJSON goes through the model.
- A recursive-descent parser over a JS subset (object/array literals, `'…'`/`"…"` strings, number
  literals incl. hex/`_`/`5n`, regex literals, comments, unquoted keys), never `eval`. Only the
  constructors in `value.ts` `CONSTRUCTORS` may be called (`new` optional); `function`, `this`,
  operators, variables, property access and other calls are refused.
- Errors are `ShellSyntaxError` (`offset`, 1-based `line`/`column`, `reason`); the message ends
  with "(line L, column C)".
- Numbers follow mongosh: an integer literal in Int32 range is Int32, else Double; the printer
  writes integral Doubles as `Double(n)`, Int64 as `NumberLong(…)`, dates as `ISODate("…")`,
  Timestamp as `Timestamp({ t, i })`. print → parse is lossless for every BSON type.

## Conventions
- TypeScript `strict`; no `any` in `contract` and `core`.
- `packages/core` stays free of Node and Electron APIs (it runs in the renderer too).
- Documents cross process boundaries only as canonical EJSON text.
- Never `eval` or `new Function` on user input outside the mongosh host.
- Every write path checks read-only in the backend, not only in the UI.
- Tests next to the code (`*.spec.ts`); integration tests under `test/integration/`.
- Prettier formatting (`.prettierrc` from JSON Canopy), commit messages in imperative mood.

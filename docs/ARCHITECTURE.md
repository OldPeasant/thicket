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
| Schema analysis | `mongodb-schema` |
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
- Connections (`packages/backend/src/connections/`, backend): `ConnectionManager` keeps one
  driver client per profile id (`connecting` → `connected` / `error`; closed ones are forgotten
  and report `disconnected`) and serves `conn.test/open/close/status/serverInfo`
  (`connHandlers`). It loads the profile from main over the privileged port
  (`profiles.forConnect`, `NOT_FOUND` for unknown ids) and its secrets (`secrets.get`); a
  `password` in the request wins, and `secretMode: 'ask'` ignores a stored one. A `conn.test`
  draft with an `id` gets that profile's stored secrets only while its connection string, auth,
  TLS and SSH settings equal the saved profile's. Concurrent `conn.open`s of one profile share
  one connect (the first caller's `password`); each caller's cancel ends only its own wait, and
  the connect is closed (`CANCELLED`) once every caller cancelled or `conn.close` ran; a client
  abandoned mid-connect is closed again when the driver's connect settles. `clientConfig()`
  keeps the saved connection string as the URI (hosts, SRV, `replicaSet`, `directConnection`)
  and passes the form fields and secrets as driver options (`auth`, `authMechanism`
  SCRAM-SHA-1/256, `authSource`, `tls`, `tlsCAFile`, `tlsCertificateKeyFile` + passphrase,
  allow-invalid flags, read preference, `appName` (default `Thicket`), timeouts), so passwords
  never enter the URI; SSH and the other mechanisms answer `UNSUPPORTED` until their tasks.
  `toConnectError()` classifies driver errors by walking `cause`, `errors` and the server
  selection `reason`: `AUTH_FAILED` > `TLS_ERROR` > `DNS_ERROR` > `NETWORK_ERROR` > `TIMEOUT` >
  `SERVER_ERROR`; messages start with a readable prefix and are masked (`maskText` + the
  connect's secret values), as is every log line. Later handlers get a connected client with
  `manager.client(profileId)` (`NOT_CONNECTED` otherwise).
- Streams (`serve()` in `packages/backend/src/server/rpc.ts`): a streaming handler calls
  `context.openStream(producer)` and returns `{ streamId }`. The producer starts after the
  response was sent, gets a `StreamSink` (`send(payload)`, validated against the method's
  `stream` schema; `signal`) and resolves with the delivered count → `end` event (`{ delivered }`),
  or rejects → `error` event. A `{ cancel: streamId }` aborts the signal; the `CANCELLED` error
  event is sent once the producer settled (after its cleanup), at the latest after
  `STREAM_CANCEL_GRACE_MS` (5 s).
- Document reads (`packages/backend/src/docs/query/`, `docsQueryHandlers`): `docs.find` (streamed
  `{ docs }` batches of `batchSize`, default 100, in display order), `docs.count` (aggregation
  `$match`/`$limit`/`$group`), `docs.estimatedCount` (`count` command), `docs.get` (with
  `sliceAbove`: top-level array sizes are read on the server, longer arrays come back `$slice`d),
  `docs.getSlice` (`$slice`/`$size` in an aggregation, so only the items travel; no array indexes
  in the path). `docs.find` turns `after`/`before`/`fromEnd` into the server query with
  paging-core's `findPlan` and widens the projection with `projectionWithSortKeys` for sorts of
  plain directions. Raw commands like `browse` (lossless EJSON). Every command of one operation
  carries a `comment` (`thicket:<random>`); a cancel finds it in `currentOp` (`$ownOps` when not
  allowed otherwise), `killOp`s it and `killCursors` an open cursor (`Operation`).
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
  it when `app.isPackaged`). A native module added later must be external in `build.mjs` and a
  `dependency`; electron-builder rebuilds it for Electron and unpacks `*.node` from the asar.
  `electron` is pinned to an exact version (electron-builder requires it). Placeholder icon:
  `build/icon.png`, generated by `npm run icon -w apps/desktop`. Smoke test of a packaged build:
  `node scripts/smoke-packaged.mjs <executable> [screenshot.png]` (in `apps/desktop`: window,
  `thicket://app`, both pings, screenshot; AppImages run with `APPIMAGE_EXTRACT_AND_RUN=1`).
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
  responses with a `streamId`) for a stream id. Streams of main-routed `io.*` methods run in the
  backend, so `main` forwards cancels of the streams it proxies to the backend (a later task).
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
  are the "start page" shown when no tab is active: `''` → `Welcome`, `NAV.newConnection`
  (`/connections/new`) and `NAV.importCompass` (`/connections/import/compass`) → `PlannedPage`
  placeholders that connection-ui and profiles-import-export replace. `dev/explorer` stays outside
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
  shell. The sidebar content is a placeholder until sidebar-tree.
- Status bar: `StatusService.setConnection({ name, state, production?, readonly? })` and
  `begin(label, progress?) → { update, done }` / `track(label, promise)` for running operations.

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

## End-to-end tests
- `npm run test:e2e` builds the renderer and the Electron bundles, then runs Playwright Test
  (`@playwright/test`, `playwright.config.ts`) on `test/e2e/**/*.e2e.ts`, one worker. On Linux run it
  under `xvfb-run -a`; without a display the harness passes `--ozone-platform=headless`
  (`THICKET_TEST_HEADLESS=1` forces that). Not part of `npm run check` (type-checked and linted by it).
- Import `test`/`expect` from `test/e2e/harness`. Fixtures: `userDataDir` (a fresh temp folder per
  test, passed as `THICKET_USER_DATA`, deleted afterwards), `appEnv` (option), `electronApp`, `window`
  (first window), `appOutput`, and `mongo` (the int-harness fixture named by the worker option
  `mongoFixture`, default `mongo8`, started once per worker; tests using it are skipped when no
  Docker/Podman answers). After every test `electronApp` checks that the real `userData` folder
  (`realUserDataDir()`, Electron's `appData` + app name) is unchanged.
- On failure the harness saves a PNG of every window (`failure-window-<n>.png`) and the app output to
  the test's folder under `test-results/` (git-ignored).

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

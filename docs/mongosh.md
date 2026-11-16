# Embedding mongosh in the backend (spike)

Result of the M4 spike `mongosh-spike` (2026-11-16). Prototype: `spikes/mongosh/` (throwaway, not a
workspace; `npm ci` there, then `node ping.cjs` against a running MongoDB, `node bundle.mjs` for the
bundle measurement). This document decides **how** the M4 shell is built; the shell tasks implement it.

## TL;DR / decision

- Host the real mongosh runtime from its npm packages (Apache-2.0), **not** the `mongosh` CLI binary.
  Use `@mongosh/service-provider-node-driver` + `@mongosh/shell-api` + `@mongosh/shell-evaluator` +
  the autocompleter from `@mongosh/browser-runtime-core`, wired up in a ~40-line class of our own
  (`ThicketShellRuntime` in `spikes/mongosh/ping.cjs`). Do not use `ElectronRuntime` itself: it is the
  same wiring but hides the `ShellInstanceState`, so it cannot interrupt.
- Each shell session gets **its own `MongoClient`** (interrupt closes it, see below), created with the
  profile's resolved driver options (same tunnel, TLS, auth) through `NodeDriverServiceProvider.connect`.
- Run each session in a **`worker_thread` inside the backend utilityProcess** (one worker per open
  console). A synchronous endless loop (`while (true) {}`) cannot be interrupted cooperatively; only
  `worker.terminate()` stops it without taking down the backend and every other connection with it.
- Bundle into `backend.cjs` with esbuild like the rest of the backend (+22 MiB), with the native
  modules `kerberos` and `mongodb-client-encryption` external and unpacked from the asar.
- Pin all `@mongosh/*` packages to exact versions and upgrade them as one set (they pin each other,
  e.g. `@mongosh/service-provider-core` is an exact `5.6.2` dependency everywhere).

## Packages and versions

Verified with `npm install` in `spikes/mongosh` (Node 24.22.1, npm registry on 2026-11-16; all
published 2026-11-11):

| Package | Version | Role |
|---|---|---|
| `@mongosh/service-provider-node-driver` | 5.6.9 | `NodeDriverServiceProvider.connect(uri, driverOptions, cliOptions, bus)`: the driver behind the shell API. Uses `@mongodb-js/devtools-connect` (OIDC plugin, proxy/SSH support, system CA) |
| `@mongosh/service-provider-core` | 5.6.2 (exact pin) | `ServiceProvider` interface |
| `@mongosh/shell-api` | 5.9.9 | `ShellInstanceState`, the `db`/`rs`/`sh`/cursor API, `print`, `use`, `show`, `help`, interrupt flag |
| `@mongosh/shell-evaluator` | 5.9.9 | `ShellEvaluator.customEval(evalFn, code, ctx, filename)`; handles `use x`, `it`, `show …` and the async rewriter (`@mongosh/async-rewriter2`, Babel) that lets `db.c.find()` look synchronous |
| `@mongosh/browser-runtime-core` | 5.11.9 | `OpenContextRuntime` (reference wiring) and `ShellApiAutocompleter` |
| `@mongosh/autocomplete` | 5.9.9 | completion engine; the default "new" completer is `@mongodb-js/mongodb-ts-autocomplete` 0.9 (TypeScript language service, `typescript` is a runtime dependency) |
| `@mongosh/browser-runtime-electron` | 5.11.9 | `ElectronRuntime` = `OpenContextRuntime` + a `vm` context. Reference only, not needed |
| `mongodb` | 7.9.0 | required `^7.5.0`: dedupes with the root's `mongodb ^7.9.0`, so the shell and the rest of the backend share one driver version |
| `@mongosh/node-runtime-worker-thread` | 5.5.4 | Compass's "runtime in a worker thread" (pre-bundled, uses the native `interruptor` module for SIGINT-style interrupts). Alternative to our own worker, see "Interrupt" |

Engines: `node >=14.15.1` (works on Node 24 and Electron 45's Node).

## Eval

```js
const sp = await NodeDriverServiceProvider.connect(uri, { productName: 'Thicket', productDocsLink, ...driverOptions }, {}, bus);
const state = new ShellInstanceState(sp, bus);      // bus: an EventEmitter (mongosh log events)
state.isInteractive = true;
const ctx = vm.createContext({});
state.setCtx(ctx);                                   // installs db, use, print, ObjectId, … into ctx
const evaluator = new ShellEvaluator(state);
const result = await evaluator.customEval((code) => vm.runInContext(code, ctx), input, ctx, '');
// result: { type, printable, rawValue, source?, constructionOptions? }
```

- One `vm` context per session; variables, functions and the current db persist between inputs.
- Input is a whole program: multi-line text, several statements, function declarations
  (prototype: `function f(a) {\n return a * 2;\n}\nf(21)` -> `42`). Deciding when a line is
  complete (Enter vs. Shift+Enter) is a UI decision; the runtime just takes the text.
- `use thicketspike` -> `'switched to db thicketspike'`; the prompt comes from
  `state.getDefaultPrompt()` (`test> ` on the standalone fixture; topology prefixes such as
  `[primary]` on replica sets, not tried).
- Errors reject the `customEval` promise with the original error: `MongoServerError` (code, e.g.
  11000), user `throw`s, `MongoshInterruptedError` on interrupt.
- `print`/`printjson`/`console.log|warn|info|error` (mapped to `print` by `setCtx`) go to the `EvaluationListener.onPrint(values, 'print' | 'printjson')`
  callback set with `state.setEvaluationListener(...)`, as `ShellResult[]`. The listener also has
  `onPrompt` (`passwordPrompt()`, yes/no questions), `onClearCommand` (`cls`), `onExit` (`exit`/`quit`),
  `onLoad` (`load(file)`: the hook for the M4 Should "run a script file"), and config getters/setters
  (`config.set`, `displayBatchSize`, …) that we back with our settings store.
- The server's permissions are the only guard (SPEC M4): the runtime runs any command the user types.
  `eval` of user input is allowed only here (ARCHITECTURE "Never `eval` … outside the mongosh host").

## Output types

`customEval` returns `{ type, printable, rawValue }`:

- `type` is the shell API class name of the result, `null` for plain JS values. Seen in the
  prototype: `null` (`db.runCommand(...)` -> `printable: { ok: 1 }`, numbers, objects), `'Cursor'`
  (`db.orders.find()`); others found in the shell-api 5.9.9 sources: `AggregationCursor`,
  `Document`, `ExplainOutput`, `Help`, `CursorIterationResult` (`it`), the `result.js` classes
  `InsertOneResult`, `InsertManyResult`, `UpdateResult`, `DeleteResult`, `BulkWriteResult`,
  `ClientBulkWriteResult`, and the `CommandResult` subtypes `ShowDatabasesResult`,
  `ShowCollectionsResult`, `ShowProfileResult`, `ShowResult`, `StatsResult`, `ListCommandsResult`,
  `ShowBannerResult`. The renderer should switch on the few it shows specially and fall back to text.
- `printable` is already the display form: a cursor becomes the first batch
  (`{ cursorHasMore: false, documents: [...] }`, `displayBatchSize` = 20 by default; `it` continues),
  BSON values stay js-bson objects (`Long`, `ObjectId`, `Date`, `Decimal128`, …), so documents can be
  sent to the renderer as canonical EJSON and shown in the Thicket viewer unchanged.
- Plan for the IPC payload: `{ type, documents?: EJSON[] (Cursor/AggregationCursor/Document/arrays of
  documents), value?: EJSON, text: string }` where `text` is `util.inspect(printable)` (mongosh's own
  formatting comes from `@mongosh/cli-repl`'s `format-output`, which is not a dependency here; a small
  formatter of our own or `util.inspect` with the `inspect.custom` hooks of the BSON classes is
  enough for the "plain text" toggle). `rawValue` must never cross IPC (it can be a live cursor).
- `source.namespace` tells which collection a cursor came from (useful for "open in the viewer").

## Autocompletion

`new ShellApiAutocompleter(state).getCompletions(code)` -> `[{ completion }]`, call
`state.fetchConnectionInfo()` once first (the completer filters by server version/topology).
Prototype: `db.ord` -> `db.orders` (collection names are fetched from the server),
`db.orders.fin` -> `find`, `findAndModify`, `findOne`, `findOneAndDelete`, … Field names
(`db.orders.find({n`) returned nothing on a fresh session: the new TypeScript-based completer only
knows the schema it has sampled. `USE_NEW_AUTOCOMPLETE=0` (environment variable read at call time)
switches to the old, lighter completer. Completion goes through the same worker as eval.

## Interrupt

- Cooperative interrupt: `await state.onInterruptExecution()` sets the `InterruptFlag` (every pending
  shell API await rejects with `MongoshInterruptedError`) and **suspends every `Mongo` instance: it
  closes the session's `MongoClient`**, which also makes the server abort the running operation.
  Afterwards `await state.onResumeExecution()` reconnects and resets the flag. The host must await
  the interrupt before calling resume (otherwise resume finds nothing to resume and the client stays
  closed: `MongoNotConnectedError` in the first prototype run).
- Verified: `let i = 0; while (true) { db.runCommand({ping:1}); i++ }` interrupted after 300 ms
  (`i` was ~2000 afterwards, the shell kept working); `db.orders.find({ $where: "sleep(5000) || true" })`
  interrupted after 300 ms instead of 5 s.
- Because interrupt closes the client, a shell session can never share the `MongoClient` of the
  browsing/query side. Hence one client per session.
- A purely synchronous loop (`while (true) {}`) never yields: no flag check runs, and it blocks the
  whole thread (in the backend's main thread: all IPC, all connections). The `vm` `timeout` option
  stops it (`ERR_SCRIPT_EXECUTION_TIMEOUT`, verified), but a timeout breaks legitimate long scripts.
  `breakOnSigint` (what `ElectronRuntime` sets) needs a real SIGINT, which a utilityProcess doesn't
  get. Therefore: one `worker_thread` per session; Cancel = cooperative interrupt first, and
  `worker.terminate()` + a fresh worker (session state lost, shown to the user) if it doesn't settle
  within ~2 s. `@mongosh/node-runtime-worker-thread` (Compass) implements the same idea with a
  native SIGINT-style `interruptor`; we prefer our own small worker over adopting it (one more native
  module and a pre-bundled 5.x API surface that lags the other packages).

## Packaging impact

- `npm install` of the two top-level packages: 369 packages, 137 MB `node_modules`; the biggest
  are `typescript` (23 MB, needed by the new autocompleter), `@babel/*` (async rewriter), AWS SDK and
  `@smithy` (MONGODB-AWS auth, which M5 needs anyway), `mongodb-client-encryption` (3.5 MB).
- esbuild bundle (`spikes/mongosh/bundle.mjs`, CJS, `platform: node`, same as `backend.cjs`):
  **22.4 MiB**; largest inputs: `typescript` 9.7 MiB, `@mongodb-js/mongodb-ts-autocomplete` 3.6 MiB,
  `@mongosh/shell-api` 1.0 MiB, `mongodb` 1.0 MiB, `@babel/parser` 0.6 MiB. The bundled prototype ran
  the full scenario (eval, completion, interrupt). Required externals: the native modules (below),
  plus two lazy optional requires that esbuild can't resolve: `@babel/preset-typescript/package.json`
  and `pac-proxy-agent` (PAC proxy support; ship it unbundled or accept that PAC proxies don't work).
- Native modules (all N-API, prebuilt binaries via `prebuild-install`, so no Electron rebuild):
  `kerberos` 7.0.0 (`kerberos.node`, 200 KB; GSSAPI, M5) and `mongodb-client-encryption` 7.2.2
  (`mongocrypt.node`, CSFLE/Queryable Encryption), both optional dependencies of the driver;
  `ssh2` (optional `cpu-features`) via devtools-proxy-support. They must be external to the bundle,
  listed in `asarUnpack`, and installed per target OS/arch in `npm run dist` (CI per platform).
  Loading them under Electron's Node is assumed from N-API, not verified in the spike (see below).
- Startup: requiring the packages takes ~250 ms (Node 24, this machine): load lazily when the first
  console opens, inside the worker. Connect + first eval: ~80 ms against a local server.

## Licence

- All `@mongosh/*` and `@mongodb-js/*` packages, `mongodb`, `bson`, `kerberos`,
  `mongodb-client-encryption`: Apache-2.0, same as Thicket.
- Whole tree (369 packages, `npm query '*'`): MIT 269, Apache-2.0 63, ISC 18, BSD-2/3 11, plus
  single packages under PSF-2.0 (`argparse`), CC-BY-4.0 (`caniuse-lite`, data), BlueOak-1.0.0
  (`lru-cache`), Unlicense (`tweetnacl`), `(MIT OR WTFPL)`, `(BSD-2-Clause OR MIT OR Apache-2.0)`, and
  `cli-table` (no `license` field, MIT `LICENSE` file). All permissive, no copyleft. The packaged app
  must ship the third-party notices (the bundle drops `LICENSE` files): generate them at build time
  from the bundle's metafile.

## Not verified here / open

- Running inside the real Electron `utilityProcess` / Electron 45's Node (the spike ran on Node
  24.22.1; executing the Electron binary needed an approval the agent didn't have). Expected to work:
  plain Node APIs, N-API native modules. First shell task should cover it with `npm run test:electron`.
- Passing a profile's SSH tunnel / OIDC / AWS settings through `NodeDriverServiceProvider.connect`:
  the options are `DevtoolsConnectOptions` (= `MongoClientOptions` + `productName`, `oidc`, proxy
  options), so the backend's resolved options should map directly; check with the auth tasks.
- `worker_thread` per session is the recommendation, not prototyped.

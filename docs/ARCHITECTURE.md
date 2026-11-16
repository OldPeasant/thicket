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
| Shell-syntax parsing | `ejson-shell-parser` (safe, no `eval`) |
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
- No network resources: fonts come from npm packages bundled into `dist/`, never a CDN;
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

## API between parts
See SPEC.md section 4. `packages/contract` is the single source of truth; renderer and backend both
import it. Every new method gets: types, zod schema, a backend handler, a contract test.

## Install (development)
All OSes: Node 24 LTS with npm, git, Python 3 (for TFP and native module builds). Then `npm ci` in
the repo root.

| | Linux | macOS | Windows |
|---|---|---|---|
| Node 24 | distro package, nvm or fnm | `brew install node@24` or nvm | installer from nodejs.org or `winget install OpenJS.NodeJS.LTS` |
| Native build tools (only if a prebuilt binary is missing) | `gcc-c++ make` / `build-essential` | `xcode-select --install` | Visual Studio Build Tools (C++ workload) |
| Containers for `test:int` | Docker, or Podman with the socket enabled (`systemctl --user enable --now podman.socket`, `DOCKER_HOST=unix://$XDG_RUNTIME_DIR/podman/podman.sock`, `TESTCONTAINERS_RYUK_DISABLED=true`) | Docker Desktop or Podman Desktop | Docker Desktop or Podman Desktop |
| Keychain for running the app | GNOME Keyring or KWallet (libsecret) | built in | built in |
| Packaging extras | `rpm` (`rpmbuild`) for `.rpm` | — | — |

Windows: run `.taskcheck` and npm scripts from Git for Windows' bash (TFP runs the check in `sh`).

## Commands (root `package.json`, created in M0)
| Command | What it does | Time budget |
|---|---|---|
| `npm run check` | lint + type check + unit tests of all workspaces | < 2 min, this is `.taskcheck` |
| `npm run coverage` | unit tests with V8 coverage | |
| `npm run test:int` | integration tests against containers | slow, own tasks |
| `npm run test:e2e` | Playwright against the built Electron app | slow, own tasks |
| `npm run dev` | renderer dev server + Electron with reload | |
| `npm run dist` | installers for the current OS into `dist/` | |

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

## Conventions
- TypeScript `strict`; no `any` in `contract` and `core`.
- `packages/core` stays free of Node and Electron APIs (it runs in the renderer too).
- Documents cross process boundaries only as canonical EJSON text.
- Never `eval` or `new Function` on user input outside the mongosh host.
- Every write path checks read-only in the backend, not only in the UI.
- Tests next to the code (`*.spec.ts`); integration tests under `test/integration/`.
- Prettier formatting (`.prettierrc` from JSON Canopy), commit messages in imperative mood.

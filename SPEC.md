# Thicket — specification

Status: **approved 2026-11-16.** Changes from here on go through the task board (new tasks or
edited todo tasks), and this file is updated with them.

Thicket is an open source desktop client for MongoDB (Linux, macOS, Windows). Its core is the
table/form document editor from JSON Canopy, extended for BSON, paging and server-side editing.
Source brief: `BRIEF.md`. Stack and build details: `docs/ARCHITECTURE.md`.

"MongoDB" is a trademark of MongoDB, Inc. Thicket is described as "a desktop client for MongoDB"
and does not use "Mongo" in its name, logo or package ids.

## 1. Goals

1. **A document editor that is better than a JSON text box.** Nested tables and forms, every
   BSON type first-class, edits that never change a type silently.
2. **Safe writes.** Nothing reaches the server before an explicit save; saves are minimal diffs with
   conflict detection; production connections and bulk operations ask first.
3. **Connects anywhere the owner works:** SRV/Atlas, replica sets, TLS, X.509, SSH tunnels, LDAP,
   OIDC, AWS IAM (Kerberos later).
4. **Handles big data:** collections of millions of documents and documents up to the 16 MB limit
   stay responsive.
5. **One install on all three OSes**, from GitHub releases.

## 2. Demo script (end of milestone M3)

1. Download the release for the OS from GitHub, install, start. The welcome screen offers "New
   connection" and "Import from Compass".
2. Paste an `mongodb+srv://` URI. The form fills in host, user and options; the password goes to the
   OS keychain. Mark the connection **production** (red accent). Connect.
3. The sidebar shows databases and collections (with document counts and sizes). Open `orders`.
4. The collection shows as a table, one row per document, 50 per page; page 3 of ~40 000 is one
   click away. Enter a filter `{status: "open", total: {$gt: 100}}` and a sort; results update.
5. Open a document. Nested `items` (an array of 2 000 subdocuments) pages inside the document.
   `_id` shows as ObjectId, `createdAt` as Date, `total` as Decimal128.
6. Edit `total` and set a new field. A diff bar shows "2 changes"; Save. Because the connection is
   production, a confirm dialog lists the `$set` operation. Save succeeds.
7. In a second window (or mongosh) change the same document, then edit it again in Thicket and
   Save: Thicket reports a conflict and shows both versions side by side.
8. Open the aggregation builder: `$match` → `$group` → `$sort`, preview per stage, export the
   pipeline as shell code and as Node code.
9. Indexes tab: create an index, run the earlier query with Explain, see IXSCAN instead of COLLSCAN.
10. Connect a second profile through an SSH tunnel with a key file and an X.509 certificate.
11. Open the mongosh console on the connection and run `db.orders.countDocuments()`.

## 3. Features (MoSCoW) by milestone

Milestones are in build order. A milestone is done when its Must items are done; Should/Could items
may slip to a later milestone.

### M0 — Foundation
- **Must** Electron app skeleton: main process, a backend `utilityProcess` that owns all driver
  work, Angular renderer (sandboxed, `contextIsolation`, no Node in the renderer).
- **Must** Typed IPC contract between renderer and backend (section 4), with request ids,
  cancellation and streamed results.
- **Must** The JSON Canopy explorer copied into `renderer/` and adapted: tables and form layouts,
  search, collapse, column hiding, in-place editing, raw editor.
- **Must** One `npm run check` (lint, type check, unit tests) under 2 minutes; CI runs it on Linux,
  macOS and Windows; CI builds unsigned installers for all three.
- **Must** Two visual styles, each in a light and a dark variant, chosen independently in settings
  (style: Business / Tron; mode: light / dark / follow system):
  - **Business** (default): professional and calm — system UI font, neutral greys with one restrained
    accent color, no glow/scanline/grid effects, compact density suited to large tables, clear focus
    rings; meets WCAG AA contrast in both modes.
  - **Tron**: the JSON Canopy look (Orbitron/Share Tech Mono, cyan glow, scanlines, grid) in its
    existing dark and light variants.
  Both are token sets over the same CSS custom properties (`data-style` × `data-theme` on the root),
  so components never hard-code colors; the production-connection red accent and the BSON type
  colors are tokens defined in every combination.

### M1 — Daily driver
Connections
- **Must** Connection profiles: name, color, folder/group; connection string or form (hosts, replica
  set, auth, TLS, read preference, app name, timeouts); a form edit updates the URI and vice versa.
- **Must** SRV (`mongodb+srv://`), standalone, replica set, sharded (mongos), `directConnection`.
- **Must** Auth: SCRAM-SHA-1/256 with auth database.
- **Must** TLS: on/off, CA file, allow invalid hostnames/certificates (with a warning).
- **Must** Secrets (passwords, key passphrases, tokens) only in the OS keychain via Electron
  `safeStorage`; profiles without secrets in `connections.json` in the app's config directory. On
  Linux without a keyring (`basic_text` backend), warn and default to "don't save password".
- **Must** "Ask for password each time" option per profile.
- **Must** Test connection button with a readable error (DNS, TLS, auth, timeout each explained).
- **Must** Several connections open at the same time; each in its own sidebar node.

Browsing
- **Must** Sidebar tree: databases → collections, views, time series; counts and sizes on demand.
- **Must** Create/drop/rename database and collection (drop asks for the name to be typed).
- **Must** Collection view: query bar with filter, projection, sort, collation, limit; history of
  recent queries per collection; saved ("favorite") queries.
- **Must** Paging: page size (20/50/100/500), first/previous/next/last/jump-to; range paging on the
  sort key when the sort is on an indexed unique key (`_id` by default), `skip`/`limit` otherwise;
  estimated count by default, exact count on request; queries can be cancelled.
- **Must** Result views: table (one row per document, Canopy's array-of-objects table), document list
  (each document as a nested table/form), and raw (shell syntax / EJSON).

Documents and BSON
- **Must** Every BSON type is first-class: ObjectId, Date, String, Int32, Int64, Double,
  Decimal128, Boolean, Null, Object, Array, Binary (with subtype; UUID subtype 4 shown as UUID),
  Regex, Timestamp, Code, MinKey, MaxKey. Deprecated types (Undefined, Symbol, DBPointer) are
  shown and kept unchanged; they can't be created.
- **Must** Each value shows its type badge; the type dropdown converts explicitly (e.g. String →
  ObjectId when valid, Int32 → Int64); editing a value never changes its type (a number typed into
  an Int64 stays Int64, overflow is an error).
- **Must** New numeric values default to Int32 if they are integers that fit, Double otherwise; the
  default can be changed in settings.
- **Must** Field order is preserved and fields can be moved.
- **Must** Dates show in local time with the timezone, toggle to UTC; edited with a date-time picker
  or ISO text.
- **Must** Raw editor in shell syntax (`ObjectId("…")`, `ISODate("…")`, `NumberLong(…)`) with a
  toggle to canonical EJSON v2; parsing never evaluates code (a safe parser, no `eval`).
- **Must** Paging inside a document: arrays and objects with more than N entries (default 100) page
  instead of "show more"; for documents above a size threshold the backend loads arrays page-wise
  with `$slice` projections instead of sending the whole document.

Editing and saving
- **Must** Edits stay local until **Save**. The document shows a "modified" marker and a change
  count; **Revert** discards them; undo/redo within the unsaved edits.
- **Must** Save sends one `updateOne` with the minimal `$set`/`$unset` diff (whole arrays are
  replaced when an array changed, unless only items were appended — then `$push`).
- **Must** Conflict detection: the update's filter is `_id` plus the original values of every
  changed top-level field. When it matches nothing, Thicket reloads the server version and shows a
  side-by-side diff with "overwrite", "keep server version" and "merge manually".
- **Must** Insert document (empty or from a copy), clone document, delete document (with confirm).
- **Should** "Undo last save": Thicket keeps the pre-save version and writes it back with the same
  conflict check.
- **Should** Edit several documents in the table view (same field across selected rows) and save
  them together; the confirm dialog lists the number of documents.

Safety
- **Must** Per-profile flags: **read-only** (all write UI disabled, and the backend refuses write
  operations as well) and **production** (color accent, confirm dialog for every write showing the
  operation).
- **Must** Bulk `updateMany`/`deleteMany` always show a preview (count of matched documents and a
  sample) and need confirmation; typing the collection name for deletes over 1 000 documents.

Import / export (basic)
- **Must** Export query results as JSON (EJSON relaxed/canonical) and JSON Lines.
- **Must** Import JSON / JSON Lines files into a collection (with a preview, ordered or unordered,
  stop or continue on error).

### M2 — Connectivity
- **Must** SSH tunnel: host, port, user; password, private key (with passphrase) or SSH agent;
  known-hosts check with "trust this host key" prompt; works for replica sets (one tunnel per
  member) and SRV.
- **Must** X.509 client certificates (cert + key file, or PEM bundle, with passphrase); MONGODB-X509
  auth.
- **Must** SOCKS5 proxy (driver `proxyHost` options).
- **Must** Read preference and write concern per profile; "open on secondary" for read-only work.
- **Must** Import connections from Compass (exported JSON file) and from a list of connection
  strings; export profiles as JSON without secrets (sharable with a team).
- **Should** Connection string with all options shown in a copyable form (password masked).

### M3 — Power tools
- **Must** Aggregation pipeline builder: list of stages (add, remove, reorder, disable), each stage
  edited as shell-syntax text with a preview of its output (sample-limited); full-text mode for the
  whole pipeline; run, page through results, save pipelines; export as shell, Node, Python, Java code.
- **Must** Create view from pipeline; `$out`/`$merge` stages ask first (they write).
- **Must** Explain plan for find and aggregate: tree of stages, keys/docs examined, time, index
  used; raw explain output in the document viewer.
- **Must** Index management: list with size and usage stats (`$indexStats`); create (fields and
  direction, unique, sparse, partial filter, TTL, collation, hidden, text/2dsphere/wildcard);
  drop; hide/unhide.
- **Must** Bulk update/delete from the query bar (see Safety).
- **Must** Schema analysis on a sample (default 1 000 documents): fields, types and their share,
  missing ratio, value examples; shown with the same table view; "use as filter" for a value.
- **Must** Import/export also as CSV (with field mapping and type per column) and as BSON dump
  (`mongodump`-compatible `.bson` per collection, no oplog).
- **Should** Collection validator (`$jsonSchema`): view, edit, validation level/action; documents
  failing the validator are marked in the editor.
- **Could** Query from schema analysis: click a field type to build a filter.

### M4 — Shell
- **Must** Embedded mongosh console per connection (the real mongosh runtime, running in the
  backend process): history, multi-line input, autocompletion, `use db`, output of documents in the
  Thicket viewer with a toggle to plain text.
- **Must** Read-only profiles open the shell with a warning (the server's own permissions are the
  only guard there); production profiles show the red accent in the shell too.
- **Should** Run a script file in the shell.

### M5 — More authentication
- **Must** LDAP (PLAIN) — needs MongoDB Enterprise or Atlas on the server side.
- **Must** OIDC (MONGODB-OIDC): authorization code flow with the system browser, device flow as a
  fallback; token cache in the keychain.
- **Must** AWS IAM (MONGODB-AWS): access key / secret / session token, or the default AWS credential
  chain (environment, profile, SSO, instance role).
- **Won't (later)** Kerberos (GSSAPI). The architecture must not rule it out (it is a native
  module, `kerberos`, in the backend).

### M6 — Administration
- **Should** currentOp list (filter by namespace/duration/op type, auto-refresh) and killOp with
  confirm.
- **Should** Users and roles: read-only view per database (privileges, inherited roles).
- **Could** Users and roles: create, edit, drop, grant/revoke.
- **Could** Change streams: watch a collection/database, live list of events, open the changed
  document.
- **Could** GridFS: list buckets and files, download, upload, delete.
- **Could** Server stats dashboard (`serverStatus`, `dbStats`, replica set status) with charts.

### Release (alongside the milestones)
- **Must** GitHub Actions builds on tag: AppImage, `.deb`, `.rpm` (Linux x64/arm64), `.dmg`
  (macOS arm64 and x64), NSIS installer and portable `.zip` (Windows x64), uploaded to a GitHub
  release with checksums. Unsigned for now; README explains the macOS Gatekeeper and Windows
  SmartScreen warnings.
- **Should** "Update available" notice that checks GitHub releases (no silent auto-update: macOS
  auto-update needs a signed app).
- **Should** Windows signing via the SignPath Foundation (free for open source).
- **Could** macOS signing and notarization later (Apple Developer account).

## 4. API contract (renderer ↔ backend)

The renderer never sees secrets or driver objects. It talks to the backend through one typed
contract, `packages/contract`, imported by both sides (TypeScript types plus runtime validation with
a schema library). Transport: Electron `MessagePort` between renderer and the backend
`utilityProcess`, brokered by the main process at startup; the preload script exposes only
`thicket.request()`, `thicket.cancel()` and `thicket.on()`.

Envelope:
```ts
type Request  = { id: string; method: string; params: unknown };
type Response = { id: string; ok: true; result: unknown }
              | { id: string; ok: false; error: { code: string; message: string; detail?: unknown } };
type Event    = { stream: string; kind: 'data' | 'end' | 'error'; payload: unknown };
```

- Documents always travel as **canonical EJSON v2 text** (lossless). The renderer parses it into
  its own BSON value model (`bson` package) for display and editing.
- Long operations (find, aggregate, import, export, shell output) return a `streamId`; results come
  as `Event`s; `cancel(id)` kills the server-side operation (`killCursors`/`killOp`).
- Error codes are stable strings (`AUTH_FAILED`, `TLS_ERROR`, `DNS_ERROR`, `TIMEOUT`, `CONFLICT`,
  `READ_ONLY`, `NOT_FOUND`, `SERVER_ERROR`, `CANCELLED`, …).

Method groups (exact signatures are written in the contract task, M0):

| Group | Methods |
|---|---|
| `profiles.*` | list, get, save, delete, duplicate, importCompass, importUris, export, setSecret, clearSecret |
| `conn.*` | test, open, close, status, serverInfo |
| `db.*` | listDatabases, create, drop, stats |
| `coll.*` | list, create, drop, rename, stats, validator.get/set |
| `docs.*` | find, count, estimatedCount, get, getSlice, insert, update (diff + expected values), replace, delete, updateMany/deleteMany (with `preview` and `confirm` steps) |
| `agg.*` | run, previewStage, explain, createView |
| `idx.*` | list, stats, create, drop, hide |
| `schema.*` | analyze |
| `io.*` | export, import (file chosen in the main process with a native dialog) |
| `shell.*` | open, eval, complete, close |
| `admin.*` | currentOp, killOp, users, roles, serverStatus, watch |
| `app.*` | settings get/set, theme, checkForUpdate |

Writes carry the profile id; the backend checks the profile's read-only flag itself. Confirmation
for production profiles is a renderer concern, but the backend requires a `confirmed: true` field on
writes to production profiles, so a forgotten dialog fails closed.

## 5. Data stored on disk

In Electron's `userData` directory (per OS default):
- `connections.json`: profiles without secrets; versioned schema with migrations.
- `secrets.bin`: secrets encrypted with `safeStorage`, keyed by profile id.
- `history/`, `favorites.json`, `pipelines.json`, `settings.json`.
- `known_hosts` for SSH host keys accepted in Thicket.

Nothing is sent anywhere except to the configured servers and, for the update notice, the GitHub
releases API (can be switched off).

## 6. Security requirements
- Renderer: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, strict CSP (no
  remote content; `unsafe-eval` only if Ajv validation needs it, see ARCHITECTURE), navigation and
  `window.open` blocked.
- Secrets never leave the backend/main processes; logs and error messages mask passwords in URIs.
- Shell-syntax parsing for queries and the raw editor uses a parser, never `eval`. Only the mongosh
  console runs user JavaScript, and it runs in the backend process.
- TLS verification is on by default; turning it off shows a persistent warning on the connection.

## 7. Testing
- Unit tests (Vitest) for the contract, BSON model, diff/save logic, paging, parsers: part of
  `npm run check`.
- Integration tests against real servers in containers (Testcontainers; Docker or Podman):
  MongoDB Community 7.0 and 8.x as replica set and standalone, TLS with generated certificates,
  X.509, an sshd container for tunnels, MongoDB Enterprise + OpenLDAP for LDAP, MongoDB Enterprise
  + Keycloak for OIDC. Run with `npm run test:int`, not in `.taskcheck` (too slow).
- AWS IAM needs Atlas or a real AWS setup: a human-verified task.
- End-to-end tests with Playwright's Electron support for the demo script steps (`npm run test:e2e`).
- Installers are smoke-tested on each OS in CI (app starts, connects to a containerized server on
  Linux; starts and shows the welcome screen on macOS/Windows).

## 8. Out of scope
- IntelliJ plugin, VS Code extension, web/server version.
- Client-side field-level encryption and Queryable Encryption.
- Atlas management (clusters, Atlas Search index UI, Data API).
- Kerberos until a later milestone.
- Signed builds and silent auto-update for now.
- Old servers the current Node driver no longer supports.
- Keeping code in sync with JSON Canopy.

## 9. Decisions on earlier open questions
- **Name:** Thicket. Repo `OldPeasant/thicket` on GitHub. Possible domain: `thicketdb.dev`.
- **Review-evidence gate:** on (`docs/QUALITY.md`).
- **Containers:** Podman (or Docker) with Testcontainers.
- **MongoDB Enterprise image** for LDAP/OIDC integration tests: accepted.
- **Telemetry:** none.
- **Pipeline code export:** shell, Node, Python, Java (assumed; can be extended later).

## 10. Open questions
None blocking. Agents record decisions the spec doesn't cover with `tasks.py assume`.

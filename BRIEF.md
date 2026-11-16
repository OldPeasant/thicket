# Brief

The source brief for `SPEC.md`, collected in the planning conversation of 2026-11-16.

## Idea
A desktop client for MongoDB built around the table view and editor of JSON Canopy
(copied into `packages/renderer/src/app/explorer`): documents show as nested, filterable tables (or forms) and every value
can be edited in place. On top of that the client connects to MongoDB servers, stores connections
and credentials, and covers what a full MongoDB GUI needs.

## Decisions taken
- **Standalone desktop app** for Linux, macOS and Windows. No IntelliJ plugin, no VS Code extension.
- **Electron**, backend in Node with the official MongoDB Node driver.
- **Separate open source project.** Code from JSON Canopy may be copied freely (no reference to it,
  no keeping in sync). License: Apache-2.0, like Canopy.
- **Name:** Thicket (Coppice was the alternative; see SPEC.md "Open questions").
- **Implemented with the Task Flow Protocol** (https://github.com/OldPeasant/tfp), largely by Claude
  Code agents. A large project is fine.

## Requirements from the owner
- **Connection and auth:** connection string / SRV (Atlas), username/password (SCRAM), TLS, X.509
  client certificates, SSH tunnels, LDAP, AWS IAM, OIDC. Kerberos is optional and comes later.
- **Connection profiles:** stored in the app's config directory, secrets in the OS keychain. Import
  from Compass and from connection strings; export or share profiles without secrets.
- **Scope beyond browse/edit:** query editor (filter, sort, projection), aggregation pipelines, index
  management, import/export, schema analysis, explain plans.
- **Embedded mongosh console** (the real one, not a look-alike).
- **Write semantics:** explicit save, diff-based updates, conflict detection when someone else
  changed the document, bulk edits.
- **Safety:** read-only connections, a "production" marker with confirm-before-write, confirmation
  for bulk updates/deletes, undo.
- **Scale:** paging for collections and also inside very large documents (Canopy only has
  "show more" buttons).
- **BSON types:** whatever works best with MongoDB (decided: every BSON type first-class, see SPEC.md).
- **Server versions:** whatever the current Node driver supports; no need for old servers.
- **Distribution:** unsigned GitHub releases to start with.
- **Order of work:** daily-driver basics first (SCRAM + TLS + SRV, browse, query, edit, save), then
  SSH and certificates, then aggregation and indexes, then the remaining auth methods.

## Extra scope (agreed)
| Feature | Priority |
|---|---|
| currentOp / killOp | Should |
| Users & roles | Should view, Could edit |
| Change streams / live watch | Could |
| GridFS browse/upload/download | Could |
| Server stats dashboard | Could |
| Client-side field-level / Queryable Encryption | Won't (for now) |
| Atlas-specific features (Atlas Search UI, cluster management) | Won't |

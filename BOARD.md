# Task board

```mermaid
graph LR
  agg_backend["M3: Aggregation run, stage preview, explain, views"]:::todo
  agg_ui["M3: Aggregation pipeline builder"]:::todo
  api_client["M0: Renderer API client over window.thicket"]:::todo
  app_layout["M0: Application layout: sidebar, tabs, status bar, welcome screen"]:::todo
  app_settings["M0: Settings store in main (settings.json, app.* methods)"]:::todo
  auth_ui_m5["M5: Connection editor for LDAP, OIDC and AWS"]:::todo
  aws_auth["M5: AWS IAM authentication"]:::todo
  aws_verify["M5: Human: verify AWS IAM against Atlas"]:::todo
  browse_backend["M1: Databases and collections (db.*, coll.*)"]:::todo
  bson_display["M1: Explorer shows BSON types"]:::todo
  bson_inputs["M1: Explorer edits BSON values without changing types"]:::todo
  bson_model["Core: BSON value model with lossless EJSON round trip"]:::todo
  bulk_ops_ui["M3: Bulk update and delete from the query bar"]:::todo
  change_streams["M6 (Could): Watch changes"]:::todo
  ci_check["M0: GitHub Actions runs the check on Linux, macOS and Windows"]:::todo
  codegen["M3: Code export (shell, Node, Python, Java)"]:::todo
  collection_view["M1: Collection tab: query bar, pager and result views"]:::todo
  conflict_ui["M1: Conflict resolution view"]:::todo
  conn_manager["M1: Connection manager: SCRAM, TLS, SRV, test, errors, write guard"]:::todo
  conn_ui_m2["M2: Connection editor for SSH, X.509, proxy and read preference"]:::todo
  connection_ui["M1: Connection editor and manager"]:::todo
  contract["M0: Typed IPC contract (envelope, errors, all method groups)"]:::todo
  currentop["M6 (Should): currentOp and killOp"]:::todo
  diff_ops["Core: edit diff → update operations and conflict filter"]:::todo
  doc_edit_save["M1: Edit session and explicit save"]:::todo
  doc_paging["M1: Paging inside documents"]:::todo
  docs_query_backend["M1: Query documents with paging, counts, cancel and slices"]:::todo
  docs_write_backend["M1: Document writes with conflict detection"]:::todo
  e2e_harness["M0: Playwright end-to-end harness for the Electron app"]:::todo
  electron_shell["M0: Electron main, preload, backend utilityProcess and port broker"]:::todo
  explain_ui["M3: Explain plan viewer"]:::todo
  explorer_copy["M0: Copy the JSON Canopy explorer into the renderer"]:::todo
  final_demo["Release: full demo script end to end"]:::todo
  gridfs["M6 (Could): GridFS"]:::todo
  index_backend["M3: Index management backend"]:::todo
  index_ui["M3: Indexes tab"]:::todo
  installer_smoke["Release: smoke-test installers in CI"]:::todo
  int_harness["M0: Integration test harness with MongoDB containers"]:::todo
  io_advanced["M3: CSV import/export and BSON dump"]:::todo
  io_basic_backend["M1: Export and import JSON / JSON Lines"]:::todo
  io_basic_ui["M1: Import/export dialogs"]:::todo
  ldap_auth["M5: LDAP (PLAIN) authentication"]:::todo
  m1_e2e["M1: End-to-end demo steps 2–7"]:::todo
  mongosh_spike["M4: Spike: embedding mongosh in the backend process"]:::todo
  multi_doc_edit["M1 (Should): Edit a field across selected rows"]:::todo
  oidc_auth["M5: OIDC authentication"]:::todo
  packaging["M0: electron-builder packaging for the current OS"]:::todo
  paging_core["Core: collection paging strategy"]:::todo
  profiles_import_export["M2: Import from Compass and URIs, export without secrets"]:::todo
  profiles_store["M1: Connection profiles store (connections.json)"]:::todo
  query_history["M1: Query history and favorites"]:::todo
  raw_editor["M1: Raw editor in shell syntax and EJSON"]:::todo
  readme["Release: README and user docs"]:::todo
  release_ci["Release: GitHub Actions builds installers on tag"]:::todo
  renderer_scaffold["M0: Angular renderer workspace"]:::todo
  safety_ui["M1: Safety UI: production accent, read-only state, confirm dialog service"]:::todo
  scaffold["M0: Monorepo scaffold with npm workspaces and the check"]:::todo
  schema_analysis["M3: Schema analysis"]:::todo
  secrets_store["M1: Secrets in the OS keychain via safeStorage"]:::todo
  server_stats["M6 (Could): Server stats dashboard"]:::todo
  shell_backend["M4: mongosh host in the backend"]:::todo
  shell_scripts["M4 (Should): Run a script file in the shell"]:::todo
  shell_syntax["Core: shell syntax ⇄ EJSON (safe parser and printer)"]:::todo
  shell_ui["M4: mongosh console"]:::todo
  sidebar_tree["M1: Sidebar tree of connections, databases, collections"]:::todo
  ssh_tunnel["M2: SSH tunnels"]:::todo
  themes["M0: Business and Tron styles, each light and dark"]:::todo
  undo_last_save["M1 (Should): Undo last save"]:::todo
  update_notice["Release (Should): Update available notice"]:::todo
  uri_model["Core: connection profile ⇄ connection string"]:::todo
  users_roles_edit["M6 (Could): Edit users and roles"]:::todo
  users_roles_view["M6 (Should): Users and roles viewer"]:::todo
  validator["M3 (Should): Collection validator"]:::todo
  x509_proxy["M2: X.509, SOCKS5 proxy, read preference and write concern"]:::todo
  docs_query_backend --> agg_backend
  agg_backend --> agg_ui
  collection_view --> agg_ui
  codegen --> agg_ui
  raw_editor --> agg_ui
  renderer_scaffold --> api_client
  contract --> api_client
  themes --> app_layout
  api_client --> app_layout
  electron_shell --> app_settings
  ldap_auth --> auth_ui_m5
  oidc_auth --> auth_ui_m5
  aws_auth --> auth_ui_m5
  conn_ui_m2 --> auth_ui_m5
  profiles_import_export --> auth_ui_m5
  x509_proxy --> aws_auth
  auth_ui_m5 --> aws_verify
  conn_manager --> browse_backend
  explorer_copy --> bson_display
  bson_model --> bson_display
  themes --> bson_display
  bson_display --> bson_inputs
  scaffold --> bson_model
  doc_edit_save --> bulk_ops_ui
  safety_ui --> bulk_ops_ui
  docs_query_backend --> change_streams
  collection_view --> change_streams
  scaffold --> ci_check
  shell_syntax --> codegen
  sidebar_tree --> collection_view
  docs_query_backend --> collection_view
  bson_display --> collection_view
  paging_core --> collection_view
  shell_syntax --> collection_view
  doc_edit_save --> conflict_ui
  profiles_store --> conn_manager
  int_harness --> conn_manager
  uri_model --> conn_manager
  ssh_tunnel --> conn_ui_m2
  x509_proxy --> conn_ui_m2
  connection_ui --> conn_ui_m2
  app_layout --> connection_ui
  api_client --> connection_ui
  profiles_store --> connection_ui
  uri_model --> connection_ui
  safety_ui --> connection_ui
  scaffold --> contract
  conn_manager --> currentop
  app_layout --> currentop
  safety_ui --> currentop
  bson_model --> diff_ops
  collection_view --> doc_edit_save
  docs_write_backend --> doc_edit_save
  bson_inputs --> doc_edit_save
  safety_ui --> doc_edit_save
  bson_inputs --> doc_paging
  docs_query_backend --> doc_paging
  conn_manager --> docs_query_backend
  paging_core --> docs_query_backend
  conn_manager --> docs_write_backend
  diff_ops --> docs_write_backend
  electron_shell --> e2e_harness
  int_harness --> e2e_harness
  contract --> electron_shell
  renderer_scaffold --> electron_shell
  agg_ui --> explain_ui
  renderer_scaffold --> explorer_copy
  m1_e2e --> final_demo
  agg_ui --> final_demo
  explain_ui --> final_demo
  index_ui --> final_demo
  conn_ui_m2 --> final_demo
  shell_ui --> final_demo
  browse_backend --> gridfs
  app_layout --> gridfs
  browse_backend --> index_backend
  index_backend --> index_ui
  collection_view --> index_ui
  release_ci --> installer_smoke
  e2e_harness --> installer_smoke
  scaffold --> int_harness
  io_basic_ui --> io_advanced
  docs_query_backend --> io_basic_backend
  io_basic_backend --> io_basic_ui
  collection_view --> io_basic_ui
  safety_ui --> io_basic_ui
  x509_proxy --> ldap_auth
  connection_ui --> m1_e2e
  collection_view --> m1_e2e
  doc_edit_save --> m1_e2e
  conflict_ui --> m1_e2e
  doc_paging --> m1_e2e
  raw_editor --> m1_e2e
  io_basic_ui --> m1_e2e
  electron_shell --> mongosh_spike
  doc_edit_save --> multi_doc_edit
  x509_proxy --> oidc_auth
  electron_shell --> packaging
  scaffold --> paging_core
  conn_ui_m2 --> profiles_import_export
  profiles_store --> profiles_import_export
  secrets_store --> profiles_store
  contract --> profiles_store
  collection_view --> query_history
  app_settings --> query_history
  shell_syntax --> raw_editor
  bson_display --> raw_editor
  m1_e2e --> readme
  packaging --> release_ci
  ci_check --> release_ci
  scaffold --> renderer_scaffold
  app_layout --> safety_ui
  api_client --> safety_ui
  docs_query_backend --> schema_analysis
  collection_view --> schema_analysis
  electron_shell --> secrets_store
  conn_manager --> server_stats
  app_layout --> server_stats
  mongosh_spike --> shell_backend
  conn_manager --> shell_backend
  shell_ui --> shell_scripts
  bson_model --> shell_syntax
  shell_backend --> shell_ui
  app_layout --> shell_ui
  bson_display --> shell_ui
  app_layout --> sidebar_tree
  api_client --> sidebar_tree
  browse_backend --> sidebar_tree
  safety_ui --> sidebar_tree
  conn_manager --> ssh_tunnel
  explorer_copy --> themes
  app_settings --> themes
  doc_edit_save --> undo_last_save
  app_settings --> update_notice
  app_layout --> update_notice
  scaffold --> uri_model
  users_roles_view --> users_roles_edit
  safety_ui --> users_roles_edit
  conn_manager --> users_roles_view
  app_layout --> users_roles_view
  browse_backend --> validator
  doc_edit_save --> validator
  conn_manager --> x509_proxy
  classDef todo fill:#e5e7eb
  classDef in_progress fill:#fde68a
  classDef done fill:#86efac
  classDef dropped fill:#f3f4f6
```

| Task | Status | Owner | Unblocks | Ready |
|---|---|---|---|---|
| scaffold | todo |  | 73 | yes |
| renderer-scaffold | todo |  | 63 |  |
| contract | todo |  | 62 |  |
| electron-shell | todo |  | 60 |  |
| int-harness | todo |  | 46 |  |
| secrets-store | todo |  | 46 |  |
| profiles-store | todo |  | 45 |  |
| uri-model | todo |  | 45 |  |
| conn-manager | todo |  | 43 |  |
| app-settings | todo |  | 39 |  |
| explorer-copy | todo |  | 39 |  |
| themes | todo |  | 38 |  |
| api-client | todo |  | 34 |  |
| app-layout | todo |  | 33 |  |
| bson-model | todo |  | 28 |  |
| safety-ui | todo |  | 26 |  |
| bson-display | todo |  | 23 |  |
| paging-core | todo |  | 22 |  |
| browse-backend | todo |  | 21 |  |
| docs-query-backend | todo |  | 21 |  |
| shell-syntax | todo |  | 20 |  |
| sidebar-tree | todo |  | 18 |  |
| collection-view | todo |  | 17 |  |
| bson-inputs | todo |  | 10 |  |
| diff-ops | todo |  | 10 |  |
| docs-write-backend | todo |  | 9 |  |
| doc-edit-save | todo |  | 8 |  |
| x509-proxy | todo |  | 8 |  |
| connection-ui | todo |  | 7 |  |
| io-basic-backend | todo |  | 5 |  |
| raw-editor | todo |  | 5 |  |
| ssh-tunnel | todo |  | 5 |  |
| conn-ui-m2 | todo |  | 4 |  |
| io-basic-ui | todo |  | 4 |  |
| mongosh-spike | todo |  | 4 |  |
| agg-backend | todo |  | 3 |  |
| codegen | todo |  | 3 |  |
| conflict-ui | todo |  | 3 |  |
| doc-paging | todo |  | 3 |  |
| shell-backend | todo |  | 3 |  |
| agg-ui | todo |  | 2 |  |
| aws-auth | todo |  | 2 |  |
| ci-check | todo |  | 2 |  |
| index-backend | todo |  | 2 |  |
| ldap-auth | todo |  | 2 |  |
| m1-e2e | todo |  | 2 |  |
| oidc-auth | todo |  | 2 |  |
| packaging | todo |  | 2 |  |
| profiles-import-export | todo |  | 2 |  |
| shell-ui | todo |  | 2 |  |
| auth-ui-m5 | todo |  | 1 |  |
| e2e-harness | todo |  | 1 |  |
| explain-ui | todo |  | 1 |  |
| index-ui | todo |  | 1 |  |
| release-ci | todo |  | 1 |  |
| users-roles-view | todo |  | 1 |  |
| aws-verify | todo |  | 0 |  |
| bulk-ops-ui | todo |  | 0 |  |
| change-streams | todo |  | 0 |  |
| currentop | todo |  | 0 |  |
| final-demo | todo |  | 0 |  |
| gridfs | todo |  | 0 |  |
| installer-smoke | todo |  | 0 |  |
| io-advanced | todo |  | 0 |  |
| multi-doc-edit | todo |  | 0 |  |
| query-history | todo |  | 0 |  |
| readme | todo |  | 0 |  |
| schema-analysis | todo |  | 0 |  |
| server-stats | todo |  | 0 |  |
| shell-scripts | todo |  | 0 |  |
| undo-last-save | todo |  | 0 |  |
| update-notice | todo |  | 0 |  |
| users-roles-edit | todo |  | 0 |  |
| validator | todo |  | 0 |  |

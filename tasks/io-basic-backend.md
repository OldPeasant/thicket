---
title: M1: Export and import JSON / JSON Lines
status: in_progress
owner: felix/agent-1
deps: [docs-query-backend]
touches: [packages/backend/src/io,apps/desktop/src/dialogs]
prio: 2
lease_until: 2026-11-17T00:58:17Z
---
## Goal
Export a query result as JSON array or JSON Lines (EJSON relaxed or canonical) streamed to a file chosen in a native dialog; import JSON/JSONL with preview, ordered/unordered, stop/continue on error, progress events.

## Acceptance criteria
- [x] Integration test: export 10 000 docs and import into a new collection gives identical documents (canonical)
  - verified (2026-11-17 01:42+0100 by felix/agent-1): npm run test:int -- io.int (MongoDB container via Podman, HEAD 85deb3b) -> 10/10 passed; 'exports 10 000 documents as jsonl/json (canonical) and imports them unchanged' compares all 10 000 canonical docs of source and new collection: equal
- [ ] Import with a bad line: continue mode reports the line number and imports the rest (int test)
- [ ] Memory stays bounded: export streams (test with 200 000 small docs checks no full buffering)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-17 00:55+0100 by felix/agent-1): io.* methods are routed to the backend instead of main: the backend asks main for the native dialog over the privileged port (new privileged dialog.saveFile/dialog.openFile). This keeps streams/cancel direct, puts io.import behind the existing backend write guard, and still never lets the renderer send paths.
- ASSUMPTION (2026-11-17 00:55+0100 by felix/agent-1): IoProgress.processed = documents read from the file (import) / written (export); errors[].index = 1-based line number where the failed document starts; end.delivered = documents inserted/written.
- ASSUMPTION (2026-11-17 00:55+0100 by felix/agent-1): Defaults: ordered=true, stopOnError=true. Stop mode inserts the documents of lines before the failure, then ends the stream with the failure's error. Continue + ordered resubmits the rest of a batch after a write error.
- ASSUMPTION (2026-11-17 00:55+0100 by felix/agent-1): Export default EJSON mode is relaxed (like mongoexport); JSON export is a single array; JSON import also accepts concatenated documents (mongoexport default output). A failed or cancelled export deletes the partial file. Import preview skips values that do not parse.

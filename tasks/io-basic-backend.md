---
title: M1: Export and import JSON / JSON Lines
status: in_progress
owner: felix/agent-1
deps: [docs-query-backend]
touches: [packages/backend/src/io,apps/desktop/src/dialogs]
prio: 2
lease_until: 2026-11-17T00:12:50Z
---
## Goal
Export a query result as JSON array or JSON Lines (EJSON relaxed or canonical) streamed to a file chosen in a native dialog; import JSON/JSONL with preview, ordered/unordered, stop/continue on error, progress events.

## Acceptance criteria
- [ ] Integration test: export 10 000 docs and import into a new collection gives identical documents (canonical)
- [ ] Import with a bad line: continue mode reports the line number and imports the rest (int test)
- [ ] Memory stays bounded: export streams (test with 200 000 small docs checks no full buffering)

## Notes
See SPEC.md and docs/ARCHITECTURE.md.

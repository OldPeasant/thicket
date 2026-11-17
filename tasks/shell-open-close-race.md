---
title: Shell opening during conn.close/tunnel loss outlives the connection
status: in_progress
owner: dell26/agent-3
deps: [shell-backend]
touches: [packages/backend/src/shell]
prio: 2
lease_until: 2026-11-17T05:17:26Z
---
## Goal
`shell.open` reads the connection's config, waits for the worker to connect, and only then registers
the session (`packages/backend/src/shell/handlers.ts`, `host.ts` open). A `conn.close` or SSH tunnel
loss during that wait closes the profile's shells before this session exists, so on a direct
connection the new shell outlives its connection (shell-backend review round 6, CR-1, P3).

## Acceptance criteria
- [ ] A `conn.close` (or status error/disconnected) while `shell.open` is pending makes that open answer `CANCELLED` and terminates its worker (unit test in handlers.spec.ts or host.spec.ts)
- [ ] A shell opened after a reconnect is unaffected (unit test)

## Notes
See reviews/shell-backend/review.md round 6.
- ASSUMPTION (2026-11-17 05:57+0100 by dell26/agent-3): Review CR-1 (P3) not fixed: a reconnect that overlaps a still-running conn.close (closeProfile runs after the manager's close grace) can lose shells opened on the new connection. The renderer waits for conn.close before reconnecting, and the fix belongs in server/backend.ts (outside this task's touches).
- ASSUMPTION (2026-11-17 05:57+0100 by dell26/agent-3): closeAll() at backend shutdown does not cancel opens in flight (test-writer note): out of the criteria; the process exits and takes its worker threads with it.

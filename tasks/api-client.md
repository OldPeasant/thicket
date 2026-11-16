---
title: M0: Renderer API client over window.thicket
status: todo
owner:
deps: [renderer-scaffold,contract]
touches: [packages/renderer/src/app/api]
prio: 1
---
## Goal
Typed Angular service wrapping `window.thicket`: `request<M>()` typed by the contract, streams as Observables with cancel on unsubscribe, error codes mapped to user-readable messages, a fake implementation for tests.

## Acceptance criteria
- [ ] Unit tests with the fake: typed request/response, stream data/end/error, unsubscribe sends cancel
- [ ] Every contract error code has a message (test enumerates the codes)
- [ ] Fake is exported for other renderer tests to use

## Notes
See SPEC.md and docs/ARCHITECTURE.md.

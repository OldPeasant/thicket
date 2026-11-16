---
title: M0: Renderer API client over window.thicket
status: done
owner: felix/agent-2
deps: [renderer-scaffold,contract]
touches: [packages/renderer/src/app/api]
prio: 1
lease_until: 
---
## Goal
Typed Angular service wrapping `window.thicket`: `request<M>()` typed by the contract, streams as Observables with cancel on unsubscribe, error codes mapped to user-readable messages, a fake implementation for tests.

## Acceptance criteria
- [x] Unit tests with the fake: typed request/response, stream data/end/error, unsubscribe sends cancel
  - verified (2026-11-16 19:25+0100 by felix/agent-2): npm run test -w packages/renderer (ng test, Vitest+jsdom) -> 181 passed; api.service.spec.ts uses FakeThicketBridge: typed request/response (expectTypeOf ResultOf), stream data/end/error, unsubscribe sends cancel with request id (pending) or streamId (running)
- [x] Every contract error code has a message (test enumerates the codes)
  - verified (2026-11-16 19:25+0100 by felix/agent-2): api-error.spec.ts it.each(ERROR_CODES) over ERROR_MESSAGES (Record<ErrorCode,string>) plus exact key-set test; npm run test -w packages/renderer -> passed for all 17 codes
- [x] Fake is exported for other renderer tests to use
  - verified (2026-11-16 19:25+0100 by felix/agent-2): FakeThicketBridge and provideFakeThicket exported from packages/renderer/src/app/api/testing/index.ts; fake-thicket-bridge.spec.ts asserts the index exports, api.service.spec.ts uses them via TestBed -> passed

## Notes
See SPEC.md and docs/ARCHITECTURE.md.
- ASSUMPTION (2026-11-16 19:12+0100 by felix/agent-2): window.thicket shape (electron-shell not yet merged): request(Request envelope with renderer-chosen id): Promise<Response>, cancel(id): void, on(listener: (Event) => void): () => void. Renderer chooses ids so it can cancel before the response; electron-shell's preload should match ThicketBridge in packages/renderer/src/app/api/thicket-bridge.ts
- ASSUMPTION (2026-11-16 19:12+0100 by felix/agent-2): ApiService does not zod-validate results in the renderer (backend/main validate with parseResult); a missing window.thicket answers INTERNAL with a readable message instead of throwing, so ng serve still renders
- done by felix/agent-2: `if [ -f package.json ]; then npm run check; else python3 tasks.py check; fi` passed in 19s on bc36220c4; criteria verified 3/3

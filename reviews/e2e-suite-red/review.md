# Code Review

Date: 2026-11-17

Task: e2e-suite-red - Test: fix failing e2e tests (layout Compass heading, sidebar drag, LDAP fixture start)

Scope: committed task changes 99822f17..0afc4384 (commits 19f1b5f6 and 0afc4384). An uncommitted modification of `packages/renderer/src/app/layout/app-shell.spec.ts` present in the working tree during the review is outside the reviewed scope.

Requirements:
- tasks/e2e-suite-red.md acceptance criteria and its ASSUMPTION notes
- SPEC.md, docs/ARCHITECTURE.md ("End-to-end tests"), AGENTS.md, docs/QUALITY.md
- Parent instructions (document listener interference, multiple AppShell instances, pointercancel semantics, maintainability)

Git range:
- Branch: main
- HEAD: 0afc438492cfcde840e1e9669a5659206a37ff39
- Base/start: 99822f17381bb12183df3ac07f81791afd91c511
- Commits reviewed: 2

Summary: 0 P0, 0 P1, 1 P2, 1 P3

Checked and not reported:
- Interference with other pointer interactions: `dragMove`/`dragEnd` return immediately unless a splitter drag is active and the pointer id matches; they call neither `preventDefault` nor `stopPropagation`, so tab drag, sidebar tree (`document:mousedown`), the query history menu (`document:pointerdown`) and the column menu are not affected.
- Multiple AppShell instances: there is one AppShell per window (one document each); `drag` state is per instance and guarded by pointer id.
- pointercancel: still ends the drag and saves the last previewed width, as before; only pointerup takes the release position. A click without movement still saves nothing (`commit` sees the unchanged stored value).
- LDAP fixture: containers and the network are still stopped on the new error path (the existing `catch` calls `stop()`); the unsupported error is only raised when the Enterprise container actually failed to start, on Linux, with a kernel in the affected range, and it keeps the original reason in its message. The other failures are rethrown unchanged.
- The app-bug criterion (#2) is covered: `app-shell.spec.ts` dispatches move/up on another element (bubbling to the document) and checks the preview, the saved width, that later moves do nothing, and that a release without intermediate moves takes the release position.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | On affected hosts the LDAP e2e test is skipped rather than passing, and the cause is unconfirmed**
    - File: `test/e2e/ldap.e2e.ts:28` (with `test/integration/fixtures/ldap.ts:183`)
    - Category: Tests
    - Problem: Criterion #1 says "the three tests pass". The change does not make `ldap.e2e.ts:33` pass on the host where it failed. It makes the test skip there, based on a kernel-range hypothesis (SERVER-121912) that, according to the task's own ASSUMPTION note, could not be reproduced here (kernel 7.1.3 is outside the range). On such a host, any Enterprise-container start failure (for example an image pull or a log-wait timeout for another reason) is also reported as "unsupported" and skipped.
    - Why it matters: if the hypothesis is wrong, the original failure on that host becomes a silent skip and the criterion's "pass" is not met there. A skip is visible in the report with the reason, but it is not a pass.
    - Suggested fix: no code change needed if humans accept the assumption. When recording evidence for criterion #1, say exactly where the LDAP test passed (this host, under a display and headless) and that it skips on hosts with kernels 6.19.0-7.0.13 because the cause there was not reproduced. Do not record it as passing everywhere. Optionally, raise `LdapFixtureUnsupportedError` only when the container log or reason matches the known refusal, so other start failures still fail.

## P3 Low

- [ ] **CR-2 | Document-level pointermove host listener triggers a change-detection pass on every pointer move**
    - File: `packages/renderer/src/app/layout/app-shell.ts:71`
    - Category: Quality
    - Problem: the app is zoneless (`provideZonelessChangeDetection()` in `app.config.ts`). Angular template and host listeners mark their view dirty and schedule an application tick each time they fire, even when the handler returns early. `(document:pointermove)` on the root AppShell therefore schedules a tick for every mouse move anywhere in the window, not only during a splitter drag. Before this change, pointermove was only listened to on the splitter.
    - Why it matters: AppShell and the explorer hosts are OnPush, so each tick is cheap. Still, this is avoidable work on the hottest event in the UI (hovering large result tables). It also makes `(document:pointermove)` a pattern that others may copy.
    - Suggested fix: add the document `pointermove`/`pointerup`/`pointercancel` listeners in `dragStart` (for example with `Renderer2.listen` or `addEventListener`, outside Angular's listener wrapping) and remove them in `dragEnd` and on destroy. The preview is signal-based, so it still renders without the listener marking the view dirty.

## Review conclusion

No material issues found. CR-1 concerns how criterion #1 is evidenced, and the human-reviewed assumption, rather than a code defect. CR-2 is optional.

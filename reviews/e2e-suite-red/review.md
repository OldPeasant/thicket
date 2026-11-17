# Code Review

Date: 2026-11-17

Task: e2e-suite-red - Test: fix failing e2e tests (layout Compass heading, sidebar drag, LDAP fixture start)

Scope: second review round on the final code. Committed task changes 99822f17..8d46a2d2 (commits 19f1b5f6, 0afc4384, 91295397, 8d46a2d2), including the fixer's change to `packages/renderer/src/app/layout/app-shell.ts` (CR-2 of round one) and the test-writer's new tests (`test/integration/ldap-fixture-start.int.spec.ts`, `test/integration/ldap-fixture.int.spec.ts`, `packages/renderer/src/app/layout/app-shell.spec.ts`). The working tree was clean. Playwright/e2e was not run by the reviewer, as the parent instructed.

Requirements:
- tasks/e2e-suite-red.md acceptance criteria and its ASSUMPTION notes
- SPEC.md, docs/ARCHITECTURE.md ("End-to-end tests"), AGENTS.md, docs/QUALITY.md ("Freshness")
- Parent instructions: review the whole task diff at the final revision; criterion 1 will be recorded as passing on this host (display and headless), with a note that ldap.e2e skips on hosts with kernels 6.19.0-7.0.13
- reviews/e2e-suite-red/fixes.md and reviews/e2e-suite-red/tests.md

Git range:
- Branch: main
- HEAD: 8d46a2d2d2b4313f98c496b9ff5cdb984e63bdc9
- Base/start: 99822f17381bb12183df3ac07f81791afd91c511
- Commits reviewed: 4

Summary: 0 P0, 0 P1, 1 P2, 0 P3

Checked and not reported:
- Round-one CR-2 (document host listeners scheduled change detection on every pointer move) is resolved. The `(document:pointer*)` host bindings and the old splitter `(pointermove)/(pointerup)/(pointercancel)` bindings are gone. `dragStart` attaches plain DOM listeners to the injected `DOCUMENT` only after a primary-button press (`listenToDrag`). `listenToDrag` first removes any listeners already attached, so a second press cannot leave duplicates. `dragEnd` removes them for the dragging pointer's release or cancel, and `DestroyRef.onDestroy` removes them when the shell is destroyed. The width preview is a signal (`SidebarWidthService.preview`), so it still renders in the zoneless app without Angular's listener wrapping.
- With pointer capture in effect, events are retargeted to the splitter and still bubble to the document, so the document listeners cover both the captured and the uncaptured case. The handlers call neither `preventDefault` nor `stopPropagation`, so other document-level pointer handlers (tab drag, sidebar tree, query history menu) are not affected.
- `dragEnd(event, atPointer)`: pointerup takes the release position (clamped by the service), and pointercancel keeps the last previewed width. A cancel or a click without movement saves nothing, because `commit` sees the unchanged width. Events from another pointer id are ignored.
- LDAP fixture: `LdapFixtureUnsupportedError` is only raised when the Enterprise container start was rejected, `process.platform === 'linux'` and `os.release()` is in 6.19.0-7.0.13. The message keeps the original reason. Other failures are rethrown unchanged, OpenLDAP first, which is the same order as before. On every error path, the existing `catch` stops the containers that started and the network. `ldap.e2e.ts` only turns that specific error into a skip with its message, and still fails on any other error.
- `kernelBreaksMongo80` parses major.minor[.patch] and returns false for unparsable input. The boundaries (6.19.0, 7.0.13 and 7.0.14) are tested.
- Tests: `ldap-fixture-start.int.spec.ts` replaces `testcontainers` and `os.release` with fakes, restores `process.platform` and the `release` mock after each test, and checks that resources are cleaned up. The new `app-shell.spec.ts` drag tests dispatch on other elements or on the document itself. They cover the app-bug criterion (#2): moves and the release off the splitter, the release position, cancel semantics, other pointer ids, a second drag, no effect without a splitter press, and listener removal on release, cancel and destroy. The `addEventListener` spies in the fixer's test are undone by the describe block's `afterEach(() => vi.restoreAllMocks())`.
- No secrets: the fixture passwords are generated per run (`secret()`), and the test fixtures use only fictitious error strings.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | On affected hosts the LDAP e2e test is skipped, not passing, and any Enterprise start failure there is classified as "unsupported"**
    - File: `test/integration/fixtures/ldap.ts:183` (used by `test/e2e/ldap.e2e.ts:28`)
    - Category: Tests
    - Problem: This is unchanged from round one. On a Linux host with a kernel between 6.19.0 and 7.0.13, every rejected Enterprise container start becomes `LdapFixtureUnsupportedError`, and `ldap.e2e.ts` then skips. That includes an image pull failure or a log-wait timeout with a different cause. The SERVER-121912 attribution was not reproduced: this host runs 7.1.3, as the task's ASSUMPTION note and tests.md say.
    - Why it matters: Criterion #1 says "pass". On the host where the original failure was seen, the test now skips, so the criterion is met only on unaffected hosts. If the kernel hypothesis is wrong, a real fixture failure on such a host is hidden as a skip. The skip reason is visible in the report, which limits the impact.
    - Suggested fix: The parent's announced evidence wording handles the evidence side. It records criterion #1 as passing on this host (display and headless) and states that ldap.e2e skips on hosts with kernels 6.19.0-7.0.13. The recorded ASSUMPTION is still for humans to confirm. If more certainty is wanted, raise the unsupported error only when the container's exit log or the rejection reason matches the known refusal, so that other start failures still fail.

## P3 Low

None.

## Review conclusion

No material issues found. CR-1 is about how criterion #1 is evidenced and about the human-reviewed assumption, not a code defect. The parent's planned evidence wording covers it.

Process note for the parent (not a code finding): `reviews/e2e-suite-red/tests.md` was written at 91295397, before the fixer's code change in 8d46a2d2. It still describes the removed host bindings (coverage note on "lines 67-73") and reports 72 app-shell tests, while there are now 73. Under docs/QUALITY.md "Freshness", the test-writer evidence is stale for the final revision until the test-writer runs again on 8d46a2d2.

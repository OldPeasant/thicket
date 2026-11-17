# Code Review

Date: 2026-11-17

Task: e2e-suite-red - Test: fix failing e2e tests (layout Compass heading, sidebar drag, LDAP fixture start)

Scope: third review round. Reviewed revision 728e730481aace55a0e1a3f56d63e50fab006c21. Delta since round two: `git diff 8d46a2d2 728e7304 -- packages`, which only changes `packages/renderer/src/app/layout/app-shell.spec.ts` (helper `trackDocumentPointerListeners` and two tests). The commit also updates files under `reviews/`. Production code is unchanged since 8d46a2d2. The whole task diff 99822f17..728e7304 (5 commits) was checked again for new issues. The working tree was clean. Playwright/e2e was not run by the reviewer, as the parent instructed.

Requirements:
- tasks/e2e-suite-red.md acceptance criteria and its ASSUMPTION notes
- SPEC.md, docs/ARCHITECTURE.md ("End-to-end tests"), AGENTS.md, docs/QUALITY.md ("Freshness")
- Parent instructions: review the round-3 delta and confirm the whole task diff at 728e7304
- reviews/e2e-suite-red/fixes.md and reviews/e2e-suite-red/tests.md

Git range:
- Branch: main
- HEAD: 728e730481aace55a0e1a3f56d63e50fab006c21
- Base/start: 99822f17381bb12183df3ac07f81791afd91c511
- Commits reviewed: 5 (19f1b5f6, 0afc4384, 91295397, 8d46a2d2, 728e7304)

Summary: 0 P0, 0 P1, 1 P2, 1 P3

Checked and not reported:
- Round-3 delta: `trackDocumentPointerListeners` wraps `document.addEventListener` and `removeEventListener`, counts the active pointermove, pointerup and pointercancel listeners, and still calls the real methods. The spies are undone by the describe block's `afterEach(() => vi.restoreAllMocks())` (app-shell.spec.ts:778). The helper is installed before `start()`. Angular's DOM event plugin registers `(document:...)` host bindings through `document.addEventListener`, so the first new test would catch a regression to always-on document host listeners.
- "creating the shell attaches no document pointer listeners": asserts zero listeners after creation, that a document move outside a drag leaves the width at 300px, and that destroying the shell without a drag leaves zero listeners. This matches `listenToDrag` being called only from `dragStart` after `event.button === 0` (app-shell.ts:241-250).
- "another pointer's release or cancel and a secondary press keep the drag's listeners": a pointerup or pointercancel with pointer id 2 returns early in `dragEnd` (app-shell.ts:289), and a `button: 2` press returns early in `dragStart` (app-shell.ts:242). Both keep the listeners at [1, 1, 1]. The test then checks that the drag continues from its original start (520 -> 320px) and that the release at 525 saves exactly one `{ sidebarWidth: 325 }`. The asserted values follow from the start width of 300 and the start x of 500.
- Focused run: `cd packages/renderer && npx ng test --include=src/app/layout/app-shell.spec.ts` -> 1 file, 75 tests passed.
- Whole task diff 99822f17..728e7304: `app-shell.ts`, `test/integration/fixtures/ldap.ts`, `test/e2e/ldap.e2e.ts` and the integration specs are unchanged since round two. The round-two observations still apply: document listeners exist only during a primary-button drag and are removed on release, cancel and destroy. Other pointer ids are ignored. Cancel keeps the last preview, and a release takes the release position. `LdapFixtureUnsupportedError` is raised only for a rejected Enterprise start on Linux kernels 6.19.0-7.0.13, with cleanup on every error path. No secrets were found in the code or fixtures.

## P0 Critical

None.

## P1 High

None.

## P2 Medium

- [ ] **CR-1 | On affected hosts the LDAP e2e test is skipped, not passing, and any Enterprise start failure there is classified as "unsupported"**
    - File: `test/integration/fixtures/ldap.ts:183` (used by `test/e2e/ldap.e2e.ts:28`)
    - Category: Tests
    - Problem: Unchanged from rounds one and two. On a Linux host with a kernel between 6.19.0 and 7.0.13, every rejected Enterprise container start becomes `LdapFixtureUnsupportedError`, and `ldap.e2e.ts` then skips. That includes an image pull failure or a log-wait timeout with a different cause. The SERVER-121912 attribution was not reproduced: this host runs 7.1.3, as the task's ASSUMPTION note and tests.md say.
    - Why it matters: Criterion #1 says "pass". On the host where the original failure was seen, the test now skips, so the criterion is met only on unaffected hosts. If the kernel hypothesis is wrong, a real fixture failure on such a host is hidden as a skip. The skip reason appears in the report, which limits the impact.
    - Suggested fix: Record criterion #1 as passing on this host and state in the evidence that ldap.e2e skips on hosts with kernels 6.19.0-7.0.13. The ASSUMPTION is still for humans to confirm. If more certainty is wanted, raise the unsupported error only when the container's exit log or the rejection reason matches the known refusal, so that other start failures still fail.

## P3 Low

- [ ] **CR-2 | The listener-tracking spy code is now duplicated in the spec**
    - File: `packages/renderer/src/app/layout/app-shell.spec.ts:1005-1021` and `:1055-1073`
    - Category: Quality
    - Problem: The new `trackDocumentPointerListeners` helper repeats the inline spy code of the existing test "listens on the document only during a drag, without duplicates (fixer)" almost line for line. That test still uses its own copy.
    - Why it matters: If the tracking logic is corrected in one place, for example to handle the `capture` option or listener objects, the two copies can drift apart.
    - Suggested fix: Move the helper above the fixer's test and use it there too. The helper may be installed after `start()` in that test, as it is now.

## Review conclusion

No material issues found. CR-1 is about how criterion #1 is evidenced and about the human-reviewed assumption, not a code defect. CR-2 is optional cleanup.

Process note for the parent (not a code finding): `reviews/e2e-suite-red/tests.md` names HEAD 8d46a2d2 "plus uncommitted test changes". Those changes are now commit 728e7304, and its 75-test count matches this round's run. The spec change is a code change for docs/QUALITY.md "Freshness", so `reviewed_revision` in quality.json should be 728e730481aace55a0e1a3f56d63e50fab006c21. Check that the test-writer evidence is accepted as covering that revision.

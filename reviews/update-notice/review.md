# Code Review

Date: 2026-11-17

Task: update-notice - Release (Should): Update available notice

Scope: round 2. Final code of the task, `git diff 71edb348..7a0b9b28` excluding `tasks/` and `reviews/`. Reviewed revision: 7a0b9b286b67694b38032a6e0cd7643854130d78.

Task code commits:
- 94b93322: main-side checker, handler, release link opening;
- a692c990: renderer service, notice, shell wiring, docs;
- e8545506: fixes for CR-1 and CR-2 from round 1;
- 7a0b9b28: round-2 tests from the test-writer (test files only).

Commit a4afc8ba adds only tests and reports from round 1. The round-1 findings were checked against `git diff a4afc8ba..e8545506`, and the round-2 tests against `git diff e8545506..7a0b9b28`.

Requirements:
- tasks/update-notice.md acceptance criteria and recorded assumptions
- SPEC.md Release "Update available" notice, section 5 (only the GitHub releases API is contacted, and the check can be switched off), section 6 (`window.open` blocked)
- docs/ARCHITECTURE.md (desktop main security guards, update notice entry)
- docs/QUALITY.md, AGENTS.md
- reviews/update-notice/fixes.md

Git range:
- Branch: main
- HEAD: 7a0b9b286b67694b38032a6e0cd7643854130d78
- Base/start: 71edb3483a5901c8059bb754ca7696bbdd2d4391
- Commits reviewed: 4 code/test commits (94b93322, a692c990, e8545506, 7a0b9b28) plus the test/report commit a4afc8ba; other commits in the range touch only `tasks/`

Summary: 0 P0, 0 P1, 0 P2, 0 P3

## P0 Critical

None.

## P1 High

None.

## P2 Medium

None.

## P3 Low

None.

## Verification of round-1 findings

- **CR-1 (resolved):** `denyWindowOpen` was replaced by `windowOpenHandler(url, openExternal, log)` in `apps/desktop/src/main/security.ts:79`.
  - Its doc comment states the release-link exception.
  - `apps/desktop/src/main/index.ts:76` installs it for every web contents.
  - `openReleaseLink` was removed from `apps/desktop/src/update/handlers.ts`.
  - `git grep "denyWindowOpen\|openReleaseLink"` on the reviewed revision finds nothing in `apps`, `packages` or `docs`.
  - `security.spec.ts` tests these cases: non-release URLs are denied and nothing opens; a tag page opens externally while the window is still denied; a browser failure is logged or swallowed.
  - The `security.ts` guard note in `docs/ARCHITECTURE.md` (around lines 101-103) and the "Update notice" bullet both describe the exception.
  - `security.ts` now imports `isReleaseUrl` from `../update/checker`. That module imports only a type from `@thicket/contract`, so `security.ts` stays Electron-free and unit-testable, and the import creates no cycle.
- **CR-2 (resolved):** `RELEASE_PAGE_PREFIX` is now `https://github.com/OldPeasant/thicket/releases/tag/` (`apps/desktop/src/update/checker.ts:13`).
  - `isReleaseUrl` compares the WHATWG-normalised `href`, so `.../releases/tag/../download/...` normalises to a download URL and is rejected. A test covers this case, and `releases/latest` and `releases/download/...` are tested as rejected too.
  - The recorded fixtures and the renderer spec use only tag-page `html_url`s, so the narrower prefix doesn't change the update-detection results.

## Round-2 tests (7a0b9b28)

- `security.spec.ts`: "opens nothing for non-tag release URLs, http or a path escaping /releases/tag/". It passes these URLs through `windowOpenHandler`:
  - `releases/latest`;
  - a `tag/../download` URL;
  - an `http:` URL;
  - a URL with userinfo;
  - a non-URL string.

  It asserts the window is denied and `openExternal` is never called. This tests behaviour through the real guard, not just through `isReleaseUrl`.
- `checker.spec.ts`: "skips a release whose html_url is not a tag page and reports the newest one that is". The newest two releases have a download URL and a `releases/latest` URL as `html_url`. The test confirms `check()` falls back to v0.3.0 with its tag-page URL.
  - The helpers `page()` and `entry()` exist in the enclosing `describe` (checker.spec.ts:180-187).
  - The expected result matches `latestStable`: an entry with a link that fails `isReleaseUrl` is skipped.
- Both tests are deterministic. They use injected `fetch` and `openExternal` fakes, make no network calls, and change no production code. They partly overlap the `isReleaseUrl` list in `checker.spec.ts`, but they check different layers (the guard and the release selection), so this is not a finding.

## Notes (verified, no finding)

- The renderer and update modules in the task are unchanged since round 1, apart from the files listed above. The round-1 checks still apply:
  - Acceptance criterion 1 is covered by recorded fixtures in `checker.spec.ts`: newer, same, pre-release ignored, and network error silent.
  - Acceptance criterion 2 ("setting off, no request") is tested in the checker, in the handler and in the renderer service.
  - Timers and subscriptions are cleaned up, and answers that arrive late are discarded.
  - Version comparison follows semver precedence.
- I could not run the test suites in this session: command execution beyond git inspection was denied. `fixes.md` reports `npx vitest run src/update src/main` with 117 passed and `npm run check` passing. That run predates the two round-2 tests. The parent must record its own run of the final revision with `tasks.py verify`.

## Review conclusion

No material issues found.
